/**
 * Helpers for the server-side web_search tool.
 *
 * The one rule this file exists to enforce: a URL is only ever trusted if the
 * search tool returned it. The model's prose URLs are discarded, always.
 *
 * This is not a style preference. The retired update-news.js accepted any
 * `typeof url === 'string'` straight out of the model's JSON, and that is
 * exactly how the seed topics ended up shipping `verified: true` on links that
 * 404. A liveness check alone does not save you — a hallucinated URL can be
 * plausible enough to resolve to a real but wrong page, and a 200 on the wrong
 * article is worse than a 404 because nobody notices.
 */

/** Strips the <cite> markup the server-side search injects into text blocks. */
export function stripCitations(s) {
  return String(s)
    .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '')
    .replace(/<\/?cite[^>]*>/gi, '')
    .trim();
}

/** Concatenated text of a response, citations removed. */
export function textOf(message) {
  return (message.content || [])
    .filter(b => b.type === 'text')
    .map(b => stripCitations(b.text))
    .join('\n')
    .trim();
}

/**
 * Collects every URL the search tool actually returned, as
 * [{url, title, pageAge}]. Deduped, order preserved.
 *
 * Deliberately tolerant about block shape — this SDK (0.39.0) predates web
 * search and carries no types for it, so the blocks arrive as plain JSON and
 * the exact nesting is the API's to change. Being permissive about *where* a
 * tool-result URL is found is fine; being permissive about whether it came
 * from a tool result at all is not.
 */
export function harvestSearchUrls(message) {
  const out = [];
  const seen = new Set();

  const push = item => {
    if (!item || typeof item.url !== 'string') return;
    if (!/^https?:\/\//i.test(item.url)) return;
    if (seen.has(item.url)) return;
    seen.add(item.url);
    out.push({
      url: item.url,
      title: typeof item.title === 'string' ? item.title : '',
      pageAge: typeof item.page_age === 'string' ? item.page_age : null,
    });
  };

  for (const block of message.content || []) {
    if (block?.type !== 'web_search_tool_result') continue;
    const content = block.content;
    if (Array.isArray(content)) {
      for (const item of content) push(item);
    } else if (content && typeof content === 'object') {
      // Error shape: { type: 'web_search_tool_result_error', error_code }
      if (content.error_code) {
        console.warn(`  · search tool error: ${content.error_code}`);
      } else {
        push(content);
      }
    }
  }

  return out;
}

/**
 * Pulls the first JSON value out of a model response. Never throws — a parse
 * failure returns null so one bad item cannot abort a whole batch.
 */
export function extractJson(text, { array = false } = {}) {
  if (!text) return null;
  const clean = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const match = array ? clean.match(/\[[\s\S]*\]/) : clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

/** True when `iso` parses and falls inside [now - maxAgeDays, now]. */
export function isFresh(iso, maxAgeDays = 30) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t >= now - maxAgeDays * 86_400_000 && t <= now;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
