/**
 * Tests for synthetic sample tallies. Run: npm test
 *
 * These numbers are invented, so the properties that matter are internal
 * coherence (the app must not be able to contradict itself) and determinism
 * (re-seeding must not churn the feed or move the trend at random).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSyntheticTally, hashSeed, mulberry32, HISTORY_POINTS } from './synthetic.js';

const REGIONS = [
  { code: 'IN-KA', label: 'Karnataka' },
  { code: 'IN-DL', label: 'Delhi' },
];

test('is always flagged synthetic', () => {
  assert.equal(buildSyntheticTally('in-2026-09-x').synthetic, true);
});

test('deterministic for the same id', () => {
  const now = new Date('2026-09-24T00:00:00.000Z');
  const a = buildSyntheticTally('in-2026-09-four-day-week', { now });
  const b = buildSyntheticTally('in-2026-09-four-day-week', { now });
  assert.deepEqual(a, b);
});

test('different ids give different numbers', () => {
  const now = new Date('2026-09-24T00:00:00.000Z');
  const a = buildSyntheticTally('in-2026-09-aaa', { now });
  const b = buildSyntheticTally('in-2026-09-bbb', { now });
  assert.notEqual(a.current.total, b.current.total);
});

test('yes + no === total, and pct agrees with the counts', () => {
  for (const id of ['a', 'bb', 'ccc', 'in-2026-09-gig-workers', 'in-2026-01-x']) {
    const t = buildSyntheticTally(id);
    assert.equal(t.current.yes + t.current.no, t.current.total, `${id}: counts must sum`);
    assert.equal(t.current.pct, Math.round((t.current.yes / t.current.total) * 100), `${id}: pct must match counts`);
  }
});

test('emits exactly the number of history points the chart expects', () => {
  const t = buildSyntheticTally('in-2026-09-x');
  assert.equal(t.history.length, HISTORY_POINTS);
});

test('history is chronological, as validate-data.js requires', () => {
  const t = buildSyntheticTally('in-2026-09-x');
  for (let i = 1; i < t.history.length; i++) {
    assert.ok(new Date(t.history[i].at) > new Date(t.history[i - 1].at), `point ${i} out of order`);
  }
});

test('history totals rise — votes accumulate, they do not evaporate', () => {
  const t = buildSyntheticTally('in-2026-09-x');
  for (let i = 1; i < t.history.length; i++) {
    assert.ok(t.history[i].total >= t.history[i - 1].total, `total dropped at ${i}`);
  }
});

test('last history point matches current, so the app cannot contradict itself', () => {
  // The app derives "54% -> 61%" from the ends of this series while also showing
  // current.pct. If they disagreed, one screen would contradict the other.
  for (const id of ['a', 'in-2026-09-x', 'in-2026-09-zzz']) {
    const t = buildSyntheticTally(id);
    const last = t.history[t.history.length - 1];
    assert.equal(last.pct, t.current.pct, `${id}: final trend point must equal current pct`);
    assert.equal(last.total, t.current.total, `${id}: final trend total must equal current total`);
  }
});

test('respects a supplied centerPct', () => {
  const t = buildSyntheticTally('in-2026-09-x', { centerPct: 44 });
  assert.equal(t.current.pct, 44);
});

test('clamps an out-of-range centerPct into the plausible band', () => {
  assert.ok(buildSyntheticTally('in-2026-09-x', { centerPct: 99 }).current.pct <= 70);
  assert.ok(buildSyntheticTally('in-2026-09-x', { centerPct: 1 }).current.pct >= 30);
});

test('stays inside a plausible split without a centerPct', () => {
  for (let i = 0; i < 60; i++) {
    const pct = buildSyntheticTally(`in-2026-09-topic-${i}`).current.pct;
    assert.ok(pct >= 30 && pct <= 70, `pct ${pct} outside 30..70`);
  }
});

test('history pcts stay inside 1..99', () => {
  for (let i = 0; i < 60; i++) {
    for (const p of buildSyntheticTally(`in-2026-09-t${i}`).history) {
      assert.ok(p.pct >= 1 && p.pct <= 99, `history pct ${p.pct} out of range`);
    }
  }
});

test('attributes regions when given, and none when not', () => {
  const withR = buildSyntheticTally('in-2026-09-x', { regions: REGIONS });
  assert.equal(withR.regions.length, 2);
  assert.deepEqual(withR.regions.map(r => r.code), ['IN-KA', 'IN-DL']);
  for (const r of withR.regions) {
    assert.ok(r.votes <= withR.current.total, 'a region cannot hold more votes than the total');
    assert.ok(r.pct >= 1 && r.pct <= 99);
  }
  assert.deepEqual(buildSyntheticTally('in-2026-09-x').regions, []);
});

test('hashSeed is stable and mulberry32 stays in [0,1)', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  const rng = mulberry32(hashSeed('seed'));
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `PRNG out of range: ${v}`);
  }
});
