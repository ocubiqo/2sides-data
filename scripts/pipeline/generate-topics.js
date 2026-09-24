#!/usr/bin/env node
/**
 * generate-topics.js — stage 2 of the daily batch.
 *
 * Turns discovery candidates into topic JSON in topics/<country>/pending/.
 * Runs with NO tools: search already happened in stage 1, and the candidate
 * carries the only URLs this stage is allowed to cite. A question writer with
 * web access is a question writer that can invent a citation.
 *
 * Gates a candidate has to clear (any failure discards it):
 *   - every source URL is character-identical to one in allowedUrls
 *   - estimatedSplit lands in 25..75          — a 90/10 "debate" is not a debate
 *   - both caseForYes and caseForNo are present — if one side has no case, there is one side
 *   - loadedWords is empty and the question passes a leading-language check
 *   - question is 15..120 chars and ends in '?'
 *
 * estimatedSplit / caseForYes / caseForNo are NOT written to the topic file —
 * topic.schema.json is additionalProperties:false, and these are review
 * rationale, not published content. They go to a sidecar the review issue reads.
 *
 * Usage:
 *   node scripts/pipeline/generate-topics.js [--country IN] [--in .pipeline/candidates.json]
 *        [--count 4] [--min 3] [--rationale .pipeline/rationale.json] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { extractJsonFromMessage, sleep } from './lib/websearch.js';
import { vetTopic, resolveTier, SPLIT_MIN, SPLIT_MAX } from './lib/vet-topic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const MODEL = 'claude-haiku-4-5-20251001';
const ACTIVE_DAYS = 7;
const CALL_SPACING_MS = 2000;

function parseArgs(argv) {
  const args = {
    country: 'IN', in: '.pipeline/candidates.json', count: 4, min: 3,
    rationale: '.pipeline/rationale.json', dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--in') args.in = argv[++i];
    else if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--min') args.min = Number(argv[++i]);
    else if (a === '--rationale') args.rationale = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

function slugify(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w && !['should', 'india', 'the', 'a', 'an', 'be', 'to', 'of', 'in', 'is', 'for', 'do'].includes(w))
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** in-YYYY-MM-<slug>, suffixed on collision with anything already on disk. */
function makeId(country, question, taken) {
  const now = new Date();
  const prefix = `${country.toLowerCase()}-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = `${prefix}-${slugify(question) || 'topic'}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

function existingIds(country) {
  const ids = new Set();
  for (const sub of ['active', 'pending', 'rejected', 'archive']) {
    const dir = path.join(ROOT, 'topics', country, sub);
    if (!fs.existsSync(dir)) continue;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json')) ids.add(e.name.replace(/\.json$/, ''));
      }
    };
    walk(dir);
  }
  return ids;
}

function buildPrompt(candidate) {
  const urlList = candidate.allowedUrls.map(u => `- ${u.url}${u.title ? `  (${u.title})` : ''}`).join('\n');

  return `You are writing one neutral, two-sided voting question for an Indian public-opinion app.

The news item:
  Headline:     ${candidate.headline}
  What happened: ${candidate.oneLineSummary}
  The dispute:   ${candidate.whyContested}
  Category:      ${candidate.category}

Sources you may cite — copy a URL character-for-character from this list. Inventing, editing, shortening or "correcting" a URL is a failure:
${urlList}

Return JSON only:

{
  "question": "a neutral yes/no question, 15-120 chars, must end with '?'",
  "context": "60-320 chars. Two or three plain sentences: what is proposed, then the strongest point on each side. No adjectives about either side.",
  "sides": { "yes": "<=18 chars", "no": "<=18 chars" },
  "sources": [{ "name": "publisher name", "url": "<exact URL from the list>", "publishedAt": "YYYY-MM-DD" }],
  "caseForYes": "the best honest argument for YES, <=30 words",
  "caseForNo": "the best honest argument for NO, <=30 words",
  "estimatedSplit": <integer 0-100: your honest estimate of what % of Indians would vote YES>,
  "loadedWords": ["any word in your question that presupposes an answer — leave empty if none"],
  "trendScore": <integer 0-100: how widely this is being discussed>
}

Hard rules:
- Name no individual as culpable. Describe positions, not people.
- The question must be answerable YES or NO, and a reasonable person must be able to pick either.
- If this is not genuinely contested — if one answer is clearly correct — say so by setting estimatedSplit outside ${SPLIT_MIN}-${SPLIT_MAX}. Do not manufacture a controversy.
- sides.yes / sides.no are plain labels: "YES"/"NO", or short nouns like "KEEP IT"/"SCRAP IT".
- Be honest in estimatedSplit. It is used to discard non-debates, not to score you.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { country, count, min, dryRun } = args;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('✗ ANTHROPIC_API_KEY is required');
    process.exit(1);
  }

  const candidates = readJson(path.resolve(ROOT, args.in));
  if (!Array.isArray(candidates) || candidates.length === 0) {
    console.error(`✗ no candidates in ${args.in} — run discover-topics.js first`);
    process.exit(1);
  }

  const tiers = readJson(path.join(ROOT, 'config/review-tiers.json'), {});
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const taken = existingIds(country);
  const pipelineRun = process.env.GITHUB_RUN_ID || new Date().toISOString();

  // Strongest first, so if we hit `count` early we kept the best ones.
  const ordered = [...candidates].sort((a, b) => (b.trendScore ?? 0) - (a.trendScore ?? 0));

  const accepted = [];
  const rationale = {};
  const rejected = [];

  for (const [i, candidate] of ordered.entries()) {
    if (accepted.length >= count) break;
    if (i > 0) await sleep(CALL_SPACING_MS);

    const allowedSet = new Set((candidate.allowedUrls || []).map(u => u.url));
    if (allowedSet.size === 0) {
      rejected.push(`[${candidate.category}] no allowedUrls on candidate`);
      continue;
    }

    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: buildPrompt(candidate) }],
      });

      // Scans blocks individually rather than concatenating them — this stage
      // runs with no tools so a single text block is the common case, but
      // scanning per-block is free insurance against the same failure mode
      // discover-topics.js hit (see extractJsonFromMessage's doc comment).
      const raw = extractJsonFromMessage(message);
      if (!raw) { rejected.push(`[${candidate.category}] unparseable response`); continue; }

      const result = vetTopic(raw, candidate, allowedSet);
      if (result.reject) { rejected.push(`[${candidate.category}] ${result.reject}`); continue; }

      const now = new Date();
      const id = makeId(country, result.topic.question, taken);
      const { tier, escalatedBy } = resolveTier(
        candidate.category, result.topic.question, result.topic.context, tiers,
      );

      accepted.push({
        id,
        schemaVersion: 1,
        contentVersion: 1,
        country,
        category: candidate.category,
        status: 'in_review',
        question: result.topic.question,
        context: result.topic.context,
        sides: result.topic.sides,
        sources: result.topic.sources,
        tags: [],
        trendScore: result.topic.trendScore,
        publishedAt: now.toISOString(),
        activeFrom: now.toISOString(),
        activeUntil: new Date(now.getTime() + ACTIVE_DAYS * 86_400_000).toISOString(),
        review: { tier, state: 'pending', reviewedBy: null, reviewedAt: null, reason: null },
        generation: {
          model: MODEL,
          pipelineRun,
          generatedAt: now.toISOString(),
          sourceCount: result.topic.sources.length,
        },
        bookmarks: 0,
      });
      rationale[id] = { ...result.rationale, tier, escalatedBy };
      console.log(`  ✓ ${id} [${candidate.category}/${tier}] split~${result.rationale.estimatedSplit}%`);
    } catch (err) {
      rejected.push(`[${candidate.category}] ${err.message}`);
    }
  }

  if (rejected.length) {
    console.log(`\n· discarded ${rejected.length}:`);
    for (const r of rejected) console.log(`  ✗ ${r}`);
  }

  console.log(`\n· ${accepted.length} topic(s) accepted of ${ordered.length} candidate(s)`);

  if (accepted.length < min) {
    console.error(`✗ only ${accepted.length} topic(s) cleared the gates, need at least ${min}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log('· dry run, nothing written');
    for (const t of accepted) console.log(`\n  ${t.question}\n    ${t.context}`);
    return;
  }

  const outDir = path.join(ROOT, 'topics', country, 'pending');
  fs.mkdirSync(outDir, { recursive: true });
  for (const topic of accepted) {
    fs.writeFileSync(path.join(outDir, `${topic.id}.json`), JSON.stringify(topic, null, 2) + '\n');
  }

  const rPath = path.resolve(ROOT, args.rationale);
  fs.mkdirSync(path.dirname(rPath), { recursive: true });
  fs.writeFileSync(rPath, JSON.stringify(rationale, null, 2) + '\n');

  console.log(`✓ wrote ${accepted.length} topic(s) to ${path.relative(ROOT, outDir)}`);
  console.log(`✓ wrote review rationale to ${path.relative(ROOT, rPath)}`);
}

main().catch(err => { console.error('✗ generate failed:', err); process.exit(1); });
