/**
 * Tests for the URL-provenance rule. Run: npm test
 *
 * These guard the single property the whole content pipeline's credibility
 * rests on: a source URL is trusted only if the search tool returned it.
 * If harvestSearchUrls ever starts accepting model-authored URLs, the app
 * goes back to shipping "Verified" badges on links that 404.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harvestSearchUrls, stripCitations, textOf, extractJson, isFresh,
} from './websearch.js';

test('harvests URLs from web_search_tool_result blocks', () => {
  const msg = {
    content: [{
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', url: 'https://a.example/1', title: 'A', page_age: '2 days ago' },
        { type: 'web_search_result', url: 'https://b.example/2', title: 'B' },
      ],
    }],
  };
  assert.deepEqual(harvestSearchUrls(msg).map(u => u.url), ['https://a.example/1', 'https://b.example/2']);
  assert.equal(harvestSearchUrls(msg)[0].pageAge, '2 days ago');
});

test('IGNORES URLs that appear only in model prose', () => {
  const msg = {
    content: [
      { type: 'web_search_tool_result', content: [{ url: 'https://real.example/found' }] },
      { type: 'text', text: 'I also recommend https://fabricated.example/invented and http://another.example/made-up' },
    ],
  };
  const urls = harvestSearchUrls(msg).map(u => u.url);
  assert.deepEqual(urls, ['https://real.example/found']);
  assert.ok(!urls.some(u => u.includes('fabricated')), 'prose URL must never be harvested');
});

test('returns empty when the search tool never ran', () => {
  const msg = { content: [{ type: 'text', text: 'Try https://guess.example/article' }] };
  assert.deepEqual(harvestSearchUrls(msg), []);
});

test('surfaces nothing from a search tool error block', () => {
  const msg = {
    content: [{
      type: 'web_search_tool_result',
      content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
    }],
  };
  assert.deepEqual(harvestSearchUrls(msg), []);
});

test('dedupes and rejects non-http schemes', () => {
  const msg = {
    content: [{
      type: 'web_search_tool_result',
      content: [
        { url: 'https://a.example/1' },
        { url: 'https://a.example/1' },
        { url: 'javascript:alert(1)' },
        { url: 'ftp://a.example/file' },
        { url: 42 },
        null,
      ],
    }],
  };
  assert.deepEqual(harvestSearchUrls(msg).map(u => u.url), ['https://a.example/1']);
});

test('tolerates a missing or malformed content array', () => {
  assert.deepEqual(harvestSearchUrls({}), []);
  assert.deepEqual(harvestSearchUrls({ content: null }), []);
  assert.deepEqual(harvestSearchUrls({ content: [{ type: 'web_search_tool_result' }] }), []);
});

test('stripCitations removes cite markup', () => {
  assert.equal(stripCitations('a <cite index="0">b</cite> c'), 'a  c');
  assert.equal(stripCitations('<cite>x</cite>'), '');
  assert.equal(stripCitations('plain'), 'plain');
});

test('textOf concatenates text blocks only, citations stripped', () => {
  const msg = {
    content: [
      { type: 'web_search_tool_result', content: [{ url: 'https://a.example' }] },
      { type: 'text', text: 'one <cite>ignore</cite>' },
      { type: 'text', text: 'two' },
    ],
  };
  assert.equal(textOf(msg), 'one\ntwo');
});

test('extractJson survives fences, prose and bad JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('here you go: {"a":1} hope that helps'), { a: 1 });
  assert.deepEqual(extractJson('[{"a":1}]', { array: true }), [{ a: 1 }]);
  assert.equal(extractJson('{not json}'), null);
  assert.equal(extractJson('no json here'), null);
  assert.equal(extractJson(''), null);
});

test('isFresh rejects stale, future and unparseable dates', () => {
  const day = 86_400_000;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  assert.ok(isFresh(iso(Date.now() - 5 * day)));
  assert.ok(!isFresh(iso(Date.now() - 60 * day)));
  assert.ok(!isFresh(iso(Date.now() + 5 * day)), 'a future date means the model invented it');
  assert.ok(!isFresh('not-a-date'));
  assert.ok(!isFresh(undefined));
});
