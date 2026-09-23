/**
 * Source liveness classification, separated from the script so it is testable
 * without network access.
 *
 * The distinction that matters: "this URL is dead" and "this server would not
 * talk to a GitHub runner" look almost identical over HTTP, and conflating them
 * is expensive in both directions. Treat a bot-wall 403 as dead and the
 * pipeline strips perfectly good Indian news sources until batches starve.
 * Treat a 404 as a maybe and the app ships Know More buttons that lead nowhere,
 * which is the failure the seed data already shipped once.
 *
 * So: only an unambiguous "this does not exist" strips a source. Everything
 * uncertain is kept and simply not badged.
 */

export const OUTCOME = {
  VERIFIED: 'verified',        // 2xx and on the allowlist  → badge it
  LIVE_UNLISTED: 'unlisted',   // 2xx, not on the allowlist  → keep, no badge
  UNVERIFIABLE: 'unverifiable',// blocked/rate-limited/down  → keep, no badge
  DEAD: 'dead',                // definitively gone          → strip the source
};

/** Registrable-domain suffix match, so thehindu.com covers www.thehindu.com. */
export function isAllowlisted(url, domains) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return domains.some(d => {
    const dom = String(d).toLowerCase();
    return host === dom || host.endsWith(`.${dom}`);
  });
}

/**
 * Maps a probe result to an outcome.
 * @param status  HTTP status, or 0 when the request never completed
 * @param errorKind 'dns' | 'timeout' | 'network' | null
 */
export function classify({ status, errorKind = null }, allowlisted) {
  // DNS failure is the one network error that means "this host does not exist".
  if (errorKind === 'dns') return OUTCOME.DEAD;
  // A timeout or reset says nothing about whether the page exists.
  if (errorKind) return OUTCOME.UNVERIFIABLE;

  if (status >= 200 && status < 300) {
    return allowlisted ? OUTCOME.VERIFIED : OUTCOME.LIVE_UNLISTED;
  }
  // 404/410 are the only statuses that assert absence. 403/429/5xx are the
  // server declining to serve *us*, which is routine for news sites facing a
  // datacentre IP, and 401 means gated, not gone.
  if (status === 404 || status === 410) return OUTCOME.DEAD;
  return OUTCOME.UNVERIFIABLE;
}

/** True when a HEAD result warrants retrying as a ranged GET. */
export function shouldRetryWithGet(status) {
  // Plenty of servers simply do not implement HEAD, or reject it specifically.
  return status === 403 || status === 405 || status === 501 || status === 400 || status === 429;
}
