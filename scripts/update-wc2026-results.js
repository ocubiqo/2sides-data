/**
 * WC2026 live score updater for the 2 Sides app.
 * Called by GitHub Actions every 6 h — writes wc2026/results.json.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const WC_DIR    = join(ROOT, 'wc2026');

const WC2026_FIXTURES = [
  // MD1
  { id: 'a1', aId: 'mexico',             bId: 'south-africa',       ko: '2026-06-11T22:00:00Z' },
  { id: 'a2', aId: 'south-korea',        bId: 'czechia',            ko: '2026-06-12T16:00:00Z' },
  { id: 'b1', aId: 'canada',             bId: 'bosnia-herzegovina', ko: '2026-06-12T19:00:00Z' },
  { id: 'd1', aId: 'usa',                bId: 'paraguay',           ko: '2026-06-12T22:00:00Z' },
  { id: 'b2', aId: 'switzerland',        bId: 'qatar',              ko: '2026-06-13T16:00:00Z' },
  { id: 'd2', aId: 'australia',          bId: 'turkey',             ko: '2026-06-13T19:00:00Z' },
  { id: 'c1', aId: 'brazil',             bId: 'morocco',            ko: '2026-06-13T22:00:00Z' },
  { id: 'c2', aId: 'scotland',           bId: 'haiti',              ko: '2026-06-14T13:00:00Z' },
  { id: 'f1', aId: 'netherlands',        bId: 'japan',              ko: '2026-06-14T16:00:00Z' },
  { id: 'e1', aId: 'germany',            bId: 'curacao',            ko: '2026-06-14T19:00:00Z' },
  { id: 'e2', aId: 'ivory-coast',        bId: 'ecuador',            ko: '2026-06-14T22:00:00Z' },
  { id: 'f2', aId: 'tunisia',            bId: 'sweden',             ko: '2026-06-14T22:00:00Z' },
  { id: 'g1', aId: 'belgium',            bId: 'egypt',              ko: '2026-06-15T16:00:00Z' },
  { id: 'h1', aId: 'spain',              bId: 'cape-verde',         ko: '2026-06-15T19:00:00Z' },
  { id: 'g2', aId: 'iran',               bId: 'new-zealand',        ko: '2026-06-15T22:00:00Z' },
  { id: 'h2', aId: 'saudi-arabia',       bId: 'uruguay',            ko: '2026-06-15T22:00:00Z' },
  { id: 'i1', aId: 'france',             bId: 'senegal',            ko: '2026-06-16T16:00:00Z' },
  { id: 'i2', aId: 'iraq',               bId: 'norway',             ko: '2026-06-16T19:00:00Z' },
  { id: 'j1', aId: 'argentina',          bId: 'algeria',            ko: '2026-06-16T19:00:00Z' },
  { id: 'j2', aId: 'austria',            bId: 'jordan',             ko: '2026-06-16T22:00:00Z' },
  { id: 'k1', aId: 'portugal',           bId: 'dr-congo',           ko: '2026-06-17T16:00:00Z' },
  { id: 'l1', aId: 'england',            bId: 'croatia',            ko: '2026-06-17T19:00:00Z' },
  { id: 'k2', aId: 'uzbekistan',         bId: 'colombia',           ko: '2026-06-17T19:00:00Z' },
  { id: 'l2', aId: 'ghana',              bId: 'panama',             ko: '2026-06-17T22:00:00Z' },
  // MD2
  { id: 'a3', aId: 'mexico',             bId: 'czechia',            ko: '2026-06-18T16:00:00Z' },
  { id: 'b3', aId: 'canada',             bId: 'switzerland',        ko: '2026-06-18T16:00:00Z' },
  { id: 'a4', aId: 'south-korea',        bId: 'south-africa',       ko: '2026-06-18T19:00:00Z' },
  { id: 'b4', aId: 'bosnia-herzegovina', bId: 'qatar',              ko: '2026-06-18T22:00:00Z' },
  { id: 'c3', aId: 'brazil',             bId: 'scotland',           ko: '2026-06-19T16:00:00Z' },
  { id: 'c4', aId: 'morocco',            bId: 'haiti',              ko: '2026-06-19T19:00:00Z' },
  { id: 'd3', aId: 'usa',                bId: 'australia',          ko: '2026-06-19T22:00:00Z' },
  { id: 'd4', aId: 'paraguay',           bId: 'turkey',             ko: '2026-06-20T16:00:00Z' },
  { id: 'e3', aId: 'germany',            bId: 'ivory-coast',        ko: '2026-06-20T19:00:00Z' },
  { id: 'e4', aId: 'ecuador',            bId: 'curacao',            ko: '2026-06-20T22:00:00Z' },
  { id: 'f3', aId: 'netherlands',        bId: 'sweden',             ko: '2026-06-20T22:00:00Z' },
  { id: 'f4', aId: 'japan',              bId: 'tunisia',            ko: '2026-06-21T16:00:00Z' },
  { id: 'g3', aId: 'belgium',            bId: 'iran',               ko: '2026-06-21T19:00:00Z' },
  { id: 'h3', aId: 'spain',              bId: 'saudi-arabia',       ko: '2026-06-21T22:00:00Z' },
  { id: 'g4', aId: 'egypt',              bId: 'new-zealand',        ko: '2026-06-22T16:00:00Z' },
  { id: 'h4', aId: 'uruguay',            bId: 'cape-verde',         ko: '2026-06-22T19:00:00Z' },
  { id: 'i3', aId: 'france',             bId: 'norway',             ko: '2026-06-22T19:00:00Z' },
  { id: 'i4', aId: 'senegal',            bId: 'iraq',               ko: '2026-06-22T22:00:00Z' },
  { id: 'a5', aId: 'mexico',             bId: 'south-korea',        ko: '2026-06-23T16:00:00Z' },
  { id: 'a6', aId: 'czechia',            bId: 'south-africa',       ko: '2026-06-23T16:00:00Z' },
  { id: 'j3', aId: 'argentina',          bId: 'austria',            ko: '2026-06-23T16:00:00Z' },
  { id: 'b5', aId: 'canada',             bId: 'qatar',              ko: '2026-06-23T19:00:00Z' },
  { id: 'b6', aId: 'switzerland',        bId: 'bosnia-herzegovina', ko: '2026-06-23T19:00:00Z' },
  { id: 'j4', aId: 'algeria',            bId: 'jordan',             ko: '2026-06-23T19:00:00Z' },
  { id: 'k3', aId: 'portugal',           bId: 'uzbekistan',         ko: '2026-06-23T22:00:00Z' },
  { id: 'l3', aId: 'england',            bId: 'ghana',              ko: '2026-06-23T22:00:00Z' },
  { id: 'c5', aId: 'brazil',             bId: 'haiti',              ko: '2026-06-24T16:00:00Z' },
  { id: 'c6', aId: 'scotland',           bId: 'morocco',            ko: '2026-06-24T16:00:00Z' },
  { id: 'l4', aId: 'croatia',            bId: 'panama',             ko: '2026-06-24T16:00:00Z' },
  { id: 'd5', aId: 'usa',                bId: 'turkey',             ko: '2026-06-24T19:00:00Z' },
  { id: 'd6', aId: 'paraguay',           bId: 'australia',          ko: '2026-06-24T19:00:00Z' },
  { id: 'k4', aId: 'colombia',           bId: 'dr-congo',           ko: '2026-06-24T19:00:00Z' },
  // MD3 (simultaneous per group)
  { id: 'e5', aId: 'germany',            bId: 'ecuador',            ko: '2026-06-25T16:00:00Z' },
  { id: 'e6', aId: 'ivory-coast',        bId: 'curacao',            ko: '2026-06-25T16:00:00Z' },
  { id: 'f5', aId: 'netherlands',        bId: 'tunisia',            ko: '2026-06-25T19:00:00Z' },
  { id: 'f6', aId: 'japan',              bId: 'sweden',             ko: '2026-06-25T19:00:00Z' },
  { id: 'g5', aId: 'belgium',            bId: 'new-zealand',        ko: '2026-06-25T22:00:00Z' },
  { id: 'g6', aId: 'iran',               bId: 'egypt',              ko: '2026-06-25T22:00:00Z' },
  { id: 'h5', aId: 'spain',              bId: 'uruguay',            ko: '2026-06-26T16:00:00Z' },
  { id: 'h6', aId: 'saudi-arabia',       bId: 'cape-verde',         ko: '2026-06-26T16:00:00Z' },
  { id: 'i5', aId: 'france',             bId: 'iraq',               ko: '2026-06-26T19:00:00Z' },
  { id: 'i6', aId: 'senegal',            bId: 'norway',             ko: '2026-06-26T19:00:00Z' },
  { id: 'j5', aId: 'argentina',          bId: 'jordan',             ko: '2026-06-26T22:00:00Z' },
  { id: 'j6', aId: 'austria',            bId: 'algeria',            ko: '2026-06-26T22:00:00Z' },
  { id: 'k5', aId: 'portugal',           bId: 'colombia',           ko: '2026-06-27T16:00:00Z' },
  { id: 'k6', aId: 'uzbekistan',         bId: 'dr-congo',           ko: '2026-06-27T16:00:00Z' },
  { id: 'l5', aId: 'england',            bId: 'panama',             ko: '2026-06-27T19:00:00Z' },
  { id: 'l6', aId: 'croatia',            bId: 'ghana',              ko: '2026-06-27T19:00:00Z' },
];

const DONE_BUFFER_MS = 2 * 3_600_000;

function getCompletedFixtures(nowMs) {
  return WC2026_FIXTURES.filter(f => new Date(f.ko).getTime() + DONE_BUFFER_MS < nowMs);
}

// Load existing results so we keep already-confirmed scores even if search misses them
function loadExisting() {
  const p = join(WC_DIR, 'results.json');
  if (!existsSync(p)) return {};
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return j.matches ?? {};
  } catch { return {}; }
}

function buildPrompt(fixtures) {
  const fixtureList = fixtures
    .map(f => {
      const date = f.ko.split('T')[0];
      return `  ${f.id}: ${f.aId} — search for their FIFA World Cup 2026 match on ${date}`;
    })
    .join('\n');

  return `Today: ${new Date().toUTCString()}

Search the web for these teams' FIFA World Cup 2026 group stage match results. For each item, find the match played by the listed team on (or around) that date — regardless of who the opponent was:
${fixtureList}

Return a JSON object with one key per match ID. Use the listed team as "team A". Include match stats if you find them in search results (possession %, shots, corners, cards):
{"a1":{"played":true,"aScore":2,"bScore":0,"opponentId":"south-africa","stats":{"possession_a":58,"possession_b":42,"shots_a":14,"shots_b":5,"shots_on_target_a":6,"shots_on_target_b":1,"corners_a":7,"corners_b":2,"yellow_cards_a":1,"yellow_cards_b":0}}}

Rules:
- Keys must be exactly the match IDs listed above
- aScore = goals by the FIRST team listed, bScore = goals by their actual opponent
- opponentId = actual opponent name (lowercase-hyphenated, e.g. "south-africa")
- stats.*_a = first team's stats, stats.*_b = opponent's stats; possession_a + possession_b = 100
- Omit the stats object entirely if you cannot find match stats — do NOT guess
- Only include a match if you find a confirmed final score
- JSON only — no explanation, no markdown fences`;
}

const STAT_KEYS = [
  'possession_a','possession_b','shots_a','shots_b',
  'shots_on_target_a','shots_on_target_b','corners_a','corners_b',
  'yellow_cards_a','yellow_cards_b','red_cards_a','red_cards_b',
];

function extractEntry(entry) {
  const aScore = Number(entry?.aScore);
  const bScore = Number(entry?.bScore);
  if (!Number.isFinite(aScore) || !Number.isFinite(bScore) || aScore < 0 || bScore < 0) return null;
  const result = { played: true, aScore, bScore };
  if (typeof entry?.opponentId === 'string' && entry.opponentId.trim()) {
    result.opponentId = entry.opponentId.trim().toLowerCase().replace(/\s+/g, '-');
  }
  if (entry?.stats && typeof entry.stats === 'object') {
    const stats = {};
    for (const key of STAT_KEYS) {
      const v = Number(entry.stats[key]);
      if (Number.isFinite(v) && v >= 0) stats[key] = v;
    }
    if (Object.keys(stats).length > 0) result.stats = stats;
  }
  return result;
}

function parseResponse(text) {
  console.log('[update-wc2026] Raw response:', text.slice(0, 600));
  const clean = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log('[update-wc2026] No JSON object found in response');
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.log('[update-wc2026] JSON parse error:', err.message);
    return {};
  }

  // Accept {"matches":{...}} wrapper or direct {"b1":{...}} format
  const raw = (parsed.matches && typeof parsed.matches === 'object')
    ? parsed.matches
    : parsed;

  const matches = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const result = extractEntry(entry);
    if (result) matches[id] = result;
  }
  console.log(`[update-wc2026] Parsed ${Object.keys(matches).length} valid entries from response`);
  return matches;
}

const BATCH_SIZE = 5;

async function fetchBatch(client, fixtures) {
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages:   [{ role: 'user', content: buildPrompt(fixtures) }],
  });

  console.log(`[update-wc2026] stop_reason=${msg.stop_reason} content_blocks=${JSON.stringify(msg.content.map(b => b.type))}`);

  const text = msg.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  console.log(`[update-wc2026] text_length=${text.length} full_text=${JSON.stringify(text.slice(0, 800))}`);
  return parseResponse(text);
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('[update-wc2026] ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  mkdirSync(WC_DIR, { recursive: true });

  const nowMs     = Date.now();
  const completed = getCompletedFixtures(nowMs);
  const existing  = loadExisting();

  console.log(`[update-wc2026] ${completed.length} completed fixtures, ${Object.keys(existing).length} existing results`);

  if (completed.length === 0) {
    console.log('[update-wc2026] No completed fixtures yet');
    writeFileSync(join(WC_DIR, 'results.json'), JSON.stringify({ updated: new Date(nowMs).toISOString(), matches: existing }, null, 2), 'utf8');
    return;
  }

  const toFetch = completed.filter(f => !existing[f.id]);
  console.log(`[update-wc2026] Need to fetch ${toFetch.length} new results`);

  if (toFetch.length === 0) {
    console.log('[update-wc2026] All completed fixtures already have results — skipping fetch');
    writeFileSync(join(WC_DIR, 'results.json'), JSON.stringify({ updated: new Date(nowMs).toISOString(), matches: existing }, null, 2), 'utf8');
    return;
  }

  const client = new Anthropic({ apiKey });
  let merged = { ...existing };

  // Process in batches of BATCH_SIZE so each call stays focused and within token limits
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    console.log(`[update-wc2026] Fetching batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map(f => f.id).join(', ')}`);
    try {
      const newMatches = await fetchBatch(client, batch);
      console.log(`[update-wc2026] Batch got ${Object.keys(newMatches).length} scores: ${JSON.stringify(newMatches)}`);
      merged = { ...merged, ...newMatches };
    } catch (err) {
      console.error(`[update-wc2026] Batch error:`, err.message);
    }
  }

  const totalNew = Object.keys(merged).length - Object.keys(existing).length;
  const payload  = { updated: new Date(nowMs).toISOString(), matches: merged };
  writeFileSync(join(WC_DIR, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[update-wc2026] ✓ results.json — ${totalNew} new scores, ${Object.keys(merged).length} total`);
}

main().catch(err => {
  console.error('[update-wc2026] Fatal:', err);
  process.exit(1);
});
