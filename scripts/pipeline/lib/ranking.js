/**
 * rank() — the feed-ordering score for one topic. Used by build-feed.js.
 *
 * Four signals, multiplied together:
 *   - recency:    36h half-life decay from publishedAt — fresh stories lead.
 *   - trend:      the hand-set editorial trendScore (0-100), a same-day guess
 *                 made at publish time about how hot a topic looks.
 *   - engagement: log-scaled cumulative vote total — topics with a real
 *                 audience outrank ones nobody's voted on, without letting
 *                 raw count alone dominate (a topic at 10,000 votes isn't
 *                 10,000x more "current" than one at 1).
 *   - velocity:   log-scaled votes/hour since the last snapshot (see
 *                 snapshot-tallies.js's `current.velocity`) — REAL trending,
 *                 not editorial guesswork. A topic actually getting voted on
 *                 right now can rise even if its trendScore undersold it at
 *                 publish time, and a topic that goes quiet again cools back
 *                 down over the next few snapshot cycles as velocity decays.
 *
 * Both engagement and velocity are log-capped so neither one signal — a big
 * historical total, or one short burst — can dominate the score outright
 * (a 1000x velocity spike moves the score by under 2x, not 1000x). Velocity
 * is deliberately weighted heavier than engagement's /6 divisor: engagement
 * rewards a topic for votes it has ALREADY accumulated (slow-moving, mostly
 * a function of age), while velocity is the actual "is this hot right now"
 * signal this feature exists to add — it needs enough weight to visibly
 * move a topic up even against a stale high trendScore, not just nudge it.
 */
export function rank(topic, tally) {
  const hours = (Date.now() - new Date(topic.publishedAt).getTime()) / 3_600_000;
  const recency = Math.pow(0.5, hours / 36);
  const trend = (topic.trendScore || 50) / 100;
  const engagement = Math.log10(Math.max(1, tally.current.total)) / 6;
  const velocity = Math.log10(1 + Math.max(0, tally.current.velocity || 0));
  return trend * recency * (1 + engagement + velocity);
}
