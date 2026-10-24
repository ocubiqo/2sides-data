/**
 * Tests for admin-authored topics. Run: npm test
 *
 * What must hold: a valid submission becomes a topic the REAL schema accepts;
 * every invalid input is reported (all at once, field-prefixed) rather than
 * silently coerced; advisory checks never block an admin; duplicates are
 * caught even within one bulk submission; and the shared rules file cannot
 * drift from the schema it mirrors.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildManualTopic } from './manual-topic.js';
import { isOpenEnded } from './topic-lifetime.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const rules = readJson('config/poll-rules.json');
const categoryIds = readJson('config/categories.json').categories.map(c => c.id);
const tiers = readJson('config/review-tiers.json');
const schema = readJson('schemas/topic.schema.json');

const NOW = Date.parse('2026-10-24T08:00:00Z');
const ctx = (over = {}) => ({
  now: NOW, rules, categoryIds, tiers, runId: '12345',
  takenIds: new Set(), takenQuestions: new Set(), ...over,
});
const valid = (over = {}) => ({
  question: 'Should India hold firm on trade talks with the US?',
  yes_label: 'HOLD FIRM', no_label: 'MAKE A DEAL',
  context: 'Talks have stalled after the latest round without a deal, and both sides are signalling little room left to compromise.',
  category: 'politics',
  source_name: 'Forbes India', source_url: 'https://www.forbesindia.com/article/x',
  requested_by: 'ocubiqo',
  ...over,
});

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

test('a valid submission becomes a topic the real JSON schema accepts', () => {
  const r = buildManualTopic(valid(), ctx());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(validateSchema(r.topic), JSON.stringify(validateSchema.errors));
  assert.match(r.topic.id, /^in-2026-10-[a-z0-9-]+$/);
});

test('published directly: approved state, the admin recorded as reviewer, no pending step', () => {
  const { topic } = buildManualTopic(valid({ requested_by: 'priya' }), ctx());
  assert.equal(topic.status, 'published');
  assert.equal(topic.review.state, 'approved');
  assert.equal(topic.review.reviewedBy, 'priya');
  assert.equal(topic.generation.model, 'manual-console');
  assert.equal(topic.generation.pipelineRun, '12345');
});

test('defaults: open-ended lifetime, trendScore 50, no tags, source not yet verified', () => {
  const { topic } = buildManualTopic(valid(), ctx());
  assert.ok(isOpenEnded(topic.activeUntil, NOW));
  assert.equal(topic.trendScore, 50);
  assert.deepEqual(topic.tags, []);
  assert.equal(topic.sources[0].verified, false);
});

test('open_days: 0 / empty are open-ended; N makes a time-boxed topic', () => {
  for (const v of ['', '0']) {
    assert.ok(isOpenEnded(buildManualTopic(valid({ open_days: v }), ctx()).topic.activeUntil, NOW), v);
  }
  const { topic } = buildManualTopic(valid({ open_days: '3' }), ctx());
  assert.equal(topic.activeUntil, new Date(NOW + 3 * 86_400_000).toISOString());
});

test('source name falls back to the hostname; extra links are parsed, deduped and named by host', () => {
  const r = buildManualTopic(valid({
    source_name: '', source_url: 'https://www.thehindu.com/a',
    extra_source_urls: 'https://www.thehindu.com/a, https://indianexpress.com/b\nhttps://scroll.in/c',
  }), ctx());
  assert.deepEqual(r.topic.sources.map(s => s.name), ['thehindu.com', 'indianexpress.com', 'scroll.in']);
});

test('every invalid field is reported, all at once, each prefixed with its field', () => {
  const r = buildManualTopic({
    question: 'too short', yes_label: 'x', no_label: 'x', context: 'short', category: 'sport',
    source_url: 'http://insecure.example.com', open_days: '-2', trend_score: '101', tags: 'Bad Tag!', requested_by: '',
  }, ctx());
  assert.equal(r.ok, false);
  const text = r.errors.join('\n');
  for (const field of ['question', 'context', 'yes_label', 'category', 'source_url', 'open_days', 'trend_score', 'tags', 'requested_by']) {
    assert.ok(text.includes(field), `no error mentions ${field}:\n${text}`);
  }
});

test('boundary lengths: exactly the min and max are accepted, one over is not', () => {
  const q = n => 'a'.repeat(n - 1) + '?';
  assert.equal(buildManualTopic(valid({ question: q(15) }), ctx()).ok, true);
  assert.equal(buildManualTopic(valid({ question: q(120) }), ctx()).ok, true);
  assert.equal(buildManualTopic(valid({ question: q(14) }), ctx()).ok, false);
  assert.equal(buildManualTopic(valid({ question: q(121) }), ctx()).ok, false);
  assert.equal(buildManualTopic(valid({ yes_label: 'a'.repeat(18), no_label: 'b'.repeat(18) }), ctx()).ok, true);
  assert.equal(buildManualTopic(valid({ yes_label: 'a'.repeat(19) }), ctx()).ok, false);
});

test('a question must end with "?"', () => {
  const r = buildManualTopic(valid({ question: 'Hold firm on the US trade talks right now' }), ctx());
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /must end with/);
});

test('identical sides are rejected (case-insensitively)', () => {
  assert.equal(buildManualTopic(valid({ yes_label: 'Agree', no_label: 'AGREE' }), ctx()).ok, false);
});

test('at most 4 sources, https only, credentials in the URL refused', () => {
  const five = Array.from({ length: 4 }, (_, i) => `https://site${i}.example.com/p`).join(' ');
  assert.equal(buildManualTopic(valid({ extra_source_urls: five }), ctx()).ok, false);
  assert.equal(buildManualTopic(valid({ source_url: 'https://user:pw@example.com/a' }), ctx()).ok, false);
  assert.equal(buildManualTopic(valid({ source_url: 'ftp://example.com/a' }), ctx()).ok, false);
  assert.equal(buildManualTopic(valid({ source_url: 'https://localhost/a' }), ctx()).ok, false);
});

test('advisory checks warn but never block: loaded wording and escalation keywords', () => {
  const r = buildManualTopic(valid({
    question: 'Obviously the court verdict should be respected by everyone?',
    context: 'A recent court verdict has divided opinion across the country, with strong views on both sides of the argument today.',
  }), ctx());
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /obviously/i.test(w)), r.warnings.join());
  assert.ok(r.warnings.some(w => /escalation keyword/.test(w)), r.warnings.join());
});

test('a duplicate of an existing question is rejected, ignoring case and punctuation', () => {
  const taken = new Set(['should india hold firm on trade talks with the us']);
  const r = buildManualTopic(valid({ question: 'SHOULD India hold firm on trade talks with the US?!?' + '' }), ctx({ takenQuestions: taken }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /identical question/);
});

test('a bulk submission cannot contain duplicates of itself, and colliding ids get a -2 suffix', () => {
  const c = ctx();
  const a = buildManualTopic(valid(), c);
  const dup = buildManualTopic(valid(), c);
  assert.equal(a.ok, true);
  assert.equal(dup.ok, false);

  // Different wording, same slug -> same base id -> suffixed, not overwritten.
  const sameSlug = buildManualTopic(valid({ question: 'Should India hold firm on trade talks with the UK?' }), c);
  assert.equal(sameSlug.ok, true);
  assert.equal(sameSlug.topic.id, a.topic.id + '-2');
});

test('a failed submission consumes no id and no question slot', () => {
  const c = ctx();
  buildManualTopic(valid({ category: 'nonsense' }), c);
  assert.equal(c.takenIds.size, 0);
  assert.equal(c.takenQuestions.size, 0);
});

test('config/poll-rules.json mirrors schemas/topic.schema.json (drift guard)', () => {
  const p = schema.properties;
  assert.equal(rules.question.min, p.question.minLength);
  assert.equal(rules.question.max, p.question.maxLength);
  assert.equal(rules.context.min, p.context.minLength);
  assert.equal(rules.context.max, p.context.maxLength);
  assert.equal(rules.sideLabel.min, p.sides.properties.yes.minLength);
  assert.equal(rules.sideLabel.max, p.sides.properties.yes.maxLength);
  assert.equal(rules.sources.min, p.sources.minItems);
  assert.equal(rules.sources.max, p.sources.maxItems);
  assert.equal(rules.sourceName.min, p.sources.items.properties.name.minLength);
  assert.equal(rules.sourceName.max, p.sources.items.properties.name.maxLength);
  assert.equal(rules.tags.max, p.tags.maxItems);
  assert.equal(rules.trendScore.min, p.trendScore.minimum);
  assert.equal(rules.trendScore.max, p.trendScore.maximum);
  assert.deepEqual([...categoryIds].sort(), [...p.category.enum].sort());
});
