/**
 * Content hash for review decisions.
 *
 * The review issue embeds the hash of what a reviewer was shown. promote-topics.js
 * recomputes it before acting. If they differ, the topic was edited after the
 * issue was rendered and the approval refers to wording nobody signed off on —
 * so the decision is refused rather than applied to the new text.
 *
 * Only the fields a reviewer actually judges are hashed. Deliberately excluded:
 * review.* (which promotion itself mutates), generation.*, bookmarks,
 * activeFrom/activeUntil, trendScore, and sources[].verified — that last one is
 * set by verify-sources.js, which legitimately runs between generation and
 * review, and must not invalidate an approval.
 */
import crypto from 'crypto';

/** JSON with object keys sorted at every depth, so key order cannot change the hash. */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

/** The reviewable substance of a topic. */
export function reviewableOf(topic) {
  return {
    category: topic.category,
    question: topic.question,
    context: topic.context,
    sides: { yes: topic.sides?.yes, no: topic.sides?.no },
    sources: (topic.sources || []).map(s => s.url),
  };
}

export function contentHash(topic) {
  return crypto.createHash('sha256').update(canonicalize(reviewableOf(topic))).digest('hex');
}
