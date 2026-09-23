#!/usr/bin/env node
/**
 * seed-sample-tallies.js — mints synthetic tallies for sample mode.
 *
 * Required, not cosmetic. build-feed.js falls back to a zeroed tally when
 * tallies/<c>/<id>.json is missing and does not complain, so a freshly promoted
 * topic with no tally ships as a "0% of India · 0 votes" card with no chart —
 * which reads as a broken app rather than a new topic.
 *
 * Everything written here is invented and marked `synthetic: true`. The app
 * badges such numbers as sample data, and validate-data.js refuses to pass a
 * synthetic tally while the manifest says dataMode "live" — so these files must
 * be deleted before real voting goes live. That interlock is the only reason
 * inventing numbers is acceptable here at all.
 *
 * Refuses to run when DATA_MODE=live.
 *
 * Usage:
 *   node scripts/pipeline/seed-sample-tallies.js [--country IN] [--only-missing]
 *        [--rationale .pipeline/rationale.json] [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSyntheticTally } from './lib/synthetic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = {
    country: 'IN', onlyMissing: false,
    rationale: '.pipeline/rationale.json', dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--only-missing') args.onlyMissing = true;
    else if (a === '--rationale') args.rationale = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

function main() {
  const { country, onlyMissing, dryRun, rationale } = parseArgs(process.argv.slice(2));

  // Hard stop: minting invented numbers while the app is presenting its data as
  // real is the one thing this script must never do.
  if (process.env.DATA_MODE === 'live') {
    console.error('✗ DATA_MODE=live — refusing to write synthetic tallies');
    process.exit(1);
  }

  const activeDir = path.join(ROOT, 'topics', country, 'active');
  if (!fs.existsSync(activeDir)) {
    console.log(`· no topics/${country}/active — nothing to seed`);
    return;
  }

  const topics = fs.readdirSync(activeDir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(activeDir, f)))
    .filter(t => t?.id);

  if (topics.length === 0) {
    console.log(`· no published topics in topics/${country}/active — nothing to seed`);
    return;
  }

  // Optional: the model's own split estimate, when the seeder runs in the same
  // job as generation. Absent in the review-decision workflow (separate run,
  // and .pipeline is gitignored), in which case the split derives from the id.
  const splits = readJson(path.resolve(ROOT, rationale), {}) || {};

  const regionCfg = readJson(path.join(ROOT, 'config/regions.json'), {})[country];
  const allRegions = regionCfg?.subdivisions ?? [];

  const outDir = path.join(ROOT, 'tallies', country);
  fs.mkdirSync(outDir, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (const topic of topics) {
    const file = path.join(outDir, `${topic.id}.json`);

    if (fs.existsSync(file)) {
      const existing = readJson(file);
      // Never overwrite a real tally with an invented one.
      if (existing && existing.synthetic !== true) {
        console.log(`  · ${topic.id}: real tally present, leaving alone`);
        skipped++;
        continue;
      }
      if (onlyMissing) { skipped++; continue; }
    }

    // Two stable regions per topic, chosen by the id rather than at random, so
    // a topic keeps the same regional story between runs.
    const seedIdx = topic.id.length;
    const regions = allRegions.length
      ? [allRegions[seedIdx % allRegions.length], allRegions[(seedIdx * 7 + 3) % allRegions.length]]
        .filter((r, i, arr) => r && arr.findIndex(x => x.code === r.code) === i)
      : [];

    const tally = buildSyntheticTally(topic.id, {
      now: new Date(),
      centerPct: splits[topic.id]?.estimatedSplit ?? null,
      regions,
    });

    if (dryRun) {
      console.log(`  [dry] ${topic.id}: ${tally.current.pct}% of ${tally.current.total.toLocaleString()} · ${tally.history.length} pts`);
    } else {
      fs.writeFileSync(file, JSON.stringify(tally, null, 2) + '\n');
      console.log(`  ✓ ${topic.id}: ${tally.current.pct}% of ${tally.current.total.toLocaleString()} · ${tally.history.length} pts`);
      written++;
    }
  }

  console.log(
    dryRun
      ? `· dry run — would write ${topics.length - skipped}, skip ${skipped}`
      : `✓ wrote ${written} synthetic tally file(s), skipped ${skipped}`,
  );
  if (written > 0) {
    console.log('  these are invented numbers: the app badges them as sample data,');
    console.log('  and they must be deleted before DATA_MODE can become "live"');
  }
}

main();
