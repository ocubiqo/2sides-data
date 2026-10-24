/**
 * End-to-end test of build-feed.js on a throwaway tree (FEED_ROOT), run as a
 * real subprocess — the same way the cron runs it. Run: npm test
 *
 * What matters here is the split between the two outputs:
 *   feed.json      what the APP downloads — bounded (top 60)
 *   feed-all.json  what the WEBSITE builds pages from — every open topic
 * and that the "Topic of the day" survives the cap, first in both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { istDate } from './lib/featured.js';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'build-feed.js');
const DAY = 86_400_000;

function makeTree(n) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-feed-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'topics/IN/active'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config/categories.json'), JSON.stringify({
    categories: ['politics', 'cricket', 'tech', 'jobs', 'bollywood', 'education'].map(id => ({ id, label: id, emoji: '', accent: '#000' })),
  }));
  const cats = ['politics', 'cricket', 'tech', 'jobs', 'bollywood', 'education'];
  const now = Date.now();
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = `in-2026-10-topic-${String(i).padStart(3, '0')}`;
    ids.push(id);
    const last = i === n - 1; // the "buried" topic: old and low-significance, so it ranks last
    fs.writeFileSync(path.join(root, 'topics/IN/active', `${id}.json`), JSON.stringify({
      id, schemaVersion: 1, contentVersion: 1, country: 'IN', category: cats[i % cats.length], status: 'published',
      question: `Question number ${i}?`, context: 'c'.repeat(70), sides: { yes: 'YES', no: 'NO' },
      sources: [{ name: 'S', url: 'https://example.com/x', verified: false }], tags: [],
      trendScore: last ? 1 : 60 + (i % 30),
      publishedAt: new Date(now - (last ? 60 * DAY : i * 3_600_000)).toISOString(),
      activeFrom: new Date(now - 90 * DAY).toISOString(),
      activeUntil: new Date(now + 3650 * DAY).toISOString(),
      review: { tier: 'auto_publish', state: 'approved', reviewedBy: 'x', reviewedAt: null, reason: null },
      generation: { model: 'm', generatedAt: new Date(now).toISOString() }, bookmarks: 0,
    }));
  }
  return { root, ids, buried: ids[n - 1] };
}

function build(root) {
  const r = spawnSync('node', [SCRIPT, '--country', 'IN'], {
    env: { ...process.env, FEED_ROOT: root, DATA_MODE: 'live' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const read = f => JSON.parse(fs.readFileSync(path.join(root, 'feeds/IN', f), 'utf8'));
  return { feed: read('feed.json'), all: read('feed-all.json'), manifest: read('manifest.json') };
}

test('the app feed is capped at 60 while the catalogue keeps every open topic', () => {
  const { root } = makeTree(70);
  const { feed, all, manifest } = build(root);
  assert.equal(feed.topics.length, 60);
  assert.equal(all.topics.length, 70);
  assert.equal(manifest.topicCount, 60);
  assert.equal(manifest.catalogueCount, 70);
});

test('the catalogue contains everything the app feed does, with no duplicates', () => {
  const { root } = makeTree(70);
  const { feed, all } = build(root);
  const allIds = all.topics.map(t => t.id);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const t of feed.topics) assert.ok(allIds.includes(t.id), t.id);
});

test('a low-ranked topic is absent from the app feed but present in the catalogue (its page must survive)', () => {
  const { root, buried } = makeTree(70);
  const { feed, all } = build(root);
  assert.ok(!feed.topics.some(t => t.id === buried), 'fixture is wrong: the buried topic made the cap');
  assert.ok(all.topics.some(t => t.id === buried));
});

test('a pinned Topic of the day is included and first in BOTH feeds, even if ranking would have capped it out', () => {
  const { root, buried } = makeTree(70);
  fs.writeFileSync(path.join(root, 'config/featured.json'), JSON.stringify({ pin: { topicId: buried, date: istDate(Date.now()) } }));
  const { feed, all } = build(root);
  for (const f of [feed, all]) {
    assert.equal(f.topics[0].id, buried);
    assert.equal(f.topics[0].featured, true);
    assert.equal(f.featuredTopicId, buried);
    assert.equal(f.topics.filter(t => t.featured).length, 1);
  }
  assert.equal(feed.topics.length, 60, 'the cap must still hold with the featured topic included');
  assert.equal(all.topics.length, 70);
});

test('with few topics, both feeds are identical in content', () => {
  const { root } = makeTree(5);
  const { feed, all } = build(root);
  assert.deepEqual(feed.topics.map(t => t.id), all.topics.map(t => t.id));
});

test('the pick is persisted and sticky: a second build the same day keeps it', () => {
  const { root } = makeTree(12);
  const first = build(root).feed.featuredTopicId;
  const second = build(root).feed.featuredTopicId;
  assert.equal(first, second);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'feeds/IN/featured.json'), 'utf8')).topicId, first);
});

test('an empty active/ still refuses to publish (the guard that surfaced the stale-topics outage)', () => {
  const { root } = makeTree(0);
  const r = spawnSync('node', [SCRIPT, '--country', 'IN'], { env: { ...process.env, FEED_ROOT: root, DATA_MODE: 'live' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /empty feed/);
});
