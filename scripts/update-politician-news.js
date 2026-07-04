/**
 * Daily politician news updater for the 2 Sides app.
 * Called by GitHub Actions — writes entities/politics/leaders/news/{id}.json
 *
 * Fetches top 5 news articles per leader from their OWN country's
 * authorised news agency only (domestic perspective, no foreign angle).
 *
 * Env vars:
 *   ANTHROPIC_API_KEY  — required
 *   LEADER_ID          — optional; if set, updates only that leader
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const NEWS_DIR  = join(ROOT, 'entities', 'politics', 'leaders', 'news');

// ── Leader definitions with domestic news source ──────────────
const LEADERS = [
  { id: 'trump',     name: 'Donald Trump',          country: 'United States', agency: 'AP News',                  siteFilter: 'site:apnews.com' },
  { id: 'modi',      name: 'Narendra Modi',          country: 'India',         agency: 'ANI / PTI',                siteFilter: 'site:aninews.in OR site:pti.in' },
  { id: 'putin',     name: 'Vladimir Putin',         country: 'Russia',        agency: 'TASS',                     siteFilter: 'site:tass.com' },
  { id: 'xi',        name: 'Xi Jinping',             country: 'China',         agency: 'Xinhua',                   siteFilter: 'site:xinhuanet.com' },
  { id: 'zelensky',  name: 'Volodymyr Zelensky',     country: 'Ukraine',       agency: 'Ukrinform',                siteFilter: 'site:ukrinform.net' },
  { id: 'biden',     name: 'Joe Biden',              country: 'United States', agency: 'AP News',                  siteFilter: 'site:apnews.com' },
  { id: 'macron',    name: 'Emmanuel Macron',        country: 'France',        agency: 'France 24',                siteFilter: 'site:france24.com' },
  { id: 'kim',       name: 'Kim Jong-un',            country: 'North Korea',   agency: 'KCNA Watch',               siteFilter: 'site:kcnawatch.org' },
  { id: 'netanyahu', name: 'Benjamin Netanyahu',     country: 'Israel',        agency: 'Jerusalem Post / Gov.il',  siteFilter: 'site:jpost.com' },
  { id: 'milei',     name: 'Javier Milei',           country: 'Argentina',     agency: 'Infobae',                  siteFilter: 'site:infobae.com' },
  { id: 'erdogan',   name: 'Recep Tayyip Erdoğan',   country: 'Turkey',        agency: 'Anadolu Agency',           siteFilter: 'site:aa.com.tr' },
  { id: 'meloni',    name: 'Giorgia Meloni',         country: 'Italy',         agency: 'ANSA',                     siteFilter: 'site:ansa.it' },
  { id: 'starmer',   name: 'Keir Starmer',           country: 'United Kingdom',agency: 'BBC',                      siteFilter: 'site:bbc.co.uk' },
  { id: 'carney',    name: 'Mark Carney',            country: 'Canada',        agency: 'CBC',                      siteFilter: 'site:cbc.ca' },
  { id: 'scholz',    name: 'Olaf Scholz',            country: 'Germany',       agency: 'DW',                       siteFilter: 'site:dw.com' },
  { id: 'lula',      name: 'Luiz Lula da Silva',     country: 'Brazil',        agency: 'Agência Brasil',           siteFilter: 'site:agenciabrasil.ebc.com.br' },
  { id: 'khan',      name: 'Imran Khan',             country: 'Pakistan',      agency: 'APP (Pakistan)',           siteFilter: 'site:app.com.pk' },
  { id: 'ishiba',    name: 'Shigeru Ishiba',         country: 'Japan',         agency: 'NHK World',                siteFilter: 'site:nhk.or.jp' },
  { id: 'albanese',  name: 'Anthony Albanese',       country: 'Australia',     agency: 'ABC Australia',            siteFilter: 'site:abc.net.au' },
  { id: 'ramaphosa', name: 'Cyril Ramaphosa',        country: 'South Africa',  agency: 'SABC News',                siteFilter: 'site:sabc.co.za' },
];

// ── Prompt builder ─────────────────────────────────────────────
function buildPrompt(leader) {
  return `Now: ${new Date().toUTCString()}
Leader: ${leader.name}
Country: ${leader.country}
Domestic news source: ${leader.agency}
Search filter: ${leader.siteFilter}

Search for the 5 most recent news articles about ${leader.name} from ${leader.agency} (${leader.siteFilter}).
Focus on factual reporting about their current political activities, policies and decisions.
Do NOT use foreign news sources — domestic perspective only.
Return ONLY a JSON array of up to 5 articles. Each article must be factual and recent (last 30 days).

JSON format only — no other text:
[
  {
    "title": "Exact article headline",
    "summary": "One neutral factual sentence about what the article reports.",
    "url": "https://...",
    "publishedAt": "ISO date string e.g. 2026-07-04T08:00:00Z"
  }
]`;
}

// ── Strip citation markup ──────────────────────────────────────
function stripCitations(s) {
  return s
    .replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '')
    .replace(/<\/?cite[^>]*>/gi, '')
    .trim();
}

// ── Parse Claude response ──────────────────────────────────────
function parseArticles(rawText) {
  const clean = rawText.replace(/```[a-z]*\n?/gi, '').trim();
  const match = clean.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    const cutoffMs = Date.now() - 30 * 24 * 3600 * 1000;
    return arr.slice(0, 5).filter(a => {
      if (!a || typeof a !== 'object') return false;
      const parsedMs = a.publishedAt ? new Date(a.publishedAt).getTime() : NaN;
      return !isNaN(parsedMs) && parsedMs >= cutoffMs && parsedMs <= Date.now();
    }).map((a, i) => ({
      id:          String(i),
      title:       typeof a.title       === 'string' ? stripCitations(a.title)   : 'No title',
      summary:     typeof a.summary     === 'string' ? stripCitations(a.summary) : '',
      url:         typeof a.url         === 'string' ? a.url                     : '',
      publishedAt: typeof a.publishedAt === 'string' ? a.publishedAt             : '',
    }));
  } catch {
    return [];
  }
}

// ── Fetch news for one leader ──────────────────────────────────
async function fetchLeaderNews(client, leader) {
  console.log(`[politician-news] Fetching ${leader.id} (${leader.agency})...`);

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
    messages:   [{ role: 'user', content: buildPrompt(leader) }],
  });

  const rawText = message.content
    .filter(b => b.type === 'text')
    .map(b => stripCitations(b.text))
    .join('\n')
    .trim();

  const articles = parseArticles(rawText);

  const fileData = {
    politicianId:  leader.id,
    updatedAt:     new Date().toISOString(),
    sourceAgency:  leader.agency,
    articles,
  };

  const filePath = join(NEWS_DIR, `${leader.id}.json`);
  writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf8');
  console.log(`[politician-news] ✓ ${leader.id}.json — ${articles.length} articles`);

  return { leaderId: leader.id, count: articles.length };
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.error('[politician-news] ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  mkdirSync(NEWS_DIR, { recursive: true });

  const targetId = process.env.LEADER_ID?.trim();
  const toUpdate = targetId
    ? LEADERS.filter(l => l.id === targetId)
    : LEADERS;

  if (toUpdate.length === 0) {
    console.error(`[politician-news] Unknown leader id: "${targetId}". Valid ids: ${LEADERS.map(l => l.id).join(', ')}`);
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  const results = [];
  for (let i = 0; i < toUpdate.length; i++) {
    const leader = toUpdate[i];
    try {
      const result = await fetchLeaderNews(client, leader);
      results.push(result);
    } catch (err) {
      console.error(`[politician-news] ✗ ${leader.id}: ${err.message}`);
    }
    // 2s pause between requests to stay within rate limits
    if (i < toUpdate.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`[politician-news] Done. Updated ${results.length}/${toUpdate.length} leaders.`);
  if (results.length < toUpdate.length) process.exit(1);
}

main().catch(err => {
  console.error('[politician-news] Fatal:', err);
  process.exit(1);
});
