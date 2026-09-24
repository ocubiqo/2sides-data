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
 *                                            [--record <dir>] [--max-tokens N]
 *
 * --max-tokens overrides the auto-scaled budget (BASE_TOKENS + perCategory *
 * TOKENS_PER_ITEM). Usually unnecessary — the default already scales with
 * --per-category — but there if a category's items are unusually verbose.
 *
 * --record <dir> saves the RAW response for every real API call (skipped
 * entirely under --mock, which has nothing new to save) as
 * <dir>/discover-<category>.json. This is what turns one real, paid run into
 * a permanent, free fixture: commit the files you want to keep under
 * fixtures/, and every future run against them via --mock costs nothing.
 * Point it at .pipeline/recorded (gitignored) to inspect without committing,
 * or straight at a fixtures/ path to keep it.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { normalizeQuestion } from './lib/normalize.js';
import {
  harvestSearchUrls, filterArticleUrls, extractJsonFromMessage, isFresh, sleep,
} from './lib/websearch.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_ARTICLE_AGE_DAYS = 30;
const CALL_SPACING_MS = 2000;
// ~150-250 tokens per JSON item once headline/summary/whyContested are all
// filled in. The old fixed 2048 cap silently truncated the response (and so
// returned zero items) for anything above roughly --per-category 8 — a
// truncated response isn't a retry-able error, it's just invisible data loss,
// so this scales with what's actually being asked for rather than staying fixed.
const TOKENS_PER_ITEM = 260;
const BASE_TOKENS = 512;

function parseArgs(argv) {
  const args = {
    country: 'IN', perCategory: 2,
    out: '.pipeline/candidates.json', mock: null, dryRun: false, record: null, maxTokens: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--per-category') args.perCategory = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--max-tokens') args.maxTokens = Number(argv[++i]);
    else if (a === '--mock') args.mock = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--record') args.record = argv[++i];
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

/**
 * @param parsed  the already-extracted JSON value (see extractJsonFromMessage),
 *                or null if nothing in the response parsed
 * @returns {items, rejected}  rejected counts *why* items were dropped, so a
 *          category returning zero has a diagnosable reason instead of a flat
 *          "no contested items returned"
 */
function parseItems(parsed, category) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const out = [];
  const rejected = { incomplete: 0, stale: 0 };

  for (const it of items) {
    const headline = typeof it.headline === 'string' ? it.headline.trim() : '';
    const summary = typeof it.oneLineSummary === 'string' ? it.oneLineSummary.trim() : '';
    const why = typeof it.whyContested === 'string' ? it.whyContested.trim() : '';
    if (!headline || !summary || !why) { rejected.incomplete++; continue; }
    if (!isFresh(it.publishedAt, MAX_ARTICLE_AGE_DAYS)) { rejected.stale++; continue; }

    const score = Number(it.trendScore);
    out.push({
      category: category.id,
      headline, oneLineSummary: summary, whyContested: why,
      publishedAt: it.publishedAt,
      trendScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
    });
  }
  return { items: out, rejected };
}

async function callForCategory(client, category, perCategory, avoid, mockMessage, maxTokens) {
  if (mockMessage) return mockMessage;
  return client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: buildPrompt(category, perCategory, avoid) }],
  });
}

async function main() {
  const { country, perCategory, out, mock, dryRun, record, maxTokens: maxTokensArg } =
    parseArgs(process.argv.slice(2));

  if (!mock && !process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY is required (or pass --mock <file> to replay a recorded response)');
    process.exit(1);
  }

  const maxTokens = maxTokensArg ?? Math.max(2048, BASE_TOKENS + perCategory * TOKENS_PER_ITEM);

  const categories = readJson(path.join(ROOT, 'config/categories.json'), { categories: [] }).categories;
  if (categories.length === 0) {
    console.error('✗ config/categories.json has no categories');
    process.exit(1);
  }

  const avoid = [...recentQuestions(country)];
  console.log(`· ${categories.length} categories · avoiding ${avoid.length} recent question(s) · max_tokens ${maxTokens}`);

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
      const message = await callForCategory(client, category, perCategory, avoid, mockMessage, maxTokens);

      // Save the real response before anything else touches it, so even a
      // run that goes on to fail downstream still leaves a usable fixture —
      // this is the raw material for --mock, at the cost of a paid call you
      // were making anyway.
      if (record && !mock) {
        const recordDir = path.resolve(ROOT, record);
        fs.mkdirSync(recordDir, { recursive: true });
        fs.writeFileSync(
          path.join(recordDir, `discover-${category.id}.json`),
          JSON.stringify(message, null, 2) + '\n',
        );
      }

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

      const parsedJson = extractJsonFromMessage(message);
      if (!parsedJson) {
        // Not the same as "the model found nothing" — this means the response
        // never contained a parseable JSON object at all, worth surfacing
        // distinctly since it points at a prompt/response-shape problem
        // rather than a quiet news day.
        const blocks = (message.content || []).filter(b => b.type === 'text');
        const lastText = blocks[blocks.length - 1]?.text ?? '(no text block at all)';
        console.warn(`  ✗ ${category.id}: response had no parseable JSON (${blocks.length} text block(s))`);
        console.warn(`      last block: ${lastText.slice(0, 200).replace(/\n/g, ' ')}${lastText.length > 200 ? '…' : ''}`);
        failures++;
        continue;
      }

      const { items, rejected } = parseItems(parsedJson, category);
      if (items.length === 0) {
        const reason = rejected.incomplete > 0 || rejected.stale > 0
          ? ` (${rejected.incomplete} incomplete, ${rejected.stale} stale)`
          : '';
        console.log(`  · ${category.id}: no contested items returned${reason}`);
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
