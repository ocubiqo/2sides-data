/**
 * Facebook auto-poster for the 2 Sides football page.
 * Posts match previews, result recaps, and weekly app feature posts.
 *
 * Env vars (required):
 *   ANTHROPIC_API_KEY       — Claude API key
 *   FB_PAGE_ACCESS_TOKEN    — Never-expiring Facebook Page Access Token
 *   FB_PAGE_ID              — Numeric Facebook Page ID
 *   POST_TYPE               — 'preview' | 'result' | 'feature' | 'auto'
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '..');
const WC_DIR  = join(ROOT, 'wc2026');

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ocubiqo.twosides';

// ─── Team data ────────────────────────────────────────────────────────────────

const TEAM = {
  'mexico':             { name: 'Mexico',             flag: '🇲🇽' },
  'south-africa':       { name: 'South Africa',       flag: '🇿🇦' },
  'south-korea':        { name: 'South Korea',        flag: '🇰🇷' },
  'czechia':            { name: 'Czechia',            flag: '🇨🇿' },
  'canada':             { name: 'Canada',             flag: '🇨🇦' },
  'bosnia-herzegovina': { name: 'Bosnia & Herzegovina', flag: '🇧🇦' },
  'usa':                { name: 'USA',                flag: '🇺🇸' },
  'paraguay':           { name: 'Paraguay',           flag: '🇵🇾' },
  'switzerland':        { name: 'Switzerland',        flag: '🇨🇭' },
  'qatar':              { name: 'Qatar',              flag: '🇶🇦' },
  'australia':          { name: 'Australia',          flag: '🇦🇺' },
  'turkey':             { name: 'Türkiye',            flag: '🇹🇷' },
  'brazil':             { name: 'Brazil',             flag: '🇧🇷' },
  'morocco':            { name: 'Morocco',            flag: '🇲🇦' },
  'scotland':           { name: 'Scotland',           flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  'haiti':              { name: 'Haiti',              flag: '🇭🇹' },
  'netherlands':        { name: 'Netherlands',        flag: '🇳🇱' },
  'japan':              { name: 'Japan',              flag: '🇯🇵' },
  'germany':            { name: 'Germany',            flag: '🇩🇪' },
  'curacao':            { name: 'Curaçao',            flag: '🇨🇼' },
  'ivory-coast':        { name: 'Ivory Coast',        flag: '🇨🇮' },
  'ecuador':            { name: 'Ecuador',            flag: '🇪🇨' },
  'tunisia':            { name: 'Tunisia',            flag: '🇹🇳' },
  'sweden':             { name: 'Sweden',             flag: '🇸🇪' },
  'belgium':            { name: 'Belgium',            flag: '🇧🇪' },
  'egypt':              { name: 'Egypt',              flag: '🇪🇬' },
  'spain':              { name: 'Spain',              flag: '🇪🇸' },
  'cape-verde':         { name: 'Cape Verde',         flag: '🇨🇻' },
  'iran':               { name: 'Iran',               flag: '🇮🇷' },
  'new-zealand':        { name: 'New Zealand',        flag: '🇳🇿' },
  'saudi-arabia':       { name: 'Saudi Arabia',       flag: '🇸🇦' },
  'uruguay':            { name: 'Uruguay',            flag: '🇺🇾' },
  'france':             { name: 'France',             flag: '🇫🇷' },
  'senegal':            { name: 'Senegal',            flag: '🇸🇳' },
  'iraq':               { name: 'Iraq',               flag: '🇮🇶' },
  'norway':             { name: 'Norway',             flag: '🇳🇴' },
  'argentina':          { name: 'Argentina',          flag: '🇦🇷' },
  'algeria':            { name: 'Algeria',            flag: '🇩🇿' },
  'austria':            { name: 'Austria',            flag: '🇦🇹' },
  'jordan':             { name: 'Jordan',             flag: '🇯🇴' },
  'portugal':           { name: 'Portugal',           flag: '🇵🇹' },
  'dr-congo':           { name: 'DR Congo',           flag: '🇨🇩' },
  'england':            { name: 'England',            flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  'croatia':            { name: 'Croatia',            flag: '🇭🇷' },
  'uzbekistan':         { name: 'Uzbekistan',         flag: '🇺🇿' },
  'colombia':           { name: 'Colombia',           flag: '🇨🇴' },
  'ghana':              { name: 'Ghana',              flag: '🇬🇭' },
  'panama':             { name: 'Panama',             flag: '🇵🇦' },
};

// ─── Fixtures (mirrored from update-wc2026-results.js) ────────────────────────

const WC2026_FIXTURES = [
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

// ─── Feature topics (round-robin) ─────────────────────────────────────────────

const FEATURE_TOPICS = [
  { topic: 'head-to-head team comparison', detail: 'Pick any two WC2026 nations and compare them side by side — FIFA ranking, World Cup history, win rate, goals scored, clean sheets, and more. See exactly who has the statistical edge before a match.' },
  { topic: 'match simulation', detail: 'Let the stats decide — run a simulation on any WC2026 matchup and see who wins on paper. Great for settling debates with friends before kickoff.' },
  { topic: 'WC2026 group standings and scores', detail: 'See how every group is shaping up — updated match scores, group tables, and who is advancing. Catch up on all the results in one place.' },
  { topic: 'pre-match notifications', detail: 'Enable WC2026 match reminders and get notified before kickoff so you never lose track of when the next big game is.' },
  { topic: 'player and nation stats depth', detail: 'Beyond the scoreline — 2 Sides breaks down each nation\'s full WC pedigree: titles won, appearances, biggest wins, and tournament clean sheets, all in one clean comparison view.' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teamLabel(id) {
  const t = TEAM[id];
  return t ? `${t.flag} ${t.name}` : id;
}

function kickoffLabel(ko) {
  return new Date(ko).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', timeZoneName: 'short',
  });
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

function resolvePostType(raw) {
  if (raw && raw !== 'auto') return raw;
  const now  = new Date();
  const hour = now.getUTCHours();
  const day  = now.getUTCDay(); // 0=Sun, 1=Mon
  if (hour === 9) return 'result';
  if (day === 1)  return 'feature';
  return 'preview';
}

// ─── Facebook API ─────────────────────────────────────────────────────────────

async function uploadPhoto(imagePath, token, pageId) {
  const imageBuffer = readFileSync(imagePath);
  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: 'image/jpeg' }), 'apptitle.jpg');
  form.append('published', 'false');
  form.append('access_token', token);

  const res  = await fetch(`https://graph.facebook.com/v25.0/${pageId}/photos`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Photo upload failed: ${JSON.stringify(body.error ?? body)}`);
  console.log(`[fb-post] Uploaded photo id=${body.id}`);
  return body.id;
}

async function createPost(message, photoId, token, pageId) {
  const payload = { message, access_token: token };
  if (photoId) payload.attached_media = JSON.stringify([{ media_fbid: photoId }]);

  const res  = await fetch(`https://graph.facebook.com/v25.0/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Post failed: ${JSON.stringify(body.error ?? body)}`);
  console.log(`[fb-post] Created post id=${body.id}`);
  return body.id;
}

// ─── Claude copy generation ───────────────────────────────────────────────────

async function generateCopy(client, prompt) {
  const msg = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages:   [{ role: 'user', content: prompt }],
  });
  return msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

function previewPrompt(fixtures) {
  const matchLines = fixtures
    .map(f => `- ${teamLabel(f.aId)} vs ${teamLabel(f.bId)} · ${kickoffLabel(f.ko)}`)
    .join('\n');

  return `You are the social media manager for "2 Sides", a football comparison and simulation app.

ABOUT THE APP (facts only — do not add or invent features):
- 2 Sides lets fans compare any two WC2026 nations head-to-head using real stats (FIFA ranking, WC history, win rate, goals, clean sheets)
- Users can run a match simulation to see who wins on paper based on the stats
- The app shows WC2026 group standings and match scores (updated daily)
- NOT a live score streaming app — do not say "real-time", "instant updates", or "never miss a goal"

Write an engaging Facebook post previewing these upcoming WC2026 matches:
${matchLines}

Rules:
- Start with a bold hook line about the clash (use emojis)
- Mention both teams with their flag emojis
- Tease the stats angle — "who has the better WC record?", "the numbers might surprise you"
- End with CTA: "Compare the squads on 2 Sides 👇" followed by: ${PLAY_STORE_URL}
- Include 4–6 hashtags: #WC2026 #FIFAWorldCup #Football #2Sides plus team-specific ones
- Total length: 120–180 words
- Tone: passionate football fan, not corporate
- Output the post text only — no preamble, no quotes`;
}

function resultPrompt(fixture, result) {
  const a    = TEAM[fixture.aId] ?? { name: fixture.aId, flag: '' };
  const b    = TEAM[fixture.bId] ?? { name: fixture.bId, flag: '' };
  const aWon = result.aScore > result.bScore;
  const draw = result.aScore === result.bScore;

  let statsLine = '';
  if (result.stats) {
    const s = result.stats;
    const parts = [];
    if (s.possession_a != null) parts.push(`Possession: ${s.possession_a}%–${s.possession_b}%`);
    if (s.shots_on_target_a != null) parts.push(`Shots on target: ${s.shots_on_target_a}–${s.shots_on_target_b}`);
    if (parts.length) statsLine = `\nStats: ${parts.join(' | ')}`;
  }

  return `You are the social media manager for "2 Sides", a football comparison and simulation app.

ABOUT THE APP (facts only — do not add or invent features):
- 2 Sides lets fans compare any two WC2026 nations head-to-head using real stats
- Users can simulate matchups to see who wins on paper
- NOT a live score app — do not say "real-time", "instant", or "live updates"

Write an engaging Facebook post reporting this WC2026 result:

${a.flag} ${a.name} ${result.aScore}–${result.bScore} ${b.name} ${b.flag}
Outcome: ${draw ? 'Draw' : aWon ? `${a.name} win` : `${b.name} win`}${statsLine}

Rules:
- Open with "⚽ FULL TIME" and the scoreline
- One sentence on the match — dominant, shock result, close contest
- Tie it back to the stats angle: "Did the numbers predict this?" or "What did the head-to-head say?"
- End with CTA: "Run the matchup on 2 Sides 👇" followed by: ${PLAY_STORE_URL}
- Include 4–6 hashtags: #WC2026 #FIFAWorldCup #Football #2Sides plus team names
- Total length: 100–150 words
- Tone: excited football fan, grounded in stats
- Output the post text only`;
}

function featurePrompt(topic) {
  return `You are the social media manager for "2 Sides", a football comparison and simulation app.

ABOUT THE APP (facts only — do not add or invent features):
- Core feature: compare any two WC2026 nations head-to-head using real stats (FIFA ranking, WC titles, appearances, win rate, goals scored, clean sheets, and more)
- Secondary feature: simulate any WC2026 matchup to see who wins on paper based on the stats
- Also shows WC2026 group standings and match scores (updated daily — NOT live streaming)
- Has pre-match notifications to remind users before kickoff
- Simple, clean app — pick two sides, compare, simulate, decide
- Do NOT mention: live scores, real-time updates, instant notifications, streaming, or any feature not listed above

Write an engaging Facebook post promoting this specific feature:
Feature: ${topic.topic}
Detail: ${topic.detail}

Rules:
- Open with a punchy question or bold statement tied to WC2026 right now
- Explain the feature in 2 sentences max — what it does, why it's useful during the tournament
- Keep it honest and grounded — no exaggeration about what the app does
- End with CTA: "Try it free on 2 Sides 👇" followed by: ${PLAY_STORE_URL}
- Include 4–5 hashtags: #WC2026 #Football #FootballStats #2Sides #FIFAWorldCup
- Total length: 100–150 words
- Tone: confident, football-savvy fan — not hype, not corporate
- Output the post text only`;
}

// ─── Post type handlers ───────────────────────────────────────────────────────

async function handlePreview(client) {
  const nowMs    = Date.now();
  const windowLo = nowMs + 16 * 3_600_000;  // 16h from now
  const windowHi = nowMs + 30 * 3_600_000;  // 30h from now

  const upcoming = WC2026_FIXTURES.filter(f => {
    const koMs = new Date(f.ko).getTime();
    return koMs >= windowLo && koMs <= windowHi;
  });

  if (upcoming.length === 0) {
    console.log('[fb-post] preview: no fixtures in 16–30h window — nothing to post');
    return null;
  }

  console.log(`[fb-post] preview: ${upcoming.length} fixture(s) in window: ${upcoming.map(f => f.id).join(', ')}`);
  const text = await generateCopy(client, previewPrompt(upcoming));
  return { text, fixtures: upcoming.map(f => f.id) };
}

async function handleResult(client) {
  const results  = loadJson(join(WC_DIR, 'results.json'), { matches: {} });
  const posted   = loadJson(join(WC_DIR, 'posted-results.json'), { posted: [] });
  const postedSet = new Set(posted.posted);
  const nowMs    = Date.now();

  // Fixtures with scores, not yet posted, completed within last 20h
  const toPost = WC2026_FIXTURES.filter(f => {
    if (postedSet.has(f.id)) return false;
    const r = results.matches?.[f.id];
    if (!r?.played || r.aScore == null) return false;
    const koMs = new Date(f.ko).getTime();
    return (nowMs - koMs) < 20 * 3_600_000;
  });

  if (toPost.length === 0) {
    console.log('[fb-post] result: no new results to post');
    return null;
  }

  // Post one result at a time to keep posts focused
  const fixture = toPost[0];
  const result  = results.matches[fixture.id];
  console.log(`[fb-post] result: posting ${fixture.id} — ${fixture.aId} ${result.aScore}–${result.bScore} ${fixture.bId}`);

  const text = await generateCopy(client, resultPrompt(fixture, result));

  // Mark as posted
  posted.posted.push(fixture.id);
  saveJson(join(WC_DIR, 'posted-results.json'), posted);

  return { text, fixtureId: fixture.id };
}

async function handleFeature(client) {
  const indexFile = join(WC_DIR, 'feature-post-index.json');
  const indexData = loadJson(indexFile, { lastIndex: -1 });
  const nextIndex = (indexData.lastIndex + 1) % FEATURE_TOPICS.length;
  const topic     = FEATURE_TOPICS[nextIndex];

  console.log(`[fb-post] feature: topic index ${nextIndex} — "${topic.topic}"`);

  const text = await generateCopy(client, featurePrompt(topic));

  indexData.lastIndex = nextIndex;
  saveJson(indexFile, indexData);

  return { text, topicIndex: nextIndex };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey   = process.env.ANTHROPIC_API_KEY?.trim();
  const fbToken  = process.env.FB_PAGE_ACCESS_TOKEN?.trim();
  const fbPageId = process.env.FB_PAGE_ID?.trim();

  if (!apiKey)   { console.error('[fb-post] ANTHROPIC_API_KEY is not set'); process.exit(1); }
  if (!fbToken)  { console.error('[fb-post] FB_PAGE_ACCESS_TOKEN is not set'); process.exit(1); }
  if (!fbPageId) { console.error('[fb-post] FB_PAGE_ID is not set'); process.exit(1); }

  const postType = resolvePostType(process.env.POST_TYPE);
  console.log(`[fb-post] Running post type: ${postType}`);

  const client    = new Anthropic({ apiKey });
  const imagePath = join(ROOT, 'assets', 'apptitle.jpg');

  let result;
  if      (postType === 'preview') result = await handlePreview(client);
  else if (postType === 'result')  result = await handleResult(client);
  else if (postType === 'feature') result = await handleFeature(client);
  else { console.error(`[fb-post] Unknown POST_TYPE: ${postType}`); process.exit(1); }

  if (!result) {
    console.log('[fb-post] Nothing to post — exiting cleanly');
    return;
  }

  console.log(`[fb-post] Generated copy (${result.text.length} chars):\n---\n${result.text}\n---`);

  const photoId = await uploadPhoto(imagePath, fbToken, fbPageId);
  await createPost(result.text, photoId, fbToken, fbPageId);

  console.log('[fb-post] ✓ Done');
}

main().catch(err => {
  console.error('[fb-post] Fatal:', err);
  process.exit(1);
});
