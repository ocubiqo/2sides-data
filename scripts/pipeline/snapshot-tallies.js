#!/usr/bin/env node
/**
 * snapshot-tallies.js — appends one point to each active topic's tally history.
 *
 * This is what makes the sentiment chart and the saved-row sparkline possible.
 * The live tally in Firestore is a single mutable number; without this job there
 * is no "was 54%, now 61%" to draw. Runs on a cron (see snapshot-tallies.yml)
 * and commits the result, so history is append-only and git-auditable.
 *
 * Source of counts:
 *   - Firebase Admin, when FIREBASE_SERVICE_ACCOUNT is set (production).
 *   - tallies/<country>/<id>.json's existing `current`, otherwise — which makes
 *     the job a no-op rather than a data-destroyer when credentials are missing.
 *
 * Usage: node scripts/pipeline/snapshot-tallies.js [--country IN] [--dry-run]
 */

import fs from 'fs';
import path from 'path';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '../..');
const RETENTION_DAYS = 90;
/** Two snapshots inside this window collapse into one — protects against re-runs. */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

function parseArgs(argv) {
  const args = { country: 'IN', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--country') args.country = argv[++i];
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Lists topic ids that are published and not past activeUntil. */
function activeTopicIds(country) {
  const dir = path.join(ROOT, 'topics', country, 'active');
  if (!fs.existsSync(dir)) return [];
  const now = Date.now();
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(dir, f)))
    .filter(t => t && t.status === 'published' && new Date(t.activeUntil).getTime() > now)
    .map(t => t.id);
}

/**
 * Returns { [topicId]: { yes, no, regions: { [code]: { yes, no } }, suspect } }.
 * Falls back to an empty map when Firebase is not configured, so the caller
 * keeps the existing `current` rather than zeroing it.
 */
async function fetchLiveCounts(topicIds) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log('· FIREBASE_SERVICE_ACCOUNT unset — reusing stored counts (no-op snapshot)');
    return {};
  }

  let admin;
  try { admin = (await import('firebase-admin')).default; }
  catch {
    console.error('✗ firebase-admin not installed; run `npm i firebase-admin`');
    process.exit(1);
  }

  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  const db = admin.firestore();

  const out = {};
  for (const id of topicIds) {
    // Sharded counters: sum shards rather than reading one hot document.
    const shards = await db.collection('tallies').doc(id).collection('shards').get();
    let yes = 0, no = 0;
    const regions = {};
    shards.forEach(doc => {
      const d = doc.data();
      yes += d.a || 0;
      no  += d.b || 0;
      for (const [code, r] of Object.entries(d.regions || {})) {
        regions[code] = regions[code] || { yes: 0, no: 0 };
        regions[code].yes += r.a || 0;
        regions[code].no  += r.b || 0;
      }
    });

    const suspectDoc = await db.collection('tallies').doc(id).get();
    const suspect = (suspectDoc.data() || {}).suspect || { yes: 0, no: 0 };

    out[id] = { yes, no, regions, suspect };
  }
  return out;
}

function pct(yes, total) {
  return total > 0 ? Math.round((yes / total) * 100) : 0;
}

function buildRegions(rawRegions, country) {
  const cfg = readJson(path.join(ROOT, 'config', 'regions.json'), {})[country];
  if (!cfg || !rawRegions) return [];
  const labels = Object.fromEntries(cfg.subdivisions.map(s => [s.code, s.label]));

  return Object.entries(rawRegions)
    .map(([code, r]) => {
      const votes = r.yes + r.no;
      return { code, label: labels[code] || code, pct: pct(r.yes, votes), votes };
    })
    // A region below the floor is dropped, not shown with a caveat — a thin
    // sample rendered as a finding reads as fact and is worse than no finding.
    .filter(r => r.votes >= cfg.minVotesToPublish)
    .sort((a, b) => b.votes - a.votes);
}

async function main() {
  const { country, dryRun } = parseArgs(process.argv.slice(2));
  const ids = activeTopicIds(country);
  if (ids.length === 0) {
    console.log(`· no active topics in topics/${country}/active — nothing to snapshot`);
    return;
  }
  console.log(`· snapshotting ${ids.length} active topic(s) for ${country}`);

  const live = await fetchLiveCounts(ids);
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  let written = 0;

  for (const id of ids) {
    const file = path.join(ROOT, 'tallies', country, `${id}.json`);
    const existing = readJson(file, {
      topicId: id, schemaVersion: 1,
      current: { yes: 0, no: 0, total: 0, pct: 0, asOf: nowIso },
      history: [], regions: [], suspect: { yes: 0, no: 0, total: 0 },
    });

    const counts = live[id];
    const yes = counts ? counts.yes : existing.current.yes;
    const no  = counts ? counts.no  : existing.current.no;
    const total = yes + no;
    const point = { at: nowIso, pct: pct(yes, total), total };

    // Velocity, for the live ticker's starting rate.
    const prev = existing.history[existing.history.length - 1];
    let velocity = existing.current.velocity || 0;
    if (prev) {
      const hours = (now.getTime() - new Date(prev.at).getTime()) / 3_600_000;
      if (hours > 0) velocity = Math.max(0, Math.round(((total - prev.total) / hours) * 10) / 10);
    }

    // Collapse a re-run inside the dedupe window instead of appending a duplicate.
    const history = existing.history.filter(p => new Date(p.at).getTime() >= cutoff);
    const last = history[history.length - 1];
    if (last && now.getTime() - new Date(last.at).getTime() < DEDUPE_WINDOW_MS) {
      history[history.length - 1] = point;
    } else {
      history.push(point);
    }

    const next = {
      topicId: id,
      schemaVersion: 1,
      current: { yes, no, total, pct: point.pct, asOf: nowIso, velocity },
      history,
      regions: counts ? buildRegions(counts.regions, country) : existing.regions || [],
      suspect: counts
        ? { ...counts.suspect, total: (counts.suspect.yes || 0) + (counts.suspect.no || 0) }
        : existing.suspect || { yes: 0, no: 0, total: 0 },
    };

    if (dryRun) {
      console.log(`  [dry] ${id}: ${point.pct}% of ${total} · ${history.length} point(s)`);
    } else {
      writeJson(file, next);
      written++;
    }
  }

  console.log(dryRun ? '· dry run, nothing written' : `✓ wrote ${written} tally file(s)`);
}

main().catch(err => { console.error('✗ snapshot failed:', err); process.exit(1); });
