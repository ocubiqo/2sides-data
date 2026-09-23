/**
 * Rendering and parsing of the topic-review issue.
 *
 * The issue body is the review UI: a reviewer ticks boxes in the GitHub app on
 * their phone and that is the whole approval mechanism. Two rules make it safe
 * to trust:
 *
 *  1. Decisions are read ONLY from checkbox state and the hidden
 *     `<!-- topic:<id> hash:<sha> -->` markers. Question and side text is always
 *     re-read from the topic file on disk, never from the issue body — anyone
 *     who can edit an issue could otherwise rewrite what appears to be approved.
 *  2. Unticked means pending. There is no default-yes anywhere.
 */

export const MARKER = '<!-- 2sides-review:v1 -->';

const esc = s => String(s ?? '').replace(/\|/g, '\\|');

/**
 * Builds the issue body.
 * @param topics   [{topic, hash}]
 * @param rationale {[id]: {caseForYes, caseForNo, estimatedSplit, escalatedBy}}
 */
export function renderIssueBody(topics, rationale = {}) {
  const lines = [];

  lines.push(MARKER);
  lines.push('');
  lines.push(`**${topics.length} topic${topics.length === 1 ? '' : 's'} awaiting review.**`);
  lines.push('');
  lines.push('Tick one box per topic, then save. Approve publishes it to the live feed; Reject files it under `rejected/`.');
  lines.push('Leaving both unticked keeps it pending — nothing publishes by accident. Ticking both counts as a rejection.');
  lines.push('');
  lines.push('Editing a topic file after this issue was created will make its decision fail, on purpose: the approval would refer to wording nobody reviewed.');
  lines.push('');

  for (const { topic, hash } of topics) {
    const r = rationale[topic.id] ?? {};
    lines.push('---');
    lines.push('');
    lines.push(`### ${topic.category.toUpperCase()} · \`${topic.review?.tier ?? 'review_required'}\``);
    lines.push(`<!-- topic:${topic.id} hash:${hash} -->`);
    lines.push('');
    lines.push(`## ${esc(topic.question)}`);
    lines.push('');
    lines.push(esc(topic.context));
    lines.push('');
    lines.push(`**${esc(topic.sides?.yes)}** vs **${esc(topic.sides?.no)}**`);
    lines.push('');

    if (r.caseForYes || r.caseForNo) {
      lines.push(`- Case for ${esc(topic.sides?.yes)}: ${esc(r.caseForYes)}`);
      lines.push(`- Case for ${esc(topic.sides?.no)}: ${esc(r.caseForNo)}`);
    }
    if (Number.isFinite(r.estimatedSplit)) {
      lines.push(`- Model's own split estimate: **~${r.estimatedSplit}%** would pick ${esc(topic.sides?.yes)}`);
    }
    if (r.escalatedBy) {
      lines.push(`- ⚠️ Escalated to review by the keyword **${esc(r.escalatedBy)}**`);
    }
    if (Array.isArray(r.droppedUrls) && r.droppedUrls.length) {
      lines.push(`- ${r.droppedUrls.length} proposed URL(s) were discarded as unsourced`);
    }
    lines.push('');

    lines.push('Sources:');
    for (const s of topic.sources ?? []) {
      const badge = s.verified ? '✅ verified' : '⚠️ unverified';
      lines.push(`- [${esc(s.name)}](${s.url}) — ${badge}`);
    }
    lines.push('');

    lines.push(`- [ ] approve \`${topic.id}\``);
    lines.push(`- [ ] reject \`${topic.id}\``);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`<sub>Generated ${new Date().toISOString()} · ids and hashes in HTML comments are what the workflow acts on.</sub>`);

  return lines.join('\n');
}

/**
 * Extracts {id: hash} from the hidden markers. These, not the visible text, are
 * what the workflow trusts.
 */
export function parseMarkers(body) {
  const out = {};
  const re = /<!--\s*topic:([a-z0-9-]+)\s+hash:([a-f0-9]{64})\s*-->/gi;
  let m;
  while ((m = re.exec(body)) !== null) out[m[1]] = m[2].toLowerCase();
  return out;
}

/**
 * Reads ticked checkboxes into decisions.
 *
 * Only ids that have a marker are considered, so a reviewer cannot approve
 * something by typing a new checkbox line for an id the workflow never rendered.
 * Reject wins over approve when both are ticked — the safe direction.
 *
 * @returns {{approve:[{id,hash}], reject:[{id,hash,reason}], ignored:string[]}}
 */
export function parseDecisions(body, { reason = 'rejected in review' } = {}) {
  const markers = parseMarkers(body);
  const ticked = { approve: new Set(), reject: new Set() };
  const ignored = [];

  // - [x] approve `id`   (backticks optional, case- and spacing-tolerant)
  const re = /^\s*[-*]\s*\[\s*([xX])\s*\]\s*(approve|reject)\s+`?([a-z0-9-]+)`?\s*$/gim;
  let m;
  while ((m = re.exec(body)) !== null) {
    const action = m[2].toLowerCase();
    const id = m[3];
    if (!Object.prototype.hasOwnProperty.call(markers, id)) { ignored.push(id); continue; }
    ticked[action].add(id);
  }

  const approve = [];
  const reject = [];
  for (const id of ticked.reject) reject.push({ id, hash: markers[id], reason });
  for (const id of ticked.approve) {
    if (ticked.reject.has(id)) continue;   // both ticked → reject wins
    approve.push({ id, hash: markers[id] });
  }

  return { approve, reject, ignored };
}

/** Strikes through decided blocks and reports who decided what. */
export function annotateDecided(body, decided) {
  let out = body;
  for (const { id, action, actor } of decided) {
    const re = new RegExp(`^(\\s*[-*]\\s*\\[[ xX]\\]\\s*(?:approve|reject)\\s+\`?${id}\`?)\\s*$`, 'gim');
    out = out.replace(re, '$1');
    const marker = new RegExp(`(<!--\\s*topic:${id}\\s+hash:[a-f0-9]{64}\\s*-->)`, 'i');
    out = out.replace(marker, `$1\n\n> **${action.toUpperCase()}** by @${actor} — no further action needed.`);
  }
  return out;
}
