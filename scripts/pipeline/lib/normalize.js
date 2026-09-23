/**
 * Question normalizer, shared by validate-data.js (exact-duplicate detection)
 * and discover-topics.js (building the recent-questions exclusion list).
 *
 * These two must agree: if discovery normalizes differently from validation,
 * discovery will propose a question validation then rejects as a duplicate, and
 * the batch silently shrinks. One implementation, imported by both.
 */
export function normalizeQuestion(q) {
  return String(q)
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
