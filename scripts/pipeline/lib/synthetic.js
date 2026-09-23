/**
 * Deterministic synthetic tally generation for sample mode.
 *
 * Every number here is invented. The app badges it as sample data and
 * validate-data.js refuses to let a synthetic tally survive the flip to
 * dataMode "live", so it cannot quietly become production truth.
 *
 * Deterministic on the topic id, so re-running the seeder does not churn the
 * numbers. Without that, every batch would rewrite every tally, the feed's
 * content hash would change on each run, and the app would re-download the
 * whole feed for no reason — while the "trend" moved randomly, which for a
 * product whose claim is that the numbers mean something is a bad habit to
 * build even in sample mode.
 */

/** FNV-1a. Small, stable across Node versions, good enough to seed a PRNG. */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny seeded PRNG, uniform enough for this. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const HISTORY_POINTS = 7;
const DAY_MS = 86_400_000;
const TOTAL_MIN = 40_000;
const TOTAL_MAX = 900_000;
const PCT_MIN = 30;
const PCT_MAX = 70;
const MAX_DRIFT = 12;   // percentage points the series may move across the window
const JITTER = 3;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Builds a complete synthetic tally for one topic.
 *
 * @param topicId    seeds the PRNG
 * @param opts.now   Date the series ends at
 * @param opts.centerPct optional target YES share (e.g. the model's
 *                   estimatedSplit) — clamped into PCT_MIN..PCT_MAX
 * @param opts.regions [{code,label}] to attribute a share of the vote to
 */
export function buildSyntheticTally(topicId, { now = new Date(), centerPct = null, regions = [] } = {}) {
  const rng = mulberry32(hashSeed(topicId));

  const total = Math.round(TOTAL_MIN + rng() * (TOTAL_MAX - TOTAL_MIN));

  const target = clamp(
    Number.isFinite(centerPct) ? Math.round(centerPct) : Math.round(PCT_MIN + rng() * (PCT_MAX - PCT_MIN)),
    PCT_MIN, PCT_MAX,
  );

  // Walk backwards from the target so the final point is exactly it: the app
  // derives "54% -> 61%" from the ends of this series, and a last point that
  // disagreed with current.pct would make the app contradict itself.
  const drift = Math.round((rng() * 2 - 1) * MAX_DRIFT);
  const startPct = clamp(target - drift, PCT_MIN - 5, PCT_MAX + 5);

  const history = [];
  for (let i = 0; i < HISTORY_POINTS; i++) {
    const t = i / (HISTORY_POINTS - 1);
    const base = startPct + (target - startPct) * t;
    const jitter = i === HISTORY_POINTS - 1 ? 0 : Math.round((rng() * 2 - 1) * JITTER);
    history.push({
      at: new Date(now.getTime() - (HISTORY_POINTS - 1 - i) * DAY_MS).toISOString(),
      pct: clamp(Math.round(base + jitter), 1, 99),
      // Votes accumulate, so totals rise monotonically to the current figure.
      total: Math.round(total * (0.45 + 0.55 * t)),
    });
  }
  history[history.length - 1].pct = target;
  history[history.length - 1].total = total;

  // Derive yes/no from the target, then recompute pct from them, so
  // yes + no === total and pct agrees with the counts it came from.
  const yes = Math.round((total * target) / 100);
  const no = total - yes;
  const pct = total > 0 ? Math.round((yes / total) * 100) : 0;

  const prev = history[history.length - 2];
  const hours = (now.getTime() - new Date(prev.at).getTime()) / 3_600_000;
  const velocity = hours > 0 ? Math.max(0, Math.round(((total - prev.total) / hours) * 10) / 10) : 0;

  return {
    topicId,
    schemaVersion: 1,
    synthetic: true,
    current: { yes, no, total, pct, asOf: now.toISOString(), velocity },
    history,
    regions: regions.slice(0, 3).map(r => {
      const skew = Math.round((rng() * 2 - 1) * 9);
      const rPct = clamp(pct + skew, 1, 99);
      const rVotes = Math.round(total * (0.04 + rng() * 0.10));
      return { code: r.code, label: r.label, pct: rPct, votes: rVotes };
    }),
    suspect: { yes: 0, no: 0, total: 0 },
  };
}
