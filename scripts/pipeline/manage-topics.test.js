/**
 * Tests for the admin CLI, run against a throwaway copy of the repo layout so
 * nothing real is touched. Run: npm test
 *
 * The properties worth pinning: files land where the rest of the pipeline
 * expects them; invalid requests write NOTHING (all-or-nothing, including in
 * bulk); dead links block but unreachable ones don't; reopen/retire change
 * only what they were asked to; and free-text input is only ever data.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runManage } from './manage-topics.js';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.parse('2026-10-24T08:00:00Z');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manage-topics-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  for (const f of ['poll-rules.json', 'categories.json', 'review-tiers.json', 'source-allowlist.json']) {
    fs.copyFileSync(path.join(REAL_ROOT, 'config', f), path.join(root, 'config', f));
  }
  for (const sub of ['active', 'rejected', 'pending']) fs.mkdirSync(path.join(root, 'topics/IN', sub), { recursive: true });
  return root;
}
const ls = (root, sub) => fs.readdirSync(path.join(root, 'topics/IN', sub)).sort();
const read = (root, sub, id) => JSON.parse(fs.readFileSync(path.join(root, 'topics/IN', sub, `${id}.json`), 'utf8'));

const live = async () => ({ status: 200, errorKind: null });
const env = (over = {}) => ({
  POLL_REQUESTED_BY: 'ocubiqo',
  POLL_QUESTION: 'Should India hold firm on trade talks with the US?',
  POLL_YES_LABEL: 'HOLD FIRM', POLL_NO_LABEL: 'MAKE A DEAL',
  POLL_CONTEXT: 'Talks have stalled after the latest round without a deal, and both sides are signalling little room left to compromise.',
  POLL_CATEGORY: 'politics', POLL_SOURCE_NAME: 'The Hindu', POLL_SOURCE_URL: 'https://www.thehindu.com/news/a',
  ...over,
});
const run = (root, action, e, extra = {}) => runManage(action, e, { root, now: NOW, checker: live, ...extra });

function seedTopic(root, id, over = {}) {
  const t = {
    id, schemaVersion: 1, contentVersion: 1, country: 'IN', category: 'tech', status: 'published',
    question: `Seed question ${id}?`, context: 'x'.repeat(70), sides: { yes: 'YES', no: 'NO' },
    sources: [{ name: 'Src', url: 'https://example.com/a', verified: false }], tags: [],
    publishedAt: '2026-10-01T00:00:00.000Z', activeFrom: '2026-10-01T00:00:00.000Z',
    activeUntil: '2026-12-01T00:00:00.000Z',
    review: { tier: 'auto_publish', state: 'approved', reviewedBy: 'x', reviewedAt: '2026-10-01T00:00:00.000Z', reason: null },
    generation: { model: 'm', generatedAt: '2026-10-01T00:00:00.000Z' }, bookmarks: 0, ...over,
  };
  fs.writeFileSync(path.join(root, 'topics/IN/active', `${id}.json`), JSON.stringify(t, null, 2));
  return t;
}

// ── create ──────────────────────────────────────────────────────────────────

test('create writes a published topic to active/, named after its id', async () => {
  const root = makeRoot();
  const r = await run(root, 'create', env());
  assert.equal(r.ok, true, r.errors.join());
  const files = ls(root, 'active');
  assert.equal(files.length, 1);
  const t = read(root, 'active', files[0].replace('.json', ''));
  assert.equal(t.status, 'published');
  assert.equal(t.review.reviewedBy, 'ocubiqo');
  assert.ok(r.summaryMd.includes(`/t/${t.id}`));
});

test('a source on the allowlist that answers 200 is badged verified; the check is derived, not authored', async () => {
  const root = makeRoot();
  await run(root, 'create', env());
  const t = read(root, 'active', ls(root, 'active')[0].replace('.json', ''));
  assert.equal(t.sources[0].verified, true);
});

test('dry run validates and reports but writes nothing', async () => {
  const root = makeRoot();
  const r = await run(root, 'create', env(), { dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(ls(root, 'active').length, 0);
  assert.match(r.summaryMd, /dry run/);
});

test('an invalid request writes nothing and reports every problem', async () => {
  const root = makeRoot();
  const r = await run(root, 'create', env({ POLL_QUESTION: 'no', POLL_CATEGORY: 'sport' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
  assert.equal(ls(root, 'active').length, 0);
  assert.match(r.summaryMd, /nothing written/);
});

test('bulk is all-or-nothing: one bad poll in three means none are written', async () => {
  const root = makeRoot();
  const good = i => ({
    question: `Should India adopt policy number ${i} this year?`, yes_label: 'YES', no_label: 'NO',
    context: 'A sufficiently long piece of context that explains why this question matters to people and why it is contested.',
    category: 'tech', source_url: `https://www.thehindu.com/n/${i}`,
  });
  const r = await run(root, 'create', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPICS_JSON: JSON.stringify([good(1), good(2), { ...good(3), category: 'nope' }]) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /poll 3:/);
  assert.equal(ls(root, 'active').length, 0);
});

test('a valid bulk submission writes every poll with distinct ids', async () => {
  const root = makeRoot();
  const mk = q => ({
    question: q, yes_label: 'YES', no_label: 'NO', category: 'tech', source_url: 'https://www.thehindu.com/n/1',
    context: 'A sufficiently long piece of context that explains why this question matters to people and why it is contested.',
  });
  const r = await run(root, 'create', {
    POLL_REQUESTED_BY: 'ocubiqo',
    POLL_TOPICS_JSON: JSON.stringify([mk('Should India ban fireworks this Diwali?'), mk('Should India ban fireworks next Diwali?')]),
  });
  assert.equal(r.ok, true, r.errors.join());
  const ids = ls(root, 'active');
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
});

test('malformed topics_json is rejected cleanly (not JSON, not an array, too many)', async () => {
  const root = makeRoot();
  for (const bad of ['{not json', '{"a":1}', '[]', '[1,2]', JSON.stringify(Array(21).fill({}))]) {
    const r = await run(root, 'create', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPICS_JSON: bad });
    assert.equal(r.ok, false, bad.slice(0, 20));
  }
  assert.equal(ls(root, 'active').length, 0);
});

test('a dead link (404) blocks the poll; an unreachable one (403) only warns', async () => {
  const root = makeRoot();
  const dead = await run(root, 'create', env(), { checker: async () => ({ status: 404, errorKind: null }) });
  assert.equal(dead.ok, false);
  assert.match(dead.errors.join(), /dead/);
  assert.equal(ls(root, 'active').length, 0);

  const blocked = await run(root, 'create', env(), { checker: async () => ({ status: 403, errorKind: null }) });
  assert.equal(blocked.ok, true);
  assert.ok(blocked.changes[0].warnings.some(w => /could not be checked/.test(w)));
  assert.equal(read(root, 'active', ls(root, 'active')[0].replace('.json', '')).sources[0].verified, false);
});

test('skipping the source check never calls the checker', async () => {
  const root = makeRoot();
  const r = await run(root, 'create', env({ POLL_SKIP_SOURCE_CHECK: 'true' }), { checker: async () => { throw new Error('must not be called'); } });
  assert.equal(r.ok, true);
});

test('a duplicate of a question already on disk is rejected, in any state', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-10-seed-one', { question: 'Should India hold firm on trade talks with the US?' });
  const r = await run(root, 'create', env());
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /identical question/);
});

test('requested_by is mandatory: every change must be attributable', async () => {
  const root = makeRoot();
  const r = await run(root, 'create', env({ POLL_REQUESTED_BY: '' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /requested_by/);
});

test('hostile free text is stored verbatim as data and nothing executes', async () => {
  const root = makeRoot();
  const evil = 'Should "$(touch /tmp/pwned)" `id` ; rm -rf / # <script>alert(1)</script> be allowed?';
  const r = await run(root, 'create', env({ POLL_QUESTION: evil }));
  assert.equal(r.ok, true, r.errors.join());
  const t = read(root, 'active', ls(root, 'active')[0].replace('.json', ''));
  assert.equal(t.question, evil);
  assert.ok(!fs.existsSync('/tmp/pwned'));
  assert.match(t.id, /^in-2026-10-[a-z0-9-]+$/); // the id is slugged, never raw text
});

// ── reopen ──────────────────────────────────────────────────────────────────

test('reopen "expired" revives only the lapsed topics and leaves the rest untouched', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-09-lapsed-a', { activeUntil: '2026-10-01T00:00:00.000Z' });
  seedTopic(root, 'in-2026-09-lapsed-b', { activeUntil: '2026-10-20T00:00:00.000Z' });
  const healthy = seedTopic(root, 'in-2026-10-still-open', { activeUntil: '2027-01-01T00:00:00.000Z' });

  const r = await run(root, 'reopen', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPIC_IDS: 'expired' });
  assert.equal(r.ok, true, r.errors.join());
  assert.deepEqual(r.changes.map(c => c.id).sort(), ['in-2026-09-lapsed-a', 'in-2026-09-lapsed-b']);
  assert.ok(Date.parse(read(root, 'active', 'in-2026-09-lapsed-a').activeUntil) > NOW + 3000 * 86_400_000);
  assert.equal(read(root, 'active', 'in-2026-10-still-open').activeUntil, healthy.activeUntil);
});

test('reopen with nothing expired is a successful no-op', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-10-open');
  const r = await run(root, 'reopen', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPIC_IDS: 'expired' });
  assert.equal(r.ok, true);
  assert.equal(r.changes.length, 0);
});

test('reopen by id with open_days gives a time-boxed lifetime', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-09-old', { activeUntil: '2026-10-01T00:00:00.000Z' });
  await run(root, 'reopen', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPIC_IDS: 'in-2026-09-old', POLL_OPEN_DAYS: '5' });
  assert.equal(read(root, 'active', 'in-2026-09-old').activeUntil, new Date(NOW + 5 * 86_400_000).toISOString());
});

test('reopen is all-or-nothing: one unknown id means no topic is changed', async () => {
  const root = makeRoot();
  const t = seedTopic(root, 'in-2026-09-known', { activeUntil: '2026-10-01T00:00:00.000Z' });
  const r = await run(root, 'reopen', { POLL_REQUESTED_BY: 'ocubiqo', POLL_TOPIC_IDS: 'in-2026-09-known,in-2026-09-missing' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /not found/);
  assert.equal(read(root, 'active', 'in-2026-09-known').activeUntil, t.activeUntil);
});

// ── retire ──────────────────────────────────────────────────────────────────

test('retire moves the topic to rejected/ as retracted, recording who and why', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-10-bad-poll');
  const r = await run(root, 'retire', { POLL_REQUESTED_BY: 'priya', POLL_TOPIC_IDS: 'in-2026-10-bad-poll', POLL_REASON: 'factual error in the context' });
  assert.equal(r.ok, true, r.errors.join());
  assert.deepEqual(ls(root, 'active'), []);
  const t = read(root, 'rejected', 'in-2026-10-bad-poll');
  assert.equal(t.status, 'retracted');
  assert.equal(t.review.state, 'rejected');
  assert.equal(t.review.reviewedBy, 'priya');
  assert.equal(t.review.reason, 'factual error in the context');
});

test('retire with one unknown id retires nothing', async () => {
  const root = makeRoot();
  seedTopic(root, 'in-2026-10-a');
  const r = await run(root, 'retire', { POLL_REQUESTED_BY: 'priya', POLL_TOPIC_IDS: 'in-2026-10-a,in-2026-10-nope' });
  assert.equal(r.ok, false);
  assert.deepEqual(ls(root, 'active'), ['in-2026-10-a.json']);
  assert.deepEqual(ls(root, 'rejected'), []);
});

test('path-traversal in a topic id is refused before any file is touched', async () => {
  const root = makeRoot();
  const r = await run(root, 'retire', { POLL_REQUESTED_BY: 'priya', POLL_TOPIC_IDS: '../../config/review-tiers' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /not a valid topic id/);
  assert.ok(fs.existsSync(path.join(root, 'config/review-tiers.json')));
});

test('an unknown action is refused', async () => {
  const r = await run(makeRoot(), 'delete', { POLL_REQUESTED_BY: 'x' });
  assert.equal(r.ok, false);
});
