#!/usr/bin/env node
/**
 * verify-sources.js — stage 3 of the daily batch.
 *
 * Fetches every source URL on every topic in a directory and sets `verified`
 * from what actually came back. `verified` is never authored by a model or a
 * human — it is derived here or it is false. The seed topics shipped
 * verified:true on URLs that 404 precisely because nothing owned this step.
 *
 * Outcomes (see lib/liveness.js for why only 404/410/DNS strip a source):
 *   2xx + allowlisted   verified: true
 *   2xx not allowlisted verified: false, kept
 *   403/429/5xx/timeout verified: false, kept, logged unverifiable
 *   404/410/DNS failure source removed from the topic
 *
 * Usage:
 *   node scripts/pipeline/verify-sources.js [--dir topics/IN/pending]
 *        [--timeout 8000] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAllowlisted, classify, OUTCOME } from './lib/liveness.js';
import { checkUrl } from './lib/probe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = { dir: 'topics/IN/pending', timeout: 8000, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = argv[++i];
    else if (a === '--timeout') args.timeout = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

async function main() {
  const { dir, timeout, dryRun } = parseArgs(process.argv.slice(2));

  const allowlist = readJson(path.join(ROOT, 'config/source-allowlist.json'), { domains: [] });
  const domains = allowlist.domains || [];
  if (domains.length === 0) console.warn('· warning: empty allowlist — nothing can be badged verified');

  const target = path.resolve(ROOT, dir);
  if (!fs.existsSync(target)) {
    console.log(`· ${dir} does not exist — nothing to verify`);
    return;
  }

  const files = fs.readdirSync(target).filter(f => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.log(`· no topics in ${dir} — nothing to verify`);
    return;
  }

  const tally = { verified: 0, unlisted: 0, unverifiable: 0, dead: 0 };
  const starved = [];
  let changed = 0;

  for (const file of files) {
    const full = path.join(target, file);
    const topic = readJson(full);
    if (!topic?.sources) { console.warn(`  · ${file}: no sources array, skipping`); continue; }

    const kept = [];
    for (const source of topic.sources) {
      const url = source.url;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        tally.dead++;
        console.log(`  ✗ ${file}: dropped non-http source ${JSON.stringify(url)}`);
        continue;
      }

      const allowed = isAllowlisted(url, domains);
      const result = await checkUrl(url, timeout);
      const outcome = classify(result, allowed);
      tally[outcome]++;

      const detail = result.errorKind ? result.errorKind : `HTTP ${result.status}`;
      if (outcome === OUTCOME.DEAD) {
        console.log(`  ✗ ${file}: DEAD (${detail}) ${url}`);
        continue;
      }
      if (outcome === OUTCOME.UNVERIFIABLE) {
        console.log(`  ? ${file}: unverifiable (${detail}) ${url}`);
      } else if (outcome === OUTCOME.LIVE_UNLISTED) {
        console.log(`  · ${file}: live but not allowlisted ${new URL(url).hostname}`);
      } else {
        console.log(`  ✓ ${file}: verified ${new URL(url).hostname}`);
      }

      kept.push({ ...source, verified: outcome === OUTCOME.VERIFIED });
    }

    if (kept.length === 0) {
      starved.push(file);
      continue;
    }

    const next = { ...topic, sources: kept, generation: { ...topic.generation, sourceCount: kept.length } };
    if (JSON.stringify(next) !== JSON.stringify(topic)) {
      if (!dryRun) fs.writeFileSync(full, JSON.stringify(next, null, 2) + '\n');
      changed++;
    }
  }

  console.log(
    `\n· ${tally.verified} verified · ${tally.unlisted} live-unlisted · ` +
    `${tally.unverifiable} unverifiable · ${tally.dead} dead`,
  );
  console.log(dryRun ? '· dry run, nothing written' : `✓ updated ${changed} topic file(s)`);

  // A topic with no surviving source cannot be published — the schema requires
  // at least one, and a question with nothing behind it is exactly what this
  // pipeline exists to prevent.
  if (starved.length > 0) {
    console.error(`\n✗ ${starved.length} topic(s) lost every source and cannot be published:`);
    for (const f of starved) console.error(`  ${f}`);
    console.error('  delete them or re-run discovery');
    process.exit(1);
  }
}

main().catch(err => { console.error('✗ verify-sources failed:', err); process.exit(1); });
