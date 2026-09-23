/**
 * The quality gate for generated topics, kept separate from generate-topics.js
 * so it can be tested without an API key. Every rule here exists to stop one
 * specific bad thing reaching a reader:
 *
 *   provenance  → a "Verified" badge on a URL nobody ever fetched
 *   split       → a 90/10 non-debate presented as a national controversy
 *   both cases  → a question where one side has no argument, i.e. one side
 *   neutrality  → wording that tells the reader what to think
 */

export const SPLIT_MIN = 25;
export const SPLIT_MAX = 75;

/** Wording that presupposes its own answer. */
export const LOADED_PATTERNS = [
  /\bshould we stop\b/i, /\bisn'?t it\b/i, /\bobviously\b/i, /\bsurely\b/i,
  /\bshameful\b/i, /\bdisgrace/i, /\bfailed to\b/i, /\brefused to\b/i,
  /\bscandal/i, /\boutrageous\b/i, /\bfinally\b/i, /\bof course\b/i,
];

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

/**
 * @param raw        the model's parsed JSON object
 * @param candidate  the discovery candidate it was generated from
 * @param allowedSet Set of URLs the search tool actually returned
 * @returns {{topic, rationale}} on success, {{reject: string}} on failure
 */
export function vetTopic(raw, candidate, allowedSet) {
  const q = typeof raw?.question === 'string' ? raw.question.trim() : '';
  if (!q) return { reject: 'no question' };
  if (!q.endsWith('?')) return { reject: `question does not end with '?': ${q}` };
  if (q.length < 15 || q.length > 120) return { reject: `question length ${q.length}, need 15-120` };

  const loaded = LOADED_PATTERNS.filter(re => re.test(q));
  if (loaded.length) return { reject: `leading language in question: ${loaded.join(', ')}` };

  if (Array.isArray(raw.loadedWords) && raw.loadedWords.length > 0) {
    return { reject: `model self-reported loaded words: ${raw.loadedWords.join(', ')}` };
  }

  const split = Number(raw.estimatedSplit);
  if (!Number.isFinite(split)) return { reject: 'estimatedSplit missing' };
  if (split < SPLIT_MIN || split > SPLIT_MAX) {
    return { reject: `estimatedSplit ${split} outside ${SPLIT_MIN}-${SPLIT_MAX} — not genuinely contested` };
  }

  const caseYes = typeof raw.caseForYes === 'string' ? raw.caseForYes.trim() : '';
  const caseNo = typeof raw.caseForNo === 'string' ? raw.caseForNo.trim() : '';
  if (!caseYes || !caseNo) return { reject: 'one side has no stated case' };

  const context = typeof raw.context === 'string' ? raw.context.trim() : '';
  if (context.length < 60 || context.length > 320) {
    return { reject: `context length ${context.length}, need 60-320` };
  }

  const yesLabel = typeof raw.sides?.yes === 'string' ? raw.sides.yes.trim() : '';
  const noLabel = typeof raw.sides?.no === 'string' ? raw.sides.no.trim() : '';
  if (!yesLabel || !noLabel) return { reject: 'missing side label' };
  if (yesLabel.length > 18 || noLabel.length > 18) return { reject: 'side label longer than 18 chars' };

  // Provenance. Anything not character-identical to a harvested URL is dropped.
  const proposed = Array.isArray(raw.sources) ? raw.sources : [];
  const sources = [];
  const droppedUrls = [];
  for (const s of proposed) {
    const url = typeof s?.url === 'string' ? s.url.trim() : '';
    if (!allowedSet.has(url)) { droppedUrls.push(url || '(none)'); continue; }
    if (sources.some(existing => existing.url === url)) continue;
    sources.push({
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : hostnameOf(url),
      url,
      // verify-sources.js owns this bit — never authored here.
      verified: false,
      ...(typeof s.publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.publishedAt)
        ? { publishedAt: s.publishedAt } : {}),
    });
  }
  if (sources.length === 0) {
    return { reject: `no source survived the provenance check (dropped: ${droppedUrls.join(', ') || 'none proposed'})` };
  }

  const score = Number(raw.trendScore ?? candidate?.trendScore);

  return {
    topic: {
      question: q,
      context,
      sides: { yes: yesLabel, no: noLabel },
      sources,
      trendScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
    },
    rationale: {
      caseForYes: caseYes,
      caseForNo: caseNo,
      estimatedSplit: Math.round(split),
      droppedUrls,
      candidateHeadline: candidate?.headline ?? '',
    },
  };
}

/** auto_publish tier, promoted to review_required on any escalation keyword. */
export function resolveTier(category, question, context, tiers) {
  const text = `${question} ${context}`.toLowerCase();
  const hit = (tiers.escalation_keywords || []).find(k => text.includes(String(k).toLowerCase()));
  if (hit) return { tier: 'review_required', escalatedBy: hit };
  const auto = (tiers.auto_publish || []).includes(category);
  return { tier: auto ? 'auto_publish' : 'review_required', escalatedBy: null };
}
