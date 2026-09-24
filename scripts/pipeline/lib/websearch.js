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

/**
 * Structural taxonomy markers. If any of these appears as a literal path
 * segment, the URL is almost never an individual article — real CMSes reserve
 * these paths for the archive/listing itself, not for a specific story.
 */
const HUB_PATH_MARKERS = new Set([
  'category', 'categories', 'tag', 'tags', 'topic', 'topics',
  'section', 'sections', 'author', 'authors', 'archive', 'archives',
]);

/**
 * Generic subject words that, standing alone as the FINAL path segment, mean
 * the URL ends at a section front page rather than a specific piece — e.g.
 * theprint.in/category/politics/ or businesstoday.in/latest/politics.
 * Checked only against the last segment, so an article whose slug merely
 * *contains* one of these words (common) is unaffected.
 */
const GENERIC_LAST_SEGMENT = new Set([
  'politics', 'business', 'sports', 'entertainment', 'technology',
  'national', 'world', 'opinion', 'news', 'latest', 'general', 'india',
  'public-policy', 'economy',
]);

/**
 * Heuristic: true when a URL looks like a specific article rather than a
 * category/section/tag hub page.
 *
 * This matters because provenance and liveness are not enough. A hub page is
 * a real URL the search tool genuinely returned, and it resolves with a 2xx —
 * so it clears both of those gates — but it doesn't lead a reader to a story,
 * only to an index of many. Know More should point at one piece of reporting
 * or nothing; a source that "answers" every question in a category isn't
 * really sourcing any of them.
 *
 * Pattern matching, not content inspection, so it is necessarily imperfect —
 * it errs toward rejecting ambiguous cases. Losing a plausibly-good source is
 * the safe failure mode here; keeping a bad one is not.
 */
export function looksLikeArticleUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }

  // Wikipedia's /wiki/Specific_Title pages are always a specific subject.
  if (/(^|\.)wikipedia\.org$/i.test(u.hostname) && /^\/wiki\//i.test(u.pathname)) return true;

  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;   // bare homepage

  if (segments.some(s => HUB_PATH_MARKERS.has(s.toLowerCase()))) return false;

  const last = segments[segments.length - 1].toLowerCase();
  if (GENERIC_LAST_SEGMENT.has(last)) return false;

  // Real article slugs/ids are almost always either multi-word-hyphenated or
  // carry a numeric id/date — include the query string too, since some CMSes
  // (government sites especially) put the id there instead of the path.
  const hyphenCount = (last.match(/-/g) || []).length;
  const hasNumericId = /\d{4,}/.test(last + u.search) || /\d{4}[-/]\d{2}[-/]\d{2}/.test(u.pathname);

  return hyphenCount >= 2 || hasNumericId;
}

/**
 * Filters a harvested-URL list down to ones that look like specific articles.
 * Applied once, at discovery, so generate-topics.js is never offered a hub
 * page to cite in the first place.
 */
export function filterArticleUrls(urls) {
  return urls.filter(u => looksLikeArticleUrl(u.url));
}

/** True when `iso` parses and falls inside [now - maxAgeDays, now]. */
export function isFresh(iso, maxAgeDays = 30) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t >= now - maxAgeDays * 86_400_000 && t <= now;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
