/**
 * Hourly news updater for the 2 Sides app.
 * Called by GitHub Actions — writes news/{conflictId}.json and manifest.json.
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required
 *   CONFLICT_ID        — optional; if set, updates only that conflict
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const NEWS_DIR  = join(ROOT, 'news');

// ── Conflict definitions (source of truth lives in mobile app) ──
const CONFLICT_DEFS = [
  {
    id: 'iran-us',
    fullLabel: 'Iran – US War 2026',
    searchQuery: 'Iran United States military strike war 2026',
    sideA: {
      label: 'US & Allies',
      actors: 'United States, Trump, Pentagon, CENTCOM, US Navy, US Air Force, Israel, IDF, NATO, Secretary of Defense',
    },
    sideB: {
      label: 'Iran & Allies',
      actors: 'Iran, IRGC, Iranian Supreme National Security Council, Houthi, Ansar Allah, Hezbollah, Hamas, Islamic Resistance, Yahya Saree, IRGC Navy',
    },
  },
  {
    id: 'ukraine-russia',
    fullLabel: 'Ukraine – Russia War',
    searchQuery: 'Ukraine Russia war latest today 2025',
    sideA: {
      label: 'Ukraine & NATO',
      actors: 'Ukraine, Zelensky, Ukrainian Armed Forces, UAF, ZSU, NATO, Pentagon, EU, Kyiv, GUR, SBU',
    },
    sideB: {
      label: 'Russia',
      actors: 'Russia, Putin, Russian military, Russian MoD, Wagner, Chechen forces, Kremlin, FSB, Russian Armed Forces',
    },
  },
  {
    id: 'israel-gaza',
    fullLabel: 'Israel – Gaza Conflict',
    searchQuery: 'Israel Gaza IDF Hamas war latest today',
    sideA: {
      label: 'Israel',
      actors: 'Israel, IDF, Netanyahu, Israeli military, Shin Bet, Mossad, Israeli government, Israeli Air Force',
    },
    sideB: {
      label: 'Palestine & Allies',
      actors: 'Hamas, Palestinian Islamic Jihad, PIJ, Palestinian Authority, Gaza Health Ministry, UNRWA, Hezbollah solidarity',
    },
  },
  {
    id: 'red-sea',
    fullLabel: 'Red Sea / Houthi War',
    searchQuery: 'Houthi Red Sea attack shipping latest today',
    sideA: {
      label: 'US-led Coalition',
      actors: 'CENTCOM, US Navy, Royal Navy, Eunavfor Aspides, USS ships, coalition forces, Operation Prosperity Guardian',
    },
    sideB: {
      label: 'Houthi / Ansar Allah',
      actors: 'Ansar Allah, Houthi, Yahya Saree, Yemen military, IRGC-backed, drone attacks, anti-ship missiles',
    },
  },
  {
    id: 'taiwan-china',
    fullLabel: 'China – Taiwan Strait',
    searchQuery: 'China Taiwan PLA military strait latest today',
    sideA: {
      label: 'Taiwan & US',
      actors: 'Taiwan, ROC military, Taiwan MND, Taiwan Air Force, ROC Navy, US Indo-Pacific Command, US Navy, FONOP',
    },
    sideB: {
      label: 'China / PLA',
      actors: 'China, PLA, Eastern Theater Command, Xi Jinping, China MoD, PLA Navy, PLA Air Force, PLAAF, PLAN',
    },
  },
  {
    id: 'india-pakistan',
    fullLabel: 'India – Pakistan Conflict',
    searchQuery: 'India Pakistan military tensions Kashmir latest today',
    sideA: {
      label: 'India',
      actors: 'India, Indian Army, IAF, Indian Air Force, Indian Navy, Modi, Indian MoD, BSF, CRPF, RAW, LOC',
    },
    sideB: {
      label: 'Pakistan',
      actors: 'Pakistan, Pakistan Army, PAF, Pakistan Air Force, Pakistan Navy, Sharif, ISPR, ISI, LOC crossings',
    },
  },
  {
    id: 'sudan',
    fullLabel: 'Sudan Civil War',
    searchQuery: 'Sudan civil war SAF RSF latest today',
    sideA: {
      label: 'SAF (Government)',
      actors: 'Sudanese Armed Forces, SAF, al-Burhan, Sudan government, Sudan Air Force, Sudan military, Port Sudan',
    },
    sideB: {
      label: 'RSF',
      actors: 'Rapid Support Forces, RSF, Dagalo, Hemedti, RSF militia, Darfur operations, El Fasher, Khartoum RSF',
    },
  },
];

// ── Prompt builder ────────────────────────────────────────────
function buildPrompt(conflict) {
  const topA = conflict.sideA.actors.split(',').slice(0, 4).join(',').trim();
  const topB = conflict.sideB.actors.split(',').slice(0, 4).join(',').trim();
  return `Now:${new Date().toUTCString()}.
Conflict:${conflict.fullLabel}
A(${conflict.sideA.label}):${topA}
B(${conflict.sideB.label}):${topB}
Query:"${conflict.searchQuery}"

Return 5 most recent war/military items per side. Prefer last 7 days — if unavailable, return up to 30 days old. Always return what you find; never refuse due to age. No invented quotes. Living officials only.
JSON only:
{"sideA":[{"title":"","source":"","sourceType":"tweet|official|newswire|analysis|state","description":"1-2 sentences","publishedAt":"","url":""}],"sideB":[...same...]}`;
}

// ── Parsing ───────────────────────────────────────────────────
const VALID_SOURCE_TYPES = new Set(['tweet', 'official', 'newswire', 'analysis', 'state']);
const MAX_ARTICLE_AGE_DAYS = 30;

function stripCitations(s) {
  return s
    .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '')
    .replace(/<\/?cite[^>]*>/gi, '')
    .trim();
}

function parseArticleArray(arr) {
  const cutoffMs = Date.now() - MAX_ARTICLE_AGE_DAYS * 24 * 3600 * 1000;
  const articles = [];
  for (let i = 0; i < Math.min(arr.length, 5); i++) {
    const a = arr[i];
    const rawDate  = typeof a.publishedAt === 'string' ? a.publishedAt : '';
    const parsedMs = rawDate ? new Date(rawDate).getTime() : NaN;
    if (isNaN(parsedMs) || parsedMs < cutoffMs || parsedMs > Date.now()) continue;
    const rawType = typeof a.sourceType === 'string' ? a.sourceType : 'newswire';
    articles.push({
      id:          String(i),
      title:       typeof a.title       === 'string' ? stripCitations(a.title)       : 'No title',
      source:      typeof a.source      === 'string' ? a.source                      : 'Unknown',
      sourceType:  VALID_SOURCE_TYPES.has(rawType) ? rawType : 'newswire',
      description: typeof a.description === 'string' ? stripCitations(a.description) : null,
      publishedAt: rawDate,
      url:         typeof a.url         === 'string' ? a.url                         : '',
    });
  }
  return articles;
}

function parseResponse(text) {
  const clean = text.replace(/```[a-z]*\n?/gi, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return { sideA: [], sideB: [] };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      sideA: parseArticleArray(Array.isArray(parsed.sideA) ? parsed.sideA : []),
      sideB: parseArticleArray(Array.isArray(parsed.sideB) ? parsed.sideB : []),
    };
  } catch {
    return { sideA: [], sideB: [] };
  }
}

// ── Fetch one conflict ────────────────────────────────────────
async function fetchConflict(client, conflict) {
  console.log(`[update-news] Fetching ${conflict.id}...`);

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages:   [{ role: 'user', content: buildPrompt(conflict) }],
  });

  const rawText = message.content
    .filter(b => b.type === 'text')
    .map(b => stripCitations(b.text))
    .join('\n')
    .trim();

  const { sideA, sideB } = parseResponse(rawText);

  const generatedAtMs = Date.now();
  const fileData = {
    conflictId:    conflict.id,
    generatedAt:   new Date(generatedAtMs).toISOString(),
    generatedAtMs,
    schemaVersion: 1,
    sideA: { label: conflict.sideA.label, articles: sideA },
    sideB: { label: conflict.sideB.label, articles: sideB },
  };

  const filePath = join(NEWS_DIR, `${conflict.id}.json`);
  writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf8');
  console.log(`[update-news] ✓ ${conflict.id}.json — A=${sideA.length} B=${sideB.length}`);

  return { conflictId: conflict.id, generatedAtMs, sideACount: sideA.length, sideBCount: sideB.length };
}

// ── Update manifest ───────────────────────────────────────────
function updateManifest(results) {
  const manifestPath = join(ROOT, 'manifest.json');
  let existing = { conflicts: {} };
  if (existsSync(manifestPath)) {
    try { existing = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { /* first run */ }
  }

  const conflicts = { ...(existing.conflicts ?? {}) };
  for (const r of results) {
    conflicts[r.conflictId] = {
      generatedAtMs: r.generatedAtMs,
      articleCount:  { a: r.sideACount, b: r.sideBCount },
    };
  }

  const lastUpdatedAtMs = Math.max(...Object.values(conflicts).map(c => c.generatedAtMs ?? 0));
  writeFileSync(manifestPath, JSON.stringify({
    lastUpdatedAt:   new Date(lastUpdatedAtMs).toISOString(),
    lastUpdatedAtMs,
    conflicts,
  }, null, 2), 'utf8');
  console.log(`[update-news] manifest.json updated`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('[update-news] ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  mkdirSync(NEWS_DIR, { recursive: true });

  const targetId = process.env.CONFLICT_ID?.trim();
  const toUpdate = targetId
    ? CONFLICT_DEFS.filter(c => c.id === targetId)
    : CONFLICT_DEFS;

  if (toUpdate.length === 0) {
    console.error(`[update-news] Unknown conflict id: "${targetId}". Valid ids: ${CONFLICT_DEFS.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  const results = [];
  for (let i = 0; i < toUpdate.length; i++) {
    const conflict = toUpdate[i];
    try {
      const result = await fetchConflict(client, conflict);
      results.push(result);
    } catch (err) {
      console.error(`[update-news] ✗ ${conflict.id}: ${err.message}`);
    }
    // 2s pause between conflicts to stay within rate limits
    if (i < toUpdate.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (results.length > 0) {
    updateManifest(results);
  }

  console.log(`[update-news] Done. Updated ${results.length}/${toUpdate.length} conflicts.`);
  if (results.length < toUpdate.length) process.exit(1);
}

main().catch(err => {
  console.error('[update-news] Fatal:', err);
  process.exit(1);
});
