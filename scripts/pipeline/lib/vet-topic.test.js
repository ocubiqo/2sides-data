/**
 * Tests for the topic quality gate. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vetTopic, resolveTier } from './vet-topic.js';

const ALLOWED = new Set([
  'https://www.thehindu.com/business/real-article69100001.ece',
  'https://www.livemint.com/economy/real-11758900000000.html',
]);

const CANDIDATE = { headline: 'Panel proposes gig worker cover', trendScore: 78, category: 'jobs' };

/** A submission that passes everything, so each test can break exactly one thing. */
const good = (over = {}) => ({
  question: 'Should aggregators fund social security for gig workers?',
  context: 'A labour ministry panel wants platforms to fund provident fund and insurance for gig workers. Unions want guaranteed benefits. Aggregators say the levy raises costs and cuts available work.',
  sides: { yes: 'YES', no: 'NO' },
  sources: [{ name: 'The Hindu', url: [...ALLOWED][0], publishedAt: '2026-09-20' }],
  caseForYes: 'Platform work is now a primary income for millions with no safety net.',
  caseForNo: 'A levy raises costs and may reduce the number of gigs available.',
  estimatedSplit: 61,
  loadedWords: [],
  trendScore: 78,
  ...over,
});

const ok = raw => vetTopic(raw, CANDIDATE, ALLOWED);

test('accepts a well-formed two-sided topic', () => {
  const r = ok(good());
  assert.equal(r.reject, undefined);
  assert.equal(r.topic.question, 'Should aggregators fund social security for gig workers?');
  assert.equal(r.topic.sources.length, 1);
  assert.equal(r.rationale.estimatedSplit, 61);
});

test('never marks a source verified — that is verify-sources.js\'s job', () => {
  const r = ok(good({ sources: [{ name: 'X', url: [...ALLOWED][0], verified: true }] }));
  assert.equal(r.topic.sources[0].verified, false);
});

test('drops a source URL that was not returned by search', () => {
  const r = ok(good({
    sources: [
      { name: 'Fake', url: 'https://www.thehindu.com/FABRICATED.ece' },
      { name: 'Real', url: [...ALLOWED][1] },
    ],
  }));
  assert.equal(r.topic.sources.length, 1);
  assert.equal(r.topic.sources[0].url, [...ALLOWED][1]);
  assert.ok(r.rationale.droppedUrls.some(u => u.includes('FABRICATED')));
});

test('rejects the topic outright when every source was fabricated', () => {
  const r = ok(good({ sources: [{ name: 'Fake', url: 'https://evil.example/made-up' }] }));
  assert.match(r.reject, /no source survived the provenance check/);
});

test('rejects a near-miss URL — one edited character is still fabricated', () => {
  const tampered = [...ALLOWED][0].replace('69100001', '69100002');
  const r = ok(good({ sources: [{ name: 'The Hindu', url: tampered }] }));
  assert.match(r.reject, /no source survived/);
});

test('rejects a lopsided split in both directions', () => {
  assert.match(ok(good({ estimatedSplit: 94 })).reject, /not genuinely contested/);
  assert.match(ok(good({ estimatedSplit: 3 })).reject, /not genuinely contested/);
  assert.equal(ok(good({ estimatedSplit: 25 })).reject, undefined, 'boundary is inclusive');
  assert.equal(ok(good({ estimatedSplit: 75 })).reject, undefined, 'boundary is inclusive');
});

test('rejects when one side has no case', () => {
  assert.match(ok(good({ caseForNo: '' })).reject, /one side has no stated case/);
  assert.match(ok(good({ caseForYes: '   ' })).reject, /one side has no stated case/);
});

test('rejects leading language in the question', () => {
  assert.match(ok(good({ question: 'Should we stop wasting money on this scheme?' })).reject, /leading language/);
  assert.match(ok(good({ question: 'Has the government obviously failed to act here?' })).reject, /leading language/);
});

test('respects the model self-reporting loaded words', () => {
  assert.match(ok(good({ loadedWords: ['shameful'] })).reject, /self-reported loaded words/);
});

test('enforces question shape', () => {
  assert.match(ok(good({ question: 'No question mark here' })).reject, /does not end with/);
  assert.match(ok(good({ question: 'Too short?' })).reject, /question length/);
  assert.match(ok(good({ question: 'A'.repeat(121) + '?' })).reject, /question length/);
  assert.match(ok(good({ question: '' })).reject, /no question/);
});

test('enforces context length and side-label length', () => {
  assert.match(ok(good({ context: 'Too brief.' })).reject, /context length/);
  assert.match(ok(good({ sides: { yes: 'A'.repeat(19), no: 'NO' } })).reject, /side label longer/);
  assert.match(ok(good({ sides: { yes: '', no: 'NO' } })).reject, /missing side label/);
});

test('rejects a missing or non-numeric estimatedSplit rather than defaulting it', () => {
  assert.match(ok(good({ estimatedSplit: undefined })).reject, /estimatedSplit missing/);
  assert.match(ok(good({ estimatedSplit: 'quite split' })).reject, /estimatedSplit missing/);
});

test('survives malformed input without throwing', () => {
  for (const bad of [null, undefined, {}, { question: 42 }, { sources: 'nope' }]) {
    const r = vetTopic(bad, CANDIDATE, ALLOWED);
    assert.ok(typeof r.reject === 'string', `expected a reject string for ${JSON.stringify(bad)}`);
  }
});

test('dedupes repeated source URLs', () => {
  const u = [...ALLOWED][0];
  const r = ok(good({ sources: [{ name: 'A', url: u }, { name: 'B', url: u }] }));
  assert.equal(r.topic.sources.length, 1);
});

test('falls back to the hostname when no publisher name is given', () => {
  const r = ok(good({ sources: [{ url: [...ALLOWED][0] }] }));
  assert.equal(r.topic.sources[0].name, 'www.thehindu.com');
});

test('clamps trendScore into 0..100', () => {
  assert.equal(ok(good({ trendScore: 5000 })).topic.trendScore, 100);
  assert.equal(ok(good({ trendScore: -20 })).topic.trendScore, 0);
});

// ── tier resolution ──────────────────────────────────────────────────────────

const TIERS = {
  auto_publish: ['cricket', 'tech', 'bollywood'],
  review_required: ['politics', 'jobs', 'education'],
  escalation_keywords: ['arrest', 'caste', 'communal', 'verdict'],
};

test('auto_publish categories stay auto when nothing escalates', () => {
  assert.deepEqual(resolveTier('cricket', 'Should the IPL keep the rule?', 'A rule change.', TIERS),
    { tier: 'auto_publish', escalatedBy: null });
});

test('review_required categories are never auto', () => {
  assert.equal(resolveTier('politics', 'Should the bill pass?', 'A bill.', TIERS).tier, 'review_required');
});

test('an escalation keyword promotes an auto_publish topic to review', () => {
  // The safety valve: a cricket topic about a match-fixing arrest must not
  // publish unattended just because "cricket" is on the auto list.
  const r = resolveTier('cricket', 'Should the player be banned?', 'Following an arrest this week.', TIERS);
  assert.equal(r.tier, 'review_required');
  assert.equal(r.escalatedBy, 'arrest');
});

test('escalation matching is case-insensitive and scans the question too', () => {
  assert.equal(resolveTier('tech', 'Does the VERDICT change platform rules?', 'A ruling.', TIERS).tier,
    'review_required');
});
