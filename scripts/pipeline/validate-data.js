#!/usr/bin/env node
/**
 * validate-data.js — schema-checks every topic and tally file.
 *
 * Runs in CI on every PR. A malformed topic reaches every user at once, so this
 * is the highest-value gate in the repo.
 *
 * Modes:
 *   (default)    validate topics/ and tallies/
 *   --fixtures   validate fixtures/, asserting valid-* pass and invalid-* fail.
 *                Without this, an empty topics/<c>/active/ makes the default
 *                run vacuously green — it would report success having checked
 *                nothing at all.
 *   --dir <p>    validate one directory only (used on topics/IN/pending)
 */

import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { fileURLToPath } from 'url';
import { normalizeQuestion } from './lib/normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const validateTopic = ajv.compile(readJson(path.join(ROOT, 'schemas/topic.schema.json')));
const validateTally = ajv.compile(readJson(path.join(ROOT, 'schemas/tally.schema.json')));

const categories = new Set(readJson(path.join(ROOT, 'config/categories.json')).categories.map(c => c.id));

function parseArgs(argv) {
  const args = { fixtures: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixtures') args.fixtures = true;
    else if (argv[i] === '--dir') args.dir = argv[++i];
  }
  return args;
}

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else if (entry.name.endsWith('.json')) fn(full);
  }
}

/**
 * Resolves dataMode from any published manifest. A missing manifest cannot be
 * "live" — the flip requires an explicit build — so absent defaults to sample.
 */
function resolveDataMode() {
  const feedsDir = path.join(ROOT, 'feeds');
  if (!fs.existsSync(feedsDir)) return 'sample';
  for (const country of fs.readdirSync(feedsDir)) {
    const m = path.join(feedsDir, country, 'manifest.json');
    if (fs.existsSync(m)) {
      try { if (readJson(m).dataMode === 'live') return 'live'; } catch { /* treat as sample */ }
    }
  }
  return 'sample';
}

// ── Per-file checks. Each returns an array of error strings. ──────────────────

function checkTopic(file, seenQuestions, { checkFilename = true } = {}) {
  const errs = [];
  let data;
  try { data = readJson(file); }
  catch (e) { return [`invalid JSON — ${e.message}`]; }

  if (!validateTopic(data)) {
    return validateTopic.errors.map(e => `${e.instancePath || '/'} ${e.message}`);
  }
  // Fixture filenames encode the expected outcome (valid-/invalid-), so they
  // cannot also be the topic id. Every real topic path is still checked.
  if (checkFilename && path.basename(file) !== `${data.id}.json`) {
    errs.push(`filename must be ${data.id}.json`);
  }
  if (!categories.has(data.category)) errs.push(`category "${data.category}" is not in config/categories.json`);
  if (new Date(data.activeUntil) <= new Date(data.activeFrom)) errs.push('activeUntil must be after activeFrom');

  // Exact-duplicate questions. Semantic near-duplicates are caught upstream in
  // discover-topics.js, which uses the same normalizer.
  const key = normalizeQuestion(data.question);
  if (seenQuestions.has(key) && seenQuestions.get(key) !== data.id) {
    errs.push(`duplicate question, already used by ${seenQuestions.get(key)}`);
  }
  seenQuestions.set(key, data.id);

  return errs;
}

function checkTally(file, dataMode) {
  const errs = [];
  let data;
  try { data = readJson(file); }
  catch (e) { return [`invalid JSON — ${e.message}`]; }

  if (!validateTally(data)) {
    return validateTally.errors.map(e => `${e.instancePath || '/'} ${e.message}`);
  }
  if (data.current.yes + data.current.no !== data.current.total) {
    errs.push('current.total must equal yes + no');
  }
  // History is append-only; out-of-order points mean a job wrote a stale snapshot.
  for (let i = 1; i < data.history.length; i++) {
    if (new Date(data.history[i].at) < new Date(data.history[i - 1].at)) {
      errs.push(`history is not chronological at index ${i}`);
      break;
    }
  }
  // The interlock that makes flipping to live safe: synthetic sample tallies
  // must be deleted before dataMode can become "live", or the app would present
  // invented numbers with no sample badge to warn anyone.
  if (data.synthetic === true && dataMode === 'live') {
    errs.push('synthetic tally present while manifest dataMode is "live" — delete synthetic tallies before flipping to live');
  }

  return errs;
}

// ── Modes ────────────────────────────────────────────────────────────────────

function runFixtures() {
  const dir = path.join(ROOT, 'fixtures');
  if (!fs.existsSync(dir)) {
    console.error('✗ fixtures/ not found');
    process.exit(1);
  }

  let failures = 0;
  const files = [];
  walk(dir, f => files.push(f));
  files.sort();

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const base = path.basename(file);
    const isTally = file.includes(`${path.sep}tallies${path.sep}`);
    // Each fixture is judged standalone, so a shared question across fixtures
    // is not reported as a duplicate.
    const errs = isTally
      ? checkTally(file, 'sample')
      : checkTopic(file, new Map(), { checkFilename: false });

    const shouldFail = base.startsWith('invalid-');
    if (shouldFail && errs.length === 0) {
      console.error(`✗ ${rel}: expected to FAIL validation but passed`);
      failures++;
    } else if (!shouldFail && errs.length > 0) {
      console.error(`✗ ${rel}: expected to PASS but failed — ${errs.join('; ')}`);
      failures++;
    } else {
      console.log(`✓ ${rel} ${shouldFail ? `rejected (${errs[0]})` : 'accepted'}`);
    }
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} fixture expectation(s) unmet`);
    process.exit(1);
  }
  console.log(`\n✓ all ${files.length} fixture(s) behaved as expected`);
}

function runReal(onlyDir) {
  const dataMode = resolveDataMode();
  const seenQuestions = new Map();
  let errors = 0;
  let topicCount = 0;
  let tallyCount = 0;

  const report = (file, errs) => {
    const rel = path.relative(ROOT, file);
    for (const e of errs) { console.error(`✗ ${rel}: ${e}`); errors++; }
  };

  if (onlyDir) {
    walk(path.resolve(ROOT, onlyDir), f => { topicCount++; report(f, checkTopic(f, seenQuestions)); });
  } else {
    walk(path.join(ROOT, 'topics'), f => { topicCount++; report(f, checkTopic(f, seenQuestions)); });
    walk(path.join(ROOT, 'tallies'), f => { tallyCount++; report(f, checkTally(f, dataMode)); });
  }

  if (errors > 0) {
    console.error(`\n✗ ${errors} validation error(s)`);
    process.exit(1);
  }
  // Say so out loud when nothing was checked. A silent "valid" over zero files
  // is how an empty active/ directory passes for healthy.
  if (topicCount === 0 && tallyCount === 0) {
    console.log('· validated 0 files — nothing to check (run --fixtures to exercise the rules)');
    return;
  }
  console.log(`✓ ${topicCount} topic(s), ${tallyCount} tally file(s) valid · dataMode=${dataMode}`);
}

const { fixtures, dir } = parseArgs(process.argv.slice(2));
if (fixtures) runFixtures();
else runReal(dir);
