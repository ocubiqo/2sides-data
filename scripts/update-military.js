/**
 * Hourly military data updater for the 2 Sides app.
 * Fetches stats for all 30 countries in one Claude call and writes military/all.json.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..');
const MILITARY_DIR = join(ROOT, 'military');
const ALL_FILE     = join(MILITARY_DIR, 'all.json');
const MANIFEST_FILE = join(ROOT, 'manifest.json');

// ── Active conflict countries only (covers all 7 CONFLICT_DEFS) ─
// Non-state actors (Houthi, Hamas, RSF) and countries not in the
// app's roster fall back to offline presets in the mobile app.
const COUNTRIES = [
  { code: 'US', name: 'United States' },   // Iran–US, Red Sea
  { code: 'IR', name: 'Iran' },             // Iran–US
  { code: 'IL', name: 'Israel' },           // Iran–US, Israel–Gaza
  { code: 'RU', name: 'Russia' },           // Ukraine–Russia
  { code: 'UA', name: 'Ukraine' },          // Ukraine–Russia
  { code: 'CN', name: 'China' },            // China–Taiwan
  { code: 'TW', name: 'Taiwan' },           // China–Taiwan
  { code: 'IN', name: 'India' },            // India–Pakistan
  { code: 'PK', name: 'Pakistan' },         // India–Pakistan
];

// ── Prompt ────────────────────────────────────────────────────
function buildPrompt() {
  const countryList = COUNTRIES.map(c => `${c.name} (${c.code})`).join(', ');
  return `You are a military analyst. Provide current military statistics as of 2026 for all 30 of these countries: ${countryList}.

Return ONLY a valid JSON object keyed by country code with no markdown or prose:
{
  "US": {
    "troops": <active personnel>,
    "reserves": <reserve personnel>,
    "tanks": <main battle tanks>,
    "fighters": <fighter/multirole aircraft>,
    "bombers": <bombers>,
    "carriers": <aircraft carriers>,
    "destroyers": <destroyers and frigates>,
    "subs": <submarines>,
    "ballisticMissiles": <count>,
    "drones": <armed/combat drones>,
    "airDefense": <1-10 capability score>,
    "proxies": <1-10 proxy/asymmetric capability>,
    "gdp": <GDP in billion USD>,
    "nukes": <true or false>
  },
  "RU": { ...same fields... },
  ... all 30 countries ...
}

Use Global Firepower 2025/2026 and IISS Military Balance as primary sources.
Include ALL 30 country codes. Output ONLY the JSON object with NO whitespace or newlines (compact/minified).`;
}

// ── Parser ────────────────────────────────────────────────────
function parseStats(obj) {
  const n = (v, def = 0) =>
    typeof v === 'number' ? v : typeof v === 'string' ? (parseFloat(v) || def) : def;
  const b = (v) => typeof v === 'boolean' ? v : false;
  return {
    troops:           n(obj.troops),
    reserves:         n(obj.reserves),
    tanks:            n(obj.tanks),
    fighters:         n(obj.fighters),
    bombers:          n(obj.bombers),
    carriers:         n(obj.carriers),
    destroyers:       n(obj.destroyers),
    subs:             n(obj.subs),
    ballisticMissiles: n(obj.ballisticMissiles),
    drones:           n(obj.drones),
    airDefense:       Math.min(10, Math.max(1, n(obj.airDefense, 5))),
    proxies:          Math.min(10, Math.max(1, n(obj.proxies, 3))),
    gdp:              n(obj.gdp),
    nukes:            b(obj.nukes),
  };
}

function parseResponse(text) {
  const clean = text.replace(/```[a-z]*\n?/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const countries = {};
    for (const { code } of COUNTRIES) {
      if (parsed[code] && typeof parsed[code] === 'object') {
        countries[code] = parseStats(parsed[code]);
      }
    }
    return Object.keys(countries).length >= 20 ? countries : null;
  } catch {
    return null;
  }
}

// ── Update manifest ───────────────────────────────────────────
function updateManifest(generatedAtMs) {
  let existing = {};
  if (existsSync(MANIFEST_FILE)) {
    try { existing = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')); } catch { /* first run */ }
  }
  writeFileSync(MANIFEST_FILE, JSON.stringify({
    ...existing,
    militaryUpdatedAtMs: generatedAtMs,
    militaryUpdatedAt:   new Date(generatedAtMs).toISOString(),
  }, null, 2), 'utf8');
  console.log('[update-military] manifest.json updated');
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('[update-military] ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  // Ensure military/ dir exists
  const { mkdirSync } = await import('fs');
  mkdirSync(MILITARY_DIR, { recursive: true });

  const client = new Anthropic({ apiKey });

  console.log('[update-military] Fetching stats for all 30 countries...');

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: buildPrompt() }],
  });

  const rawText = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  const countries = parseResponse(rawText);
  if (!countries) {
    console.error('[update-military] Failed to parse response. Snippet:', rawText.slice(0, 400));
    process.exit(1);
  }

  const generatedAtMs = Date.now();
  const fileData = {
    generatedAt:   new Date(generatedAtMs).toISOString(),
    generatedAtMs,
    schemaVersion: 1,
    countries,
  };

  writeFileSync(ALL_FILE, JSON.stringify(fileData, null, 2), 'utf8');
  console.log(`[update-military] ✓ military/all.json written with ${Object.keys(countries).length} countries`);

  updateManifest(generatedAtMs);
}

main().catch(err => {
  console.error('[update-military] Fatal:', err);
  process.exit(1);
});
