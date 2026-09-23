/**
 * Tests for source liveness classification. Run: npm test
 *
 * The asymmetry under test: only an unambiguous absence (404/410/DNS) may strip
 * a source. Everything else is kept unbadged. Getting this backwards either
 * starves the pipeline of real Indian news sources (403 to datacentre IPs is
 * routine) or ships Know More buttons that lead to a 404.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowlisted, classify, shouldRetryWithGet, OUTCOME } from './liveness.js';

const DOMAINS = ['thehindu.com', 'reuters.com', 'pib.gov.in'];

test('allowlist matches the domain and its subdomains', () => {
  assert.ok(isAllowlisted('https://thehindu.com/a', DOMAINS));
  assert.ok(isAllowlisted('https://www.thehindu.com/a', DOMAINS));
  assert.ok(isAllowlisted('https://m.economictimes.pib.gov.in/x', DOMAINS));
});

test('allowlist does not match lookalike domains', () => {
  // The important negative: a suffix check done on the raw string rather than
  // on host boundaries would accept both of these.
  assert.ok(!isAllowlisted('https://notthehindu.com/a', DOMAINS));
  assert.ok(!isAllowlisted('https://thehindu.com.evil.example/a', DOMAINS));
  assert.ok(!isAllowlisted('https://evil.example/thehindu.com', DOMAINS));
});

test('allowlist rejects unparseable URLs rather than throwing', () => {
  assert.equal(isAllowlisted('not a url', DOMAINS), false);
  assert.equal(isAllowlisted('', DOMAINS), false);
});

test('2xx on an allowlisted domain is verified', () => {
  assert.equal(classify({ status: 200 }, true), OUTCOME.VERIFIED);
  assert.equal(classify({ status: 204 }, true), OUTCOME.VERIFIED);
});

test('2xx off the allowlist is live but unbadged', () => {
  assert.equal(classify({ status: 200 }, false), OUTCOME.LIVE_UNLISTED);
});

test('only 404 and 410 assert absence', () => {
  assert.equal(classify({ status: 404 }, true), OUTCOME.DEAD);
  assert.equal(classify({ status: 410 }, true), OUTCOME.DEAD);
});

test('a bot-wall or outage is never treated as dead', () => {
  for (const status of [401, 403, 429, 500, 502, 503, 504]) {
    assert.equal(classify({ status }, true), OUTCOME.UNVERIFIABLE,
      `HTTP ${status} must not strip a source`);
  }
});

test('DNS failure is dead; timeout and reset are not', () => {
  assert.equal(classify({ status: 0, errorKind: 'dns' }, true), OUTCOME.DEAD);
  assert.equal(classify({ status: 0, errorKind: 'timeout' }, true), OUTCOME.UNVERIFIABLE);
  assert.equal(classify({ status: 0, errorKind: 'network' }, true), OUTCOME.UNVERIFIABLE);
});

test('an unverifiable source is never badged verified', () => {
  for (const r of [{ status: 403 }, { status: 503 }, { status: 0, errorKind: 'timeout' }]) {
    assert.notEqual(classify(r, true), OUTCOME.VERIFIED);
  }
});

test('retries with GET only where HEAD is plausibly the problem', () => {
  for (const s of [400, 403, 405, 429, 501]) assert.ok(shouldRetryWithGet(s), `${s} should retry`);
  for (const s of [200, 404, 410, 500, 503]) assert.ok(!shouldRetryWithGet(s), `${s} should not retry`);
});
