/**
 * Tests for review-issue rendering and checkbox parsing. Run: npm test
 *
 * This is the approval mechanism: someone ticks a box in the GitHub mobile app
 * and a topic goes live to every user. The properties under test are that
 * nothing publishes by default, and that editing the issue body cannot approve
 * something the workflow never rendered.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIssueBody, parseDecisions, parseMarkers } from './review-issue.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const topic = (id, over = {}) => ({
  id,
  category: 'jobs',
  question: 'Should aggregators fund social security for gig workers?',
  context: 'A panel wants platforms to fund benefits. Unions are for it. Aggregators warn about cost.',
  sides: { yes: 'YES', no: 'NO' },
  sources: [{ name: 'The Hindu', url: 'https://thehindu.com/a', verified: true }],
  review: { tier: 'review_required', state: 'pending' },
  ...over,
});

const bodyFor = (ids, rationale = {}) =>
  renderIssueBody(ids.map((id, i) => ({ topic: topic(id), hash: i === 0 ? HASH_A : HASH_B })), rationale);

// ── rendering ────────────────────────────────────────────────────────────────

test('renders a marker and two unticked boxes per topic', () => {
  const body = bodyFor(['in-2026-09-a']);
  assert.match(body, /<!-- topic:in-2026-09-a hash:a{64} -->/);
  assert.match(body, /- \[ \] approve `in-2026-09-a`/);
  assert.match(body, /- \[ \] reject `in-2026-09-a`/);
  assert.ok(!body.includes('- [x]'), 'nothing may be pre-ticked');
});

test('includes the review rationale when present', () => {
  const body = bodyFor(['in-2026-09-a'], {
    'in-2026-09-a': {
      caseForYes: 'No safety net today.', caseForNo: 'Costs rise.',
      estimatedSplit: 61, escalatedBy: 'arrest', droppedUrls: ['https://bad.example'],
    },
  });
  assert.match(body, /Case for YES: No safety net today\./);
  assert.match(body, /~61%/);
  assert.match(body, /Escalated to review by the keyword \*\*arrest\*\*/);
  assert.match(body, /1 proposed URL\(s\) were discarded/);
});

test('flags an unverified source in the rendered body', () => {
  const t = topic('in-2026-09-a', { sources: [{ name: 'X', url: 'https://x.example', verified: false }] });
  const body = renderIssueBody([{ topic: t, hash: HASH_A }]);
  assert.match(body, /⚠️ unverified/);
});

test('parseMarkers round-trips what render wrote', () => {
  const markers = parseMarkers(bodyFor(['in-2026-09-a', 'in-2026-09-b']));
  assert.deepEqual(markers, { 'in-2026-09-a': HASH_A, 'in-2026-09-b': HASH_B });
});

// ── parsing: the safety properties ───────────────────────────────────────────

test('an untouched issue yields no decisions', () => {
  const d = parseDecisions(bodyFor(['in-2026-09-a', 'in-2026-09-b']));
  assert.deepEqual(d.approve, []);
  assert.deepEqual(d.reject, []);
});

test('a ticked approve box yields one approval carrying its hash', () => {
  const body = bodyFor(['in-2026-09-a']).replace('- [ ] approve', '- [x] approve');
  const d = parseDecisions(body);
  assert.deepEqual(d.approve, [{ id: 'in-2026-09-a', hash: HASH_A }]);
  assert.deepEqual(d.reject, []);
});

test('a ticked reject box carries a reason', () => {
  const body = bodyFor(['in-2026-09-a']).replace('- [ ] reject', '- [x] reject');
  const d = parseDecisions(body);
  assert.equal(d.reject.length, 1);
  assert.equal(d.reject[0].id, 'in-2026-09-a');
  assert.ok(d.reject[0].reason);
  assert.deepEqual(d.approve, []);
});

test('both ticked is a rejection, never a publish', () => {
  const body = bodyFor(['in-2026-09-a'])
    .replace('- [ ] approve', '- [x] approve')
    .replace('- [ ] reject', '- [x] reject');
  const d = parseDecisions(body);
  assert.deepEqual(d.approve, [], 'an ambiguous decision must not publish');
  assert.equal(d.reject.length, 1);
});

test('IGNORES a checkbox for an id that has no marker', () => {
  // Anyone who can edit an issue could otherwise type a new line to approve a
  // topic the workflow never rendered.
  const body = bodyFor(['in-2026-09-a']) + '\n- [x] approve `in-2026-09-smuggled`\n';
  const d = parseDecisions(body);
  assert.deepEqual(d.approve.map(a => a.id), []);
  assert.deepEqual(d.ignored, ['in-2026-09-smuggled']);
});

test('a forged marker cannot approve, because promote rechecks the hash', () => {
  // A forged marker does get parsed here — it is promote-topics.js that refuses
  // it, since the hash will not match the file on disk. What matters at this
  // layer is that the hash travels from the marker and is never invented.
  const forged = 'c'.repeat(64);
  const body = `<!-- topic:in-2026-09-x hash:${forged} -->\n- [x] approve \`in-2026-09-x\`\n`;
  const d = parseDecisions(body);
  assert.equal(d.approve[0].hash, forged, 'hash must come from the marker verbatim');
});

test('tolerates checkbox formatting variation', () => {
  const variants = [
    '- [X] approve `in-2026-09-a`',
    '-  [x]  approve  in-2026-09-a',
    '* [x] approve `in-2026-09-a`',
  ];
  for (const line of variants) {
    const body = `<!-- topic:in-2026-09-a hash:${HASH_A} -->\n${line}\n`;
    assert.equal(parseDecisions(body).approve.length, 1, `failed on: ${line}`);
  }
});

test('does not treat prose mentioning approve as a decision', () => {
  const body = bodyFor(['in-2026-09-a']) + '\nI think we should approve `in-2026-09-a` tomorrow.\n';
  assert.deepEqual(parseDecisions(body).approve, []);
});

test('an empty or garbage body yields no decisions rather than throwing', () => {
  for (const b of ['', 'nonsense', '- [x] approve', '<!-- topic:x hash:short -->']) {
    const d = parseDecisions(b);
    assert.deepEqual(d.approve, []);
    assert.deepEqual(d.reject, []);
  }
});

test('handles a mixed batch', () => {
  let body = bodyFor(['in-2026-09-a', 'in-2026-09-b']);
  body = body.replace('- [ ] approve `in-2026-09-a`', '- [x] approve `in-2026-09-a`');
  body = body.replace('- [ ] reject `in-2026-09-b`', '- [x] reject `in-2026-09-b`');
  const d = parseDecisions(body);
  assert.deepEqual(d.approve.map(a => a.id), ['in-2026-09-a']);
  assert.deepEqual(d.reject.map(r => r.id), ['in-2026-09-b']);
});
