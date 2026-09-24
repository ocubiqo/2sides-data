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
  looksLikeArticleUrl, filterArticleUrls,
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

// ── looksLikeArticleUrl: real examples from the first live daily-batch run ──
//
// Every one of these cleared provenance (the tool really returned it) and
// would have cleared liveness (they resolve 2xx) — hub pages are real, live
// URLs. This is the check that catches "real and live, but not a story".

test('rejects the actual hub pages the first batch run produced', () => {
  assert.equal(looksLikeArticleUrl('https://theprint.in/category/politics/'), false);
  assert.equal(looksLikeArticleUrl('https://www.businesstoday.in/latest/politics'), false);
  assert.equal(looksLikeArticleUrl('https://www.theindiaforum.in/public-policy'), false);
});

test('accepts the actual article URLs the same run produced', () => {
  assert.equal(looksLikeArticleUrl('https://en.wikipedia.org/wiki/2025_Indian_electoral_controversy'), true);
  assert.equal(
    looksLikeArticleUrl('https://carnegieendowment.org/podcasts/grand-tamasha/the-state-of-indian-politics-in-2026'),
    true,
  );
  assert.equal(looksLikeArticleUrl('https://en.wikipedia.org/wiki/2026_elections_in_India'), true);
});

test('accepts realistic article URL shapes from major Indian and international outlets', () => {
  assert.equal(
    looksLikeArticleUrl('https://www.thehindu.com/business/four-day-week-proposal/article12345678.ece'),
    true,
  );
  assert.equal(
    looksLikeArticleUrl('https://www.livemint.com/economy/shorter-week-india-11758000000000.html'),
    true,
  );
  assert.equal(
    looksLikeArticleUrl('https://www.espncricinfo.com/story/ipl-dedicated-window-debate-1234567'),
    true,
  );
  assert.equal(
    looksLikeArticleUrl('https://www.reuters.com/world/india/upi-government-transactions-2026-09-15/'),
    true,
  );
  // bbc.com/news/... is a real BBC article shape despite "news" being a
  // generic word — it's not the LAST segment, so the length-3 slug carries it.
  assert.equal(looksLikeArticleUrl('https://www.bbc.com/news/world-asia-india-67890123'), true);
  // A query-string article id (common on .gov.in sites) still counts.
  assert.equal(looksLikeArticleUrl('https://pib.gov.in/PressReleasePage.aspx?PRID=1234567'), true);
});

test('rejects taxonomy/listing URLs generally, not just the specific ones seen', () => {
  assert.equal(looksLikeArticleUrl('https://example.com/tag/elections/'), false);
  assert.equal(looksLikeArticleUrl('https://example.com/author/jane-doe/'), false);
  assert.equal(looksLikeArticleUrl('https://example.com/topics/technology'), false);
  assert.equal(looksLikeArticleUrl('https://example.com/section/world/'), false);
  assert.equal(looksLikeArticleUrl('https://example.com/news'), false);
  assert.equal(looksLikeArticleUrl('https://example.com/'), false);
  assert.equal(looksLikeArticleUrl('https://example.com'), false);
});

test('does not crash on unparseable input', () => {
  assert.equal(looksLikeArticleUrl('not a url'), false);
  assert.equal(looksLikeArticleUrl(''), false);
});

test('filterArticleUrls keeps only the article-shaped entries, preserving their fields', () => {
  const urls = [
    { url: 'https://theprint.in/category/politics/', title: 'ThePrint politics' },
    { url: 'https://en.wikipedia.org/wiki/2026_elections_in_India', title: '2026 elections in India' },
  ];
  const kept = filterArticleUrls(urls);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, 'https://en.wikipedia.org/wiki/2026_elections_in_India');
  assert.equal(kept[0].title, '2026 elections in India');
});
