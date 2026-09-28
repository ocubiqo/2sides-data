/**
 * Tests for rank(). Run: npm test
 *
 * The property this exists to protect: a topic with real, current vote
 * velocity must be able to outrank a higher-trendScore topic that's gone
 * quiet — trending should reflect what's actually happening, not just what
 * looked hot at publish time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from './ranking.js';

const topic = (overrides = {}) => ({
  id: 'in-2026-09-x',
  publishedAt: new Date().toISOString(),
  trendScore: 50,
  ...overrides,
});

const tally = (overrides = {}) => ({
  current: { yes: 0, no: 0, total: 0, pct: 0, velocity: 0, ...overrides },
});

test('a fresh topic with zero votes still scores above zero (cold-start floor)', () => {
  const score = rank(topic(), tally());
  assert.ok(score > 0);
});

test('higher trendScore scores higher, all else equal', () => {
  const low = rank(topic({ trendScore: 20 }), tally());
  const high = rank(topic({ trendScore: 90 }), tally());
  assert.ok(high > low);
});

test('a topic with real vote velocity outranks a same-trendScore topic with none', () => {
  const idle = rank(topic({ trendScore: 50 }), tally({ total: 100, velocity: 0 }));
  const hot = rank(topic({ trendScore: 50 }), tally({ total: 100, velocity: 40 }));
  assert.ok(hot > idle, 'velocity must move the score, not just be carried through unused');
});

test('genuine current velocity can overcome a lower trendScore', () => {
  const highScoreIdle = rank(topic({ trendScore: 90 }), tally({ total: 50, velocity: 0 }));
  const lowScoreHot = rank(topic({ trendScore: 40 }), tally({ total: 50, velocity: 200 }));
  assert.ok(
    lowScoreHot > highScoreIdle,
    'real trending activity should be able to beat a stale editorial guess',
  );
});

test('a huge velocity spike does not let one topic dominate without bound (log-scaled)', () => {
  const modest = rank(topic(), tally({ total: 100, velocity: 50 }));
  const huge = rank(topic(), tally({ total: 100, velocity: 50_000 }));
  // 1000x the velocity should not mean anywhere near 1000x the score.
  assert.ok(huge / modest < 3, `expected sublinear growth, got ${huge / modest}x`);
});

test('negative or missing velocity never lowers the score below the no-velocity case', () => {
  const noField = rank(topic(), { current: { total: 10, pct: 0 } }); // velocity undefined
  const zero = rank(topic(), tally({ total: 10, velocity: 0 }));
  assert.equal(noField, zero);
});

test('older topics decay via recency even with high velocity, consistent with the existing half-life', () => {
  const fresh = rank(
    topic({ publishedAt: new Date().toISOString() }),
    tally({ total: 100, velocity: 20 }),
  );
  const old = rank(
    topic({ publishedAt: new Date(Date.now() - 200 * 3_600_000).toISOString() }),
    tally({ total: 100, velocity: 20 }),
  );
  assert.ok(fresh > old);
});
