#!/usr/bin/env node
/**
 * discover-topics.js — stage 1 of the daily batch.
 *
 * Asks Claude, with the server-side web_search tool, what is currently being
 * argued about in India, one call per category. Emits raw news candidates, not
 * questions — turning a candidate into a neutral two-sided question is
 * generate-topics.js's job, and keeping the two apart means the question writer
 * never has a reason to invent a source.
 *
 * Every candidate carries `allowedUrls`: the URLs the search tool actually
 * returned. generate-topics.js may only cite from that list. See lib/websearch.js.
 *
 * Usage:
 *   node scripts/pipeline/discover-topics.js [--country IN] [--per-category 2]
 *                                            [--out .pipeline/candidates.json]
 *                                            [--mock <recorded-response.json>] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { normalizeQuestion } from './lib/normalize.js';
import {
  textOf, harvestSearchUrls, filterArticleUrls, extractJson, isFresh, sleep,
} from './lib/websearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_ARTICLE_AGE_DAYS = 30;
const CALL_SPACING_MS = 2000;

function parseArgs(argv) {
  const args = {
    country: 'IN', perCategory: 2,
    out: '.pipeline/candidates.json', mock: null, dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--per-category') args.perCategory = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--mock') args.mock = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

/**
 * Normalized questions already used in the last `days`, across every lifecycle
 * directory. Rejected topics are included on purpose — a question a human
 * turned down should not come back tomorrow.
 */
function recentQuestions(country, days = 30) {
  const cutoff = Date.now() - days * 86_400_000;
  const out = new Set();
  for (const sub of ['active', 'pending', 'rejected', 'archive']) {
    const dir = path.join(ROOT, 'topics', country, sub);
    if (!fs.existsSync(dir)) continue;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!e.name.endsWith('.json')) continue;
        const t = readJson(full);
        if (!t?.question) continue;
        const stamp = new Date(t.publishedAt ?? t.activeFrom ?? 0).getTime();
        if (Number.isNaN(stamp) || stamp >= cutoff) out.add(normalizeQuestion(t.question));
      }
    };
    walk(dir);
  }
  return out;
}

function buildPrompt(category, perCategory, avoid) {
  const avoidBlock = avoid.length
    ? `\nAlready covered recently — do NOT propose anything that would produce a similar question:\n${avoid.map(q => `- ${q}`).join('\n')}\n`
    : '';

  return `Now: ${new Date().toUTCString()}

Search the web for what is being actively debated in India right now in the category "${category.label}".

I need genuine public-policy or public-interest disagreements from the last ${MAX_ARTICLE_AGE_DAYS} days — the kind of thing where reasonable, informed Indians land on opposite sides. Not settled facts, not celebrity gossip, not anything with an obvious correct answer.
${avoidBlock}
Return the ${perCategory} strongest items as JSON only, no prose:

{"items":[{
  "headline":"factual headline, no opinion, <=100 chars",
  "oneLineSummary":"what is actually being proposed or disputed, <=200 chars",
  "whyContested":"the real disagreement in one sentence — who wants what and why",
  "publishedAt":"YYYY-MM-DD of the reporting you found",
  "trendScore":0-100 estimate of how widely this is being discussed in India
}]}

Rules:
- Every item must be reported by a source you actually found in search.
- Search for the specific article or story reporting this, not just the general subject — a reader needs to be able to open one piece of reporting and get the details, not land on a section front page.
- publishedAt must be a real date from the reporting, within the last ${MAX_ARTICLE_AGE_DAYS} days.
- If you cannot find ${perCategory} genuinely contested items, return fewer. An empty list is a valid answer.
- Do not include URLs in your reply; they are taken from the search results directly.`;
}

function parseItems(raw, category) {
  const parsed = extractJson(raw);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out = [];

  for (const it of items) {
    const headline = typeof it.headline === 'string' ? it.headline.trim() : '';
    const summary = typeof it.oneLineSummary === 'string' ? it.oneLineSummary.trim() : '';
    const why = typeof it.whyContested === 'string' ? it.whyContested.trim() : '';
    if (!headline || !summary || !why) continue;
    if (!isFresh(it.publishedAt, MAX_ARTICLE_AGE_DAYS)) continue;

    const score = Number(it.trendScore);
    out.push({
      category: category.id,
      headline, oneLineSummary: summary, whyContested: why,
      publishedAt: it.publishedAt,
      trendScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
    });
  }
  return out;
}

async function callForCategory(client, category, perCategory, avoid, mockMessage) {
  if (mockMessage) return mockMessage;
  return client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: buildPrompt(category, perCategory, avoid) }],
  });
}

async function main() {
  const { country, perCategory, out, mock, dryRun } = parseArgs(process.argv.slice(2));

  if (!mock && !process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY is required (or pass --mock <file> to replay a recorded response)');
    process.exit(1);
  }

  const categories = readJson(path.join(ROOT, 'config/categories.json'), { categories: [] }).categories;
  if (categories.length === 0) {
    console.error('✗ config/categories.json has no categories');
    process.exit(1);
  }

  const avoid = [...recentQuestions(country)];
  console.log(`· ${categories.length} categories · avoiding ${avoid.length} recent question(s)`);

  const client = mock ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let mockMessage = null;
  if (mock) {
    const mockPath = path.resolve(ROOT, mock);
    let raw;
    try { raw = fs.readFileSync(mockPath, 'utf8'); }
    catch { console.error(`✗ could not read mock response ${mock}`); process.exit(1); }
    // The fixture stores __FRESH_DATE__ rather than a literal date, so the
    // freshness gate does not start rejecting it 30 days after it was written.
    raw = raw.replace(/__FRESH_DATE__/g, new Date().toISOString().slice(0, 10));
    try { mockMessage = JSON.parse(raw); }
    catch (e) { console.error(`✗ mock response is not valid JSON — ${e.message}`); process.exit(1); }
  }

  const candidates = [];
  let failures = 0;

  for (const [i, category] of categories.entries()) {
    if (i > 0 && !mock) await sleep(CALL_SPACING_MS);
    try {
      const message = await callForCategory(client, category, perCategory, avoid, mockMessage);

      const rawUrls = harvestSearchUrls(message);
      // No tool-result URLs means either the search never ran or the response
      // shape changed. Either way we have nothing citable, and falling back to
      // the model's prose URLs is precisely the bug this pipeline exists to
      // avoid — so drop the category rather than degrade.
      if (rawUrls.length === 0) {
        console.warn(`  ✗ ${category.id}: no web_search_tool_result URLs — skipping`);
        failures++;
        continue;
      }

      // A URL can pass provenance (the tool really returned it) and would pass
      // liveness (it resolves 200) while still being a category/section front
      // page rather than a story — e.g. theprint.in/category/politics/. Those
      // clear both of the checks above but don't lead a reader anywhere
      // specific, so they are filtered out before a topic can ever cite one.
      const urls = filterArticleUrls(rawUrls);
      const hubDropped = rawUrls.length - urls.length;
      if (urls.length === 0) {
        console.warn(`  ✗ ${category.id}: all ${rawUrls.length} URL(s) looked like hub/section pages — skipping`);
        failures++;
        continue;
      }
      if (hubDropped > 0) {
        console.log(`  · ${category.id}: dropped ${hubDropped} hub/section URL(s), ${urls.length} article URL(s) remain`);
      }

      const items = parseItems(textOf(message), category);
      if (items.length === 0) {
        console.log(`  · ${category.id}: no contested items returned`);
        continue;
      }

      for (const item of items) candidates.push({ ...item, allowedUrls: urls });
      console.log(`  ✓ ${category.id}: ${items.length} candidate(s), ${urls.length} sourced URL(s)`);
    } catch (err) {
      console.error(`  ✗ ${category.id}: ${err.message}`);
      failures++;
    }
  }

  console.log(`\n· ${candidates.length} candidate(s) from ${categories.length - failures}/${categories.length} categories`);

  if (candidates.length === 0) {
    console.error('✗ no candidates discovered — nothing for generate-topics.js to work from');
    process.exit(1);
  }

  if (dryRun) {
    console.log('· dry run, nothing written');
    for (const c of candidates) console.log(`  [${c.category}] ${c.headline}`);
    return;
  }

  const outPath = path.resolve(ROOT, out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(candidates, null, 2) + '\n');
  console.log(`✓ wrote ${outPath}`);
}

main().catch(err => { console.error('✗ discover failed:', err); process.exit(1); });
