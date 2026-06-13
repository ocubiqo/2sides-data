/**
 * WC2026 live score updater for the 2 Sides app.
 * Called by GitHub Actions every 6 h — writes wc2026/results.json.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const WC_DIR    = join(ROOT, 'wc2026');

// Full 72-match group-stage fixture list (same data as wc2026Fixtures.ts)
const WC2026_FIXTURES = [
  { id: 'b1',  aId: 'mexico',       bId: 'jamaica',       ko: '2026-06-11T22:00:00Z' },
  { id: 'a1',  aId: 'usa',          bId: 'panama',        ko: '2026-06-12T01:00:00Z' },
  { id: 'c1',  aId: 'canada',       bId: 'cameroon',      ko: '2026-06-12T16:00:00Z' },
  { id: 'd1',  aId: 'argentina',    bId: 'algeria',       ko: '2026-06-12T19:00:00Z' },
  { id: 'e1',  aId: 'brazil',       bId: 'senegal',       ko: '2026-06-12T22:00:00Z' },
  { id: 'f1',  aId: 'france',       bId: 'venezuela',     ko: '2026-06-13T16:00:00Z' },
  { id: 'g1',  aId: 'england',      bId: 'nigeria',       ko: '2026-06-13T19:00:00Z' },
  { id: 'h1',  aId: 'spain',        bId: 'saudi-arabia',  ko: '2026-06-13T22:00:00Z' },
  { id: 'i1',  aId: 'switzerland',  bId: 'costa-rica',    ko: '2026-06-14T16:00:00Z' },
  { id: 'j1',  aId: 'denmark',      bId: 'new-zealand',   ko: '2026-06-14T19:00:00Z' },
  { id: 'k1',  aId: 'serbia',       bId: 'paraguay',      ko: '2026-06-14T22:00:00Z' },
  { id: 'l1',  aId: 'uruguay',      bId: 'iraq',          ko: '2026-06-15T13:00:00Z' },
  { id: 'a2',  aId: 'morocco',      bId: 'uzbekistan',    ko: '2026-06-15T16:00:00Z' },
  { id: 'b2',  aId: 'poland',       bId: 'ivory-coast',   ko: '2026-06-15T22:00:00Z' },
  { id: 'c2',  aId: 'belgium',      bId: 'romania',       ko: '2026-06-16T16:00:00Z' },
  { id: 'd2',  aId: 'colombia',     bId: 'japan',         ko: '2026-06-16T19:00:00Z' },
  { id: 'e2',  aId: 'germany',      bId: 'turkey',        ko: '2026-06-16T22:00:00Z' },
  { id: 'f2',  aId: 'portugal',     bId: 'australia',     ko: '2026-06-17T16:00:00Z' },
  { id: 'g2',  aId: 'netherlands',  bId: 'ecuador',       ko: '2026-06-17T19:00:00Z' },
  { id: 'h2',  aId: 'croatia',      bId: 'ghana',         ko: '2026-06-17T22:00:00Z' },
  { id: 'i2',  aId: 'austria',      bId: 'south-korea',   ko: '2026-06-18T13:00:00Z' },
  { id: 'j2',  aId: 'ukraine',      bId: 'egypt',         ko: '2026-06-18T16:00:00Z' },
  { id: 'k2',  aId: 'scotland',     bId: 'qatar',         ko: '2026-06-18T19:00:00Z' },
  { id: 'l2',  aId: 'south-africa', bId: 'iran',          ko: '2026-06-18T22:00:00Z' },
  { id: 'a3',  aId: 'usa',          bId: 'morocco',       ko: '2026-06-19T16:00:00Z' },
  { id: 'b3',  aId: 'mexico',       bId: 'poland',        ko: '2026-06-19T19:00:00Z' },
  { id: 'c3',  aId: 'canada',       bId: 'belgium',       ko: '2026-06-19T22:00:00Z' },
  { id: 'd3',  aId: 'argentina',    bId: 'colombia',      ko: '2026-06-20T16:00:00Z' },
  { id: 'e3',  aId: 'brazil',       bId: 'germany',       ko: '2026-06-20T19:00:00Z' },
  { id: 'f3',  aId: 'france',       bId: 'portugal',      ko: '2026-06-20T22:00:00Z' },
  { id: 'g3',  aId: 'england',      bId: 'netherlands',   ko: '2026-06-21T16:00:00Z' },
  { id: 'h3',  aId: 'spain',        bId: 'croatia',       ko: '2026-06-21T19:00:00Z' },
  { id: 'i3',  aId: 'switzerland',  bId: 'austria',       ko: '2026-06-21T22:00:00Z' },
  { id: 'j3',  aId: 'denmark',      bId: 'ukraine',       ko: '2026-06-22T16:00:00Z' },
  { id: 'k3',  aId: 'serbia',       bId: 'scotland',      ko: '2026-06-22T19:00:00Z' },
  { id: 'l3',  aId: 'uruguay',      bId: 'south-africa',  ko: '2026-06-22T22:00:00Z' },
  { id: 'a4',  aId: 'panama',       bId: 'uzbekistan',    ko: '2026-06-23T16:00:00Z' },
  { id: 'b4',  aId: 'jamaica',      bId: 'ivory-coast',   ko: '2026-06-23T19:00:00Z' },
  { id: 'c4',  aId: 'cameroon',     bId: 'romania',       ko: '2026-06-23T22:00:00Z' },
  { id: 'd4',  aId: 'algeria',      bId: 'japan',         ko: '2026-06-24T16:00:00Z' },
  { id: 'e4',  aId: 'senegal',      bId: 'turkey',        ko: '2026-06-24T19:00:00Z' },
  { id: 'f4',  aId: 'venezuela',    bId: 'australia',     ko: '2026-06-24T22:00:00Z' },
  { id: 'g4',  aId: 'nigeria',      bId: 'ecuador',       ko: '2026-06-25T16:00:00Z' },
  { id: 'h4',  aId: 'saudi-arabia', bId: 'ghana',         ko: '2026-06-25T19:00:00Z' },
  { id: 'i4',  aId: 'costa-rica',   bId: 'south-korea',   ko: '2026-06-25T22:00:00Z' },
  { id: 'j4',  aId: 'new-zealand',  bId: 'egypt',         ko: '2026-06-26T16:00:00Z' },
  { id: 'k4',  aId: 'qatar',        bId: 'paraguay',      ko: '2026-06-26T19:00:00Z' },
  { id: 'l4',  aId: 'iraq',         bId: 'iran',          ko: '2026-06-26T22:00:00Z' },
  { id: 'a5',  aId: 'usa',          bId: 'uzbekistan',    ko: '2026-06-27T19:00:00Z' },
  { id: 'a6',  aId: 'morocco',      bId: 'panama',        ko: '2026-06-27T19:00:00Z' },
  { id: 'b5',  aId: 'mexico',       bId: 'ivory-coast',   ko: '2026-06-27T22:00:00Z' },
  { id: 'b6',  aId: 'poland',       bId: 'jamaica',       ko: '2026-06-27T22:00:00Z' },
  { id: 'c5',  aId: 'canada',       bId: 'romania',       ko: '2026-06-28T16:00:00Z' },
  { id: 'c6',  aId: 'belgium',      bId: 'cameroon',      ko: '2026-06-28T16:00:00Z' },
  { id: 'd5',  aId: 'argentina',    bId: 'japan',         ko: '2026-06-28T19:00:00Z' },
  { id: 'd6',  aId: 'colombia',     bId: 'algeria',       ko: '2026-06-28T19:00:00Z' },
  { id: 'e5',  aId: 'brazil',       bId: 'turkey',        ko: '2026-06-28T22:00:00Z' },
  { id: 'e6',  aId: 'germany',      bId: 'senegal',       ko: '2026-06-28T22:00:00Z' },
  { id: 'f5',  aId: 'france',       bId: 'australia',     ko: '2026-06-29T16:00:00Z' },
  { id: 'f6',  aId: 'portugal',     bId: 'venezuela',     ko: '2026-06-29T16:00:00Z' },
  { id: 'g5',  aId: 'england',      bId: 'ecuador',       ko: '2026-06-29T19:00:00Z' },
  { id: 'g6',  aId: 'netherlands',  bId: 'nigeria',       ko: '2026-06-29T19:00:00Z' },
  { id: 'h5',  aId: 'spain',        bId: 'ghana',         ko: '2026-06-29T22:00:00Z' },
  { id: 'h6',  aId: 'croatia',      bId: 'saudi-arabia',  ko: '2026-06-29T22:00:00Z' },
  { id: 'i5',  aId: 'switzerland',  bId: 'south-korea',   ko: '2026-06-30T16:00:00Z' },
  { id: 'i6',  aId: 'austria',      bId: 'costa-rica',    ko: '2026-06-30T16:00:00Z' },
  { id: 'j5',  aId: 'denmark',      bId: 'egypt',         ko: '2026-06-30T19:00:00Z' },
  { id: 'j6',  aId: 'ukraine',      bId: 'new-zealand',   ko: '2026-06-30T19:00:00Z' },
  { id: 'k5',  aId: 'serbia',       bId: 'qatar',         ko: '2026-06-30T22:00:00Z' },
  { id: 'k6',  aId: 'scotland',     bId: 'paraguay',      ko: '2026-06-30T22:00:00Z' },
  { id: 'l5',  aId: 'uruguay',      bId: 'iran',          ko: '2026-07-01T16:00:00Z' },
  { id: 'l6',  aId: 'south-africa', bId: 'iraq',          ko: '2026-07-01T16:00:00Z' },
];

const DONE_BUFFER_MS = 2 * 3_600_000; // 2 h after kickoff = match considered finished

function getCompletedFixtures(nowMs) {
  return WC2026_FIXTURES.filter(f => new Date(f.ko).getTime() + DONE_BUFFER_MS < nowMs);
}

function buildPrompt(fixtures) {
  const fixtureList = fixtures
    .map(f => `${f.id}: ${f.aId} vs ${f.bId} (ko ${f.ko})`)
    .join('\n');

  return `Today: ${new Date().toUTCString()}
FIFA World Cup 2026 — group stage scores needed.
The following matches have already kicked off. Search for the FINAL scores.

Fixtures (id: teamA vs teamB, kickoff UTC):
${fixtureList}

Return ONLY valid JSON. For each fixture id, include the final score if known. Skip fixtures with unknown or unconfirmed scores.
Format:
{"matches":{"b1":{"played":true,"aScore":2,"bScore":1},"a1":{"played":true,"aScore":0,"bScore":0}}}

Rules:
- aScore = goals scored by the first-listed team (teamA)
- bScore = goals scored by the second-listed team (teamB)
- Only include fixtures where you found the confirmed final score
- Do not guess or invent scores
- JSON only, no other text`;
}

function parseResponse(text) {
  const clean = text.replace(/```[a-z]*\n?/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    const matches = {};
    const raw = parsed.matches ?? {};
    for (const [id, entry] of Object.entries(raw)) {
      if (
        entry && typeof entry === 'object' &&
        entry.played === true &&
        typeof entry.aScore === 'number' &&
        typeof entry.bScore === 'number' &&
        entry.aScore >= 0 && entry.bScore >= 0
      ) {
        matches[id] = { played: true, aScore: entry.aScore, bScore: entry.bScore };
      }
    }
    return matches;
  } catch {
    return {};
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('[update-wc2026] ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  mkdirSync(WC_DIR, { recursive: true });

  const nowMs      = Date.now();
  const completed  = getCompletedFixtures(nowMs);

  if (completed.length === 0) {
    console.log('[update-wc2026] No completed fixtures yet — writing empty results.json');
    const empty = { updated: new Date(nowMs).toISOString(), matches: {} };
    writeFileSync(join(WC_DIR, 'results.json'), JSON.stringify(empty, null, 2), 'utf8');
    return;
  }

  console.log(`[update-wc2026] ${completed.length} completed fixtures — fetching scores...`);

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
    messages:   [{ role: 'user', content: buildPrompt(completed) }],
  });

  const rawText = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const matches = parseResponse(rawText);
  const count   = Object.keys(matches).length;

  const payload = {
    updated: new Date(nowMs).toISOString(),
    matches,
  };

  writeFileSync(join(WC_DIR, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[update-wc2026] ✓ results.json — ${count}/${completed.length} scores found`);
}

main().catch(err => {
  console.error('[update-wc2026] Fatal:', err);
  process.exit(1);
});
