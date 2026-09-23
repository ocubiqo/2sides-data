#!/usr/bin/env node
/**
 * review-issue.js — renders the review issue body, or parses decisions out of it.
 *
 * Kept as a script so the workflows stay thin: YAML is a bad place for parsing
 * logic and an impossible place to test it.
 *
 * Usage:
 *   node scripts/pipeline/review-issue.js render [--country IN]
 *        [--rationale .pipeline/rationale.json] [--out .pipeline/issue-body.md]
 *
 *   node scripts/pipeline/review-issue.js parse --body-file body.md
 *        [--out .pipeline/decisions.json]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { contentHash } from './lib/content-hash.js';
import { renderIssueBody, parseDecisions } from './lib/review-issue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

function parseArgs(argv) {
  const args = {
    command: argv[0], country: 'IN',
    rationale: '.pipeline/rationale.json',
    bodyFile: null, out: null,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--country') args.country = argv[++i];
    else if (a === '--rationale') args.rationale = argv[++i];
    else if (a === '--body-file') args.bodyFile = argv[++i];
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

function write(outPath, content) {
  if (!outPath) { process.stdout.write(content); return; }
  const full = path.resolve(ROOT, outPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  console.error(`✓ wrote ${path.relative(ROOT, full)}`);
}

function doRender(args) {
  const pendingDir = path.join(ROOT, 'topics', args.country, 'pending');
  const files = fs.existsSync(pendingDir)
    ? fs.readdirSync(pendingDir).filter(f => f.endsWith('.json')).sort()
    : [];

  const topics = files
    .map(f => readJson(path.join(pendingDir, f)))
    .filter(t => t?.id)
    .map(topic => ({ topic, hash: contentHash(topic) }));

  if (topics.length === 0) {
    console.error('· nothing pending — no issue to render');
    process.exit(2);   // distinct from a failure; the workflow skips on 2
  }

  const rationale = readJson(path.resolve(ROOT, args.rationale), {}) || {};
  write(args.out, renderIssueBody(topics, rationale));
  console.error(`· rendered ${topics.length} topic(s)`);
}

function doParse(args) {
  if (!args.bodyFile) {
    console.error('✗ parse requires --body-file');
    process.exit(1);
  }
  const body = fs.readFileSync(path.resolve(ROOT, args.bodyFile), 'utf8');
  const decisions = parseDecisions(body);

  if (decisions.ignored.length) {
    console.error(`· ignored ${decisions.ignored.length} checkbox(es) for unknown ids: ${decisions.ignored.join(', ')}`);
  }
  console.error(`· ${decisions.approve.length} approve, ${decisions.reject.length} reject`);

  write(args.out, JSON.stringify(
    { approve: decisions.approve, reject: decisions.reject }, null, 2,
  ) + '\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'render') doRender(args);
else if (args.command === 'parse') doParse(args);
else {
  console.error('✗ usage: review-issue.js <render|parse> [options]');
  process.exit(1);
}
