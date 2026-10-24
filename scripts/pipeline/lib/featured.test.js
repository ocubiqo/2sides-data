/**
 * Tests for the "Topic of the day" pick. Run: npm test
 *
 * What must hold: the editorial significance signal dominates, real heat
 * (contested split, volume, velocity) breaks ties between equals, thin data
 * is not over-trusted, the pick is sticky within an IST day, rotates on the
 * next day, and an admin pin is date-scoped so it can never get stuck.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDate, heatScore, resolveFeatured } from './featured.js';

const NOW = Date.parse('2026-10-24T08:00:00Z'); // 13:30 IST, 24 Oct
const topic = (o = {}) => ({ trendScore: 50, publishedAt: '2026-10-23T08:00:00Z', ...o });
const tally = (total, pct, velocity = 0) => ({ current: { total, pct, velocity } });

test('istDate: the day rolls over at 18:30 UTC, not midnight UTC', () => {
  assert.equal(istDate(Date.parse('2026-10-24T18:29:00Z')), '2026-10-24');
  assert.equal(istDate(Date.parse('2026-10-24T18:31:00Z')), '2026-10-25');
});

test('a contested split outscores a lopsided one at equal volume', () => {
  const heated = heatScore(topic(), tally(200, 51), NOW);
  const consensus = heatScore(topic(), tally(200, 95), NOW);
  assert.ok(heated > consensus);
});

test('thin data is not over-trusted: 50/50 off 3 votes does not beat 50/50 off 300', () => {
  assert.ok(heatScore(topic(), tally(300, 50), NOW) > heatScore(topic(), tally(3, 50), NOW));
});

test('a topic with zero votes still gets a finite positive score (cold start can still be featured)', () => {
  const s = heatScore(topic(), tally(0, 0), NOW);
  assert.ok(Number.isFinite(s) && s > 0);
});

test('editorial significance dominates: a high-impact topic beats a barely-voted-on low-impact one', () => {
  const big = heatScore(topic({ trendScore: 90 }), tally(40, 60), NOW);
  const small = heatScore(topic({ trendScore: 30 }), tally(40, 50), NOW);
  assert.ok(big > small);
});

test('live voting velocity raises the score', () => {
  assert.ok(heatScore(topic(), tally(100, 55, 40), NOW) > heatScore(topic(), tally(100, 55, 0), NOW));
});

test('freshness is a mild preference only: a month-old topic still scores well above zero', () => {
  const old = heatScore(topic({ publishedAt: '2026-09-20T00:00:00Z' }), tally(200, 50), NOW);
  const fresh = heatScore(topic(), tally(200, 50), NOW);
  assert.ok(old > 0.35 * fresh && old < fresh);
});

const cands = [
  { id: 'a', heat: 5, publishedAt: '2026-10-20T00:00:00Z' },
  { id: 'b', heat: 9, publishedAt: '2026-10-21T00:00:00Z' },
  { id: 'c', heat: 7, publishedAt: '2026-10-22T00:00:00Z' },
];

test('no candidates -> null', () => {
  assert.equal(resolveFeatured({ candidates: [], stored: null, pin: null, now: NOW }), null);
});

test('new day with no history picks the hottest', () => {
  const r = resolveFeatured({ candidates: cands, stored: null, pin: null, now: NOW });
  assert.deepEqual(r, { date: '2026-10-24', topicId: 'b', source: 'auto' });
});

test("sticky: today's earlier pick survives a rebuild even if another topic got hotter", () => {
  const stored = { date: '2026-10-24', topicId: 'a', source: 'auto' };
  const r = resolveFeatured({ candidates: cands, stored, pin: null, now: NOW });
  assert.equal(r.topicId, 'a');
});

test("rotates: a new day excludes yesterday's pick even though it is still the hottest", () => {
  const stored = { date: '2026-10-23', topicId: 'b', source: 'auto' };
  const r = resolveFeatured({ candidates: cands, stored, pin: null, now: NOW });
  assert.equal(r.topicId, 'c');
});

test("the only open topic is still featured even if it was yesterday's pick", () => {
  const stored = { date: '2026-10-23', topicId: 'a', source: 'auto' };
  const r = resolveFeatured({ candidates: [cands[0]], stored, pin: null, now: NOW });
  assert.equal(r.topicId, 'a');
});

test("a pin for today overrides both the auto pick and today's sticky pick", () => {
  const stored = { date: '2026-10-24', topicId: 'b', source: 'auto' };
  const r = resolveFeatured({ candidates: cands, stored, pin: { topicId: 'a', date: '2026-10-24' }, now: NOW });
  assert.deepEqual(r, { date: '2026-10-24', topicId: 'a', source: 'pinned' });
});

test('a pin for another date is ignored, so a stale pin can never get stuck', () => {
  const r = resolveFeatured({ candidates: cands, stored: null, pin: { topicId: 'a', date: '2026-10-23' }, now: NOW });
  assert.equal(r.topicId, 'b');
});

test('a pin on a topic that is no longer open falls back to the auto pick', () => {
  const r = resolveFeatured({ candidates: cands, stored: null, pin: { topicId: 'gone', date: '2026-10-24' }, now: NOW });
  assert.equal(r.topicId, 'b');
});

test('ties break deterministically (newest, then id) regardless of input order', () => {
  const tied = [
    { id: 'x', heat: 3, publishedAt: '2026-10-20T00:00:00Z' },
    { id: 'y', heat: 3, publishedAt: '2026-10-22T00:00:00Z' },
  ];
  const fwd = resolveFeatured({ candidates: tied, stored: null, pin: null, now: NOW });
  const rev = resolveFeatured({ candidates: [...tied].reverse(), stored: null, pin: null, now: NOW });
  assert.equal(fwd.topicId, 'y');
  assert.deepEqual(fwd, rev);
});
