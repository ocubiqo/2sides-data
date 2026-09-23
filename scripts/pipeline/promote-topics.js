#!/usr/bin/env node
/**
 * promote-topics.js — stage 4: applies review decisions.
 *
 * Moves topics between topics/<c>/{pending,active,rejected}/ based on what a
 * reviewer ticked. Every move is a committed file rename, so the audit trail is
 * git history rather than a database nobody can read.
 *
 * Two refusals matter:
 *   - a content-hash mismatch means the topic changed after the reviewer saw
 *     it, so the approval refers to wording nobody signed off on
 *   - while config/review-tiers.json has autoPublishEnabled:false, nothing is
 *     auto-approved regardless of tier
 *
 * Modes:
 *   --print-hashes            emit {id: hash} for everything pending (used to build the issue)
 *   --decisions <file.json>   apply {"approve":[{id,hash}],"reject":[{id,hash,reason}]}
 *   --expire-stale            reject pending topics past expirePendingHours
 *
 * Usage:
 *   node scripts/pipeline/promote-topics.js --print-hashes [--country IN]
 *   node scripts/pipeline/promote-topics.js --decisions d.json --approver octocat
 *   node scripts/pipeline/promote-topics.js --expire-stale
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { contentHash } from './lib/content-hash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function parseArgs(argv) {
  const args = {
    country: 'IN', decisions: null, approver: null,
    printHashes: false, expireStale: false, dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--decisions') args.decisions = argv[++i];
    else if (a === '--approver') args.approver = argv[++i];
    else if (a === '--print-hashes') args.printHashes = true;
    else if (a === '--expire-stale') args.expireStale = true;
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

const dirs = country => ({
  pending: path.join(ROOT, 'topics', country, 'pending'),
  active: path.join(ROOT, 'topics', country, 'active'),
  rejected: path.join(ROOT, 'topics', country, 'rejected'),
});

function listPending(country) {
  const { pending } = dirs(country);
  if (!fs.existsSync(pending)) return [];
  return fs.readdirSync(pending)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ file: path.join(pending, f), topic: readJson(path.join(pending, f)) }))
    .filter(e => e.topic?.id);
}

function writeTopic(file, topic) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(topic, null, 2) + '\n');
}

function main() {
  const { country, decisions: decisionsPath, approver, printHashes, expireStale, dryRun } =
    parseArgs(process.argv.slice(2));

  const tiers = readJson(path.join(ROOT, 'config/review-tiers.json'), {});
  const d = dirs(country);
  const pending = listPending(country);

  // ── --print-hashes ─────────────────────────────────────────────────────────
  if (printHashes) {
    const out = {};
    for (const { topic } of pending) out[topic.id] = contentHash(topic);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  if (pending.length === 0 && !expireStale) {
    console.log(`· nothing pending in topics/${country}/pending`);
    return;
  }

  const byId = new Map(pending.map(e => [e.topic.id, e]));
  const approve = [];
  const reject = [];

  // ── decisions from the review issue ────────────────────────────────────────
  if (decisionsPath) {
    const decisions = readJson(path.resolve(ROOT, decisionsPath));
    if (!decisions) {
      console.error(`✗ could not read decisions file ${decisionsPath}`);
      process.exit(1);
    }
    if (!approver) {
      console.error('✗ --approver is required when applying decisions');
      process.exit(1);
    }
    for (const item of decisions.approve || []) approve.push(item);
    for (const item of decisions.reject || []) reject.push(item);
  }

  // ── --expire-stale ─────────────────────────────────────────────────────────
  if (expireStale) {
    const maxHours = Number(tiers.expirePendingHours ?? 24);
    const cutoff = Date.now() - maxHours * 3_600_000;
    for (const { topic } of pending) {
      if (approve.some(a => a.id === topic.id) || reject.some(r => r.id === topic.id)) continue;
      const created = new Date(topic.generation?.generatedAt ?? topic.activeFrom ?? 0).getTime();
      if (!Number.isNaN(created) && created < cutoff) {
        // Stale news is worse than no news: a topic nobody reviewed inside the
        // window is about something that has moved on.
        reject.push({ id: topic.id, hash: null, reason: `expired unreviewed after ${maxHours}h` });
      }
    }
  }

  if (approve.length === 0 && reject.length === 0) {
    console.log('· no decisions to apply');
    return;
  }

  const autoPublishEnabled = tiers.autoPublishEnabled === true;
  const now = new Date();
  const nowIso = now.toISOString();
  let failures = 0;
  let promoted = 0;
  let rejectedCount = 0;

  const verifyHash = (entry, expected, action) => {
    if (expected == null) return true;   // --expire-stale carries no hash
    const actual = contentHash(entry.topic);
    if (actual === expected) return true;
    console.error(`✗ ${entry.topic.id}: content changed since review — refusing to ${action}`);
    console.error(`    reviewed: ${expected}`);
    console.error(`    on disk:  ${actual}`);
    failures++;
    return false;
  };

  // ── apply approvals ────────────────────────────────────────────────────────
  for (const item of approve) {
    const entry = byId.get(item.id);
    if (!entry) { console.error(`✗ ${item.id}: not in pending/`); failures++; continue; }
    if (!verifyHash(entry, item.hash, 'publish')) continue;

    // The flag exists so the auto_publish list in config stops reading as a
    // live rule while every topic is in fact gated. Flipping it is one edit.
    if (!autoPublishEnabled && entry.topic.review?.tier === 'auto_publish' && !approver) {
      console.error(`✗ ${item.id}: autoPublishEnabled is false and no human approver given`);
      failures++;
      continue;
    }

    const next = {
      ...entry.topic,
      status: 'published',
      publishedAt: nowIso,
      activeFrom: nowIso,
      review: {
        ...entry.topic.review,
        state: 'approved',
        reviewedBy: approver,
        reviewedAt: nowIso,
        reason: null,
      },
    };
    const dest = path.join(d.active, `${entry.topic.id}.json`);
    if (dryRun) {
      console.log(`  [dry] publish ${entry.topic.id}`);
    } else {
      writeTopic(dest, next);
      fs.unlinkSync(entry.file);
      console.log(`  ✓ published ${entry.topic.id}`);
    }
    promoted++;
  }

  // ── apply rejections ───────────────────────────────────────────────────────
  for (const item of reject) {
    const entry = byId.get(item.id);
    if (!entry) { console.error(`✗ ${item.id}: not in pending/`); failures++; continue; }
    if (!verifyHash(entry, item.hash, 'reject')) continue;

    const next = {
      ...entry.topic,
      status: 'retracted',
      review: {
        ...entry.topic.review,
        state: 'rejected',
        reviewedBy: approver ?? 'automation',
        reviewedAt: nowIso,
        reason: item.reason ?? 'rejected in review',
      },
    };
    const dest = path.join(d.rejected, `${entry.topic.id}.json`);
    if (dryRun) {
      console.log(`  [dry] reject ${entry.topic.id} (${next.review.reason})`);
    } else {
      writeTopic(dest, next);
      fs.unlinkSync(entry.file);
      console.log(`  ✗ rejected ${entry.topic.id} — ${next.review.reason}`);
    }
    rejectedCount++;
  }

  console.log(`\n· ${promoted} published, ${rejectedCount} rejected, ${failures} refused`);
  if (dryRun) console.log('· dry run, nothing moved');

  const remaining = listPending(country).length;
  console.log(`· ${remaining} still pending`);

  if (failures > 0) process.exit(1);
}

main();
