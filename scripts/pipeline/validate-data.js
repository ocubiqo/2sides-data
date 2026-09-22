#!/usr/bin/env node
/**
 * validate-data.js — schema-checks every topic and tally file.
 *
 * Runs in CI on every PR. A malformed topic reaches every user at once, so this
 * is the highest-value gate in the repo.
 *
 * Usage: node scripts/pipeline/validate-data.js
 */

import fs from 'fs';
import path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '../..');
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const topicSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/topic.schema.json'), 'utf8'));
const tallySchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/tally.schema.json'), 'utf8'));
const validateTopic = ajv.compile(topicSchema);
const validateTally = ajv.compile(tallySchema);

const categories = new Set(
  JSON.parse(fs.readFileSync(path.join(ROOT, 'config/categories.json'), 'utf8'))
    .categories.map(c => c.id),
);

let errors = 0;
const fail = (file, msg) => { console.error(`✗ ${file}: ${msg}`); errors++; };

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else if (entry.name.endsWith('.json')) fn(full);
  }
}

const seenQuestions = new Map();

walk(path.join(ROOT, 'topics'), file => {
  const rel = path.relative(ROOT, file);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fail(rel, `invalid JSON — ${e.message}`); }

  if (!validateTopic(data)) {
    for (const e of validateTopic.errors) fail(rel, `${e.instancePath || '/'} ${e.message}`);
    return;
  }
  if (path.basename(file) !== `${data.id}.json`) fail(rel, `filename must be ${data.id}.json`);
  if (!categories.has(data.category)) fail(rel, `category "${data.category}" is not in config/categories.json`);
  if (new Date(data.activeUntil) <= new Date(data.activeFrom)) fail(rel, 'activeUntil must be after activeFrom');

  // Near-duplicate questions are the most visible quality failure, so catch the
  // exact-match case here; semantic dedupe happens upstream in validate.js.
  const key = data.question.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (seenQuestions.has(key) && seenQuestions.get(key) !== data.id) {
    fail(rel, `duplicate question, already used by ${seenQuestions.get(key)}`);
  }
  seenQuestions.set(key, data.id);
});

walk(path.join(ROOT, 'tallies'), file => {
  const rel = path.relative(ROOT, file);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fail(rel, `invalid JSON — ${e.message}`); }

  if (!validateTally(data)) {
    for (const e of validateTally.errors) fail(rel, `${e.instancePath || '/'} ${e.message}`);
    return;
  }
  if (data.current.yes + data.current.no !== data.current.total) {
    fail(rel, 'current.total must equal yes + no');
  }
  // History is append-only; out-of-order points mean a job wrote a stale snapshot.
  for (let i = 1; i < data.history.length; i++) {
    if (new Date(data.history[i].at) < new Date(data.history[i - 1].at)) {
      return fail(rel, `history is not chronological at index ${i}`);
    }
  }
});

if (errors > 0) {
  console.error(`\n✗ ${errors} validation error(s)`);
  process.exit(1);
}
console.log('✓ all topic and tally files valid');
