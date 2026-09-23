/**
 * Tests for the review content hash. Run: npm test
 *
 * The property: the hash must change when a reviewer would have judged
 * differently, and must NOT change for edits that happen legitimately between
 * generation and review. Getting the second half wrong makes every approval
 * fail; getting the first half wrong lets edited wording inherit an approval.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, canonicalize, reviewableOf } from './content-hash.js';

const topic = () => ({
  id: 'in-2026-09-x',
  schemaVersion: 1,
  contentVersion: 1,
  country: 'IN',
  category: 'jobs',
  status: 'in_review',
  question: 'Should aggregators fund social security for gig workers?',
  context: 'A panel wants platforms to fund benefits. Unions are for it. Aggregators warn about cost.',
  sides: { yes: 'YES', no: 'NO' },
  sources: [{ name: 'The Hindu', url: 'https://thehindu.com/a', verified: false }],
  tags: [],
  trendScore: 70,
  publishedAt: '2026-09-20T00:00:00.000Z',
  activeFrom: '2026-09-20T00:00:00.000Z',
  activeUntil: '2026-09-27T00:00:00.000Z',
  review: { tier: 'review_required', state: 'pending', reviewedBy: null, reviewedAt: null, reason: null },
  generation: { model: 'm', pipelineRun: 'r', generatedAt: '2026-09-20T00:00:00.000Z', sourceCount: 1 },
  bookmarks: 0,
});

test('stable across repeated calls', () => {
  assert.equal(contentHash(topic()), contentHash(topic()));
});

test('insensitive to key order', () => {
  const a = topic();
  const b = { sources: a.sources, question: a.question, ...a };
  assert.equal(contentHash(a), contentHash(b));
});

test('changes when the question changes', () => {
  const t = topic(); t.question = 'Should platforms fund social security for gig workers?';
  assert.notEqual(contentHash(t), contentHash(topic()));
});

test('changes when the context changes', () => {
  const t = topic(); t.context += ' One more clause.';
  assert.notEqual(contentHash(t), contentHash(topic()));
});

test('changes when a side label changes', () => {
  const t = topic(); t.sides.no = 'OPPOSE';
  assert.notEqual(contentHash(t), contentHash(topic()));
});

test('changes when a source URL changes, even by one character', () => {
  const t = topic(); t.sources[0].url = 'https://thehindu.com/b';
  assert.notEqual(contentHash(t), contentHash(topic()));
});

test('changes when a source is added or removed', () => {
  const added = topic();
  added.sources.push({ name: 'Mint', url: 'https://livemint.com/x', verified: false });
  assert.notEqual(contentHash(added), contentHash(topic()));

  const removed = topic(); removed.sources = [];
  assert.notEqual(contentHash(removed), contentHash(topic()));
});

test('changes when the category changes', () => {
  const t = topic(); t.category = 'politics';
  assert.notEqual(contentHash(t), contentHash(topic()));
});

// ── deliberately NOT part of the hash ────────────────────────────────────────

test('verify-sources flipping `verified` does not invalidate an approval', () => {
  // verify-sources.js legitimately runs between generation and review. If this
  // changed the hash, every single approval would be refused.
  const t = topic(); t.sources[0].verified = true;
  assert.equal(contentHash(t), contentHash(topic()));
});

test('review state, generation metadata and bookmarks do not affect it', () => {
  const t = topic();
  t.review = { tier: 'auto_publish', state: 'approved', reviewedBy: 'octocat', reviewedAt: 'now', reason: 'x' };
  t.generation = { model: 'other', pipelineRun: '99', generatedAt: 'then', sourceCount: 9 };
  t.bookmarks = 5000;
  t.status = 'published';
  assert.equal(contentHash(t), contentHash(topic()));
});

test('activity window and trendScore do not affect it', () => {
  const t = topic();
  t.activeFrom = '2030-01-01T00:00:00.000Z';
  t.activeUntil = '2030-02-01T00:00:00.000Z';
  t.publishedAt = '2030-01-01T00:00:00.000Z';
  t.trendScore = 1;
  assert.equal(contentHash(t), contentHash(topic()));
});

test('a source name change alone does not affect it — only the URL is hashed', () => {
  const t = topic(); t.sources[0].name = 'The Hindu (Business)';
  assert.equal(contentHash(t), contentHash(topic()));
});

// ── canonicalize ─────────────────────────────────────────────────────────────

test('canonicalize sorts nested keys and preserves array order', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ x: { d: 1, c: 2 } }), '{"x":{"c":2,"d":1}}');
  assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  assert.equal(canonicalize(null), 'null');
});

test('reviewableOf exposes only the judged fields', () => {
  assert.deepEqual(Object.keys(reviewableOf(topic())).sort(),
    ['category', 'context', 'question', 'sides', 'sources']);
});
