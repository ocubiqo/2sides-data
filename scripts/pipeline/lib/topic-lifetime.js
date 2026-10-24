/**
 * How long a topic stays open.
 *
 * Topics are meant to stay votable until someone retires them: people find a
 * voting link on social media days or weeks later and expect it to work. The
 * schema requires `activeUntil` to be a date, so "open-ended" is a date far
 * enough away that it never matters — 10 years — rather than a null the rest
 * of the pipeline (build-feed, snapshot, the app's "Closes in" label) would
 * all have to learn to handle.
 *
 * Previously every path hard-coded now + 7 days, which silently emptied the
 * whole site a week after the last batch (the feed refuses to publish empty,
 * so the cron then failed for two weeks).
 */

const DAY_MS = 86_400_000;
export const OPEN_ENDED_YEARS = 10;
/** Anything further out than this is "open-ended" for display purposes. */
const OPEN_ENDED_THRESHOLD_DAYS = 365;

export function openEndedUntil(now = Date.now()) {
  return new Date(now + OPEN_ENDED_YEARS * 365.25 * DAY_MS).toISOString();
}

/**
 * `openDays` of 0, empty or missing means open-ended; a positive number means
 * a deliberately time-boxed topic (e.g. a poll about a specific match).
 * Callers validate the range; this just maps the value.
 */
export function activeUntilFor(now, openDays) {
  const n = Number(openDays);
  if (!Number.isFinite(n) || n <= 0) return openEndedUntil(now);
  return new Date(now + n * DAY_MS).toISOString();
}

export function isOpenEnded(activeUntil, now = Date.now()) {
  return Date.parse(activeUntil) - now > OPEN_ENDED_THRESHOLD_DAYS * DAY_MS;
}
