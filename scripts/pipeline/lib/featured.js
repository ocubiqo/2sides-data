/**
 * "Topic of the day" — pick one open topic per IST day to feature: the most
 * heated, significant, high-impact one.
 *
 * "Heated" and "significant" are different things, and only one of them is
 * computable, so the score combines both:
 *   - significance / fame / impact is an editorial judgment made when the
 *     topic was researched — that is exactly what `trendScore` (0-100) is,
 *     and it is the dominant term;
 *   - heat is measured from real votes: how contested the split is (a 52/48
 *     argument is hotter than a 97/3 consensus), how many people have voted,
 *     and how fast votes are arriving right now (snapshot velocity).
 *
 * Pure functions only (no fs, no Date.now()) so the whole policy is unit
 * tested; build-feed.js owns reading/writing the files.
 */

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD of `now` in India Standard Time — the day boundary the audience actually lives in. */
export function istDate(now) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Higher = hotter. `tally` is the same `{ current: { total, pct, velocity } }`
 * shape build-feed.js already holds per topic.
 *
 * - contention: 1.0 at a dead heat, 0 when unanimous. Weighted by
 *   `confidence` so a 50/50 off three votes cannot masquerade as a hot
 *   debate; with thin data it stays at a neutral baseline instead.
 * - engagement/velocity: log-scaled, same shapes as ranking.js, so one burst
 *   or one huge total can't run away with the score.
 * - freshness: a mild one-week half-life with a floor, so a brand-new big
 *   story is favoured but a long-running, still-fiercely-argued evergreen
 *   topic remains eligible (topics are open-ended by design).
 */
export function heatScore(topic, tally, now) {
  const total = tally?.current?.total ?? 0;
  const pct = tally?.current?.pct ?? 50;
  const velocity = Math.max(0, tally?.current?.velocity ?? 0);

  const significance = (topic.trendScore ?? 50) / 100;
  const confidence = Math.min(1, total / 20);
  const contention = total > 0 ? 1 - Math.abs(pct - 50) / 50 : 0;
  const heat = 0.5 + contention * confidence; // 0.5 (cold/unknown) .. 1.5 (dead heat, well-voted)
  const engagement = Math.log10(Math.max(1, total)) / 6;
  const velocityBoost = Math.log10(1 + velocity);

  const ageDays = Math.max(0, (now - Date.parse(topic.publishedAt)) / DAY_MS);
  const freshness = 0.4 + 0.6 * Math.pow(0.5, ageDays / 7);

  return significance * heat * (1 + engagement + velocityBoost) * freshness;
}

/**
 * Decide today's featured topic.
 *
 * @param candidates  [{ id, heat, publishedAt }] — every open topic
 * @param stored      last persisted pick `{ date, topicId, source }` or null
 * @param pin         admin override `{ topicId, date }` or null
 * @param now         epoch ms
 * @returns `{ date, topicId, source: 'pinned' | 'auto' }` or null if no candidates
 *
 * Rules, in order:
 *  1. A pin for TODAY wins, if that topic is still open.
 *  2. Otherwise today's earlier pick sticks — the 6-hourly rebuilds must not
 *     flip the tag around mid-day.
 *  3. Otherwise (new day) pick the hottest, excluding yesterday's pick so the
 *     tag actually rotates — unless it is the only topic.
 */
export function resolveFeatured({ candidates, stored, pin, now }) {
  if (!candidates.length) return null;
  const today = istDate(now);
  const ids = new Set(candidates.map(c => c.id));

  if (pin && pin.date === today && ids.has(pin.topicId)) {
    return { date: today, topicId: pin.topicId, source: 'pinned' };
  }
  if (stored && stored.date === today && ids.has(stored.topicId)) {
    return { date: today, topicId: stored.topicId, source: stored.source ?? 'auto' };
  }

  const previousId = stored?.topicId;
  const pool = candidates.length > 1 && previousId
    ? candidates.filter(c => c.id !== previousId)
    : candidates;

  // Deterministic: highest heat, then newest, then id — never depends on file order.
  const best = [...pool].sort((a, b) =>
    (b.heat - a.heat) ||
    (Date.parse(b.publishedAt) - Date.parse(a.publishedAt)) ||
    (a.id < b.id ? -1 : 1),
  )[0];

  return { date: today, topicId: best.id, source: 'auto' };
}
