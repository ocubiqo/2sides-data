/**
 * HTTP liveness probe — shared by verify-sources.js (batch pipeline) and
 * manage-topics.js (admin-created polls), so a link is judged the same way no
 * matter which path published it. Outcome classification lives in
 * liveness.js; this file only performs the request.
 */
import { shouldRetryWithGet } from './liveness.js';

// A real browser UA. Several Indian news sites return 403 to anything that
// looks automated, and being blocked is not evidence that a page is missing.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';


function errorKindOf(err) {
  const code = err?.cause?.code || err?.code || '';
  if (err?.name === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  return 'network';
}

async function probe(url, timeoutMs, method = 'HEAD') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        ...(method === 'GET' ? { Range: 'bytes=0-1024' } : {}),
      },
    });
    return { status: res.status, errorKind: null };
  } catch (err) {
    return { status: 0, errorKind: errorKindOf(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** HEAD, then a ranged GET for servers that refuse HEAD specifically. */
export async function checkUrl(url, timeoutMs) {
  let result = await probe(url, timeoutMs, 'HEAD');
  if (result.errorKind === null && shouldRetryWithGet(result.status)) {
    const retried = await probe(url, timeoutMs, 'GET');
    // Keep whichever attempt got further — a GET 200 after a HEAD 403 means live.
    if (retried.errorKind === null && retried.status >= 200 && retried.status < 300) return retried;
    result = retried.errorKind === null ? retried : result;
  }
  return result;
}
