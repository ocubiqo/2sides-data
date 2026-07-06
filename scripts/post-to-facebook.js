/**
 * Facebook + Instagram auto-poster for the 2 Sides football page.
 * Posts knockout match previews and result recaps — no weekly/feature posts.
 *
 * Env vars (required):
 *   ANTHROPIC_API_KEY       — Claude API key
 *   FB_PAGE_ACCESS_TOKEN    — Never-expiring Facebook Page Access Token
 *   FB_PAGE_ID              — Numeric Facebook Page ID
 *   POST_TYPE               — 'preview' | 'result' | 'auto'
 *
 * Env vars (optional — Instagram posting skipped if absent):
 *   IG_USER_ID              — Instagram Business Account ID
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = join(__dirname, '..');
const WC_DIR  = join(ROOT, 'wc2026');

const PLAY_STORE_URL  = 'https://play.google.com/store/apps/details?id=com.ocubiqo.twosides';
const ASSETS_BASE_URL = 'https://raw.githubusercontent.com/ocubiqo/2sides-data/main/assets';

// Promo images rotated randomly across posts (promo-01 PNG excluded — too large for FB upload)
const PROMO_IMAGES = [
  'promo-02-top-players.jpg',
  'promo-03-deep-analysis.jpg',
  'promo-04-results.jpg',
  'promo-05-records.jpg',
  'promo-06-every-fan.jpg',
  'promo-07-feature-graphic.jpg',
];

function pickRandomImage() {
  return PROMO_IMAGES[Math.floor(Math.random() * PROMO_IMAGES.length)];
}

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

// ─── Knockout fixtures loader ──────────────────────────────────────────────────

function loadKnockoutFixtures() {
  const path = join(WC_DIR, 'knockout-fixtures.json');
  if (!existsSync(path)) return [];
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    // Filter out placeholder entries where teams haven't been determined yet
    return (data.fixtures ?? []).filter(f => f.aId && f.bId);
  } catch { return []; }
}

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

function roundLabel(fixture) {
  // Use the round field from knockout-fixtures.json if present, else 'Group Stage'
  return fixture.round ?? 'Group Stage';
}

function isKnockout(fixture) {
  return !!fixture.round;
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
  return 'result'; // Always try result first → falls back to preview if no new results
}

// ─── Facebook API ─────────────────────────────────────────────────────────────

async function uploadPhoto(imagePath, filename, token, pageId) {
  const imageBuffer = readFileSync(imagePath);
  const mimeType    = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const form = new FormData();
  form.append('source', new Blob([imageBuffer], { type: mimeType }), filename);
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

// ─── Instagram API ────────────────────────────────────────────────────────────

async function postToInstagram(caption, imageUrl, token, igUserId) {
  // Step 1 — create media container
  const containerRes = await fetch(`https://graph.facebook.com/v25.0/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url:    imageUrl,
      caption,
      access_token: token,
    }),
  });
  const container = await containerRes.json();
  if (!containerRes.ok || container.error) {
    throw new Error(`IG container failed: ${JSON.stringify(container.error ?? container)}`);
  }
  console.log(`[ig-post] Container created id=${container.id}`);

  // Step 2 — publish the container
  const publishRes = await fetch(`https://graph.facebook.com/v25.0/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id:  container.id,
      access_token: token,
    }),
  });
  const published = await publishRes.json();
  if (!publishRes.ok || published.error) {
    throw new Error(`IG publish failed: ${JSON.stringify(published.error ?? published)}`);
  }
  console.log(`[ig-post] Published id=${published.id}`);
  return published.id;
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
  const ko = fixtures.some(isKnockout);
  const matchLines = fixtures
    .map(f => `- [${roundLabel(f)}] ${teamLabel(f.aId)} vs ${teamLabel(f.bId)} · ${kickoffLabel(f.ko)}`)
    .join('\n');

  return `You are the social media manager for "2 Sides", a football comparison and simulation app.

ABOUT THE APP (facts only — do not add or invent features):
- 2 Sides lets fans compare any two WC2026 nations head-to-head using real stats (FIFA ranking, WC history, win rate, goals scored, clean sheets)
- Users can run a match simulation to see who wins on paper based on the stats
- NOT a live score streaming app — do not say "real-time", "instant updates", or "never miss a goal"

Write a DRAMATIC, high-energy Facebook post previewing these upcoming WC2026 ${ko ? 'KNOCKOUT' : ''} matches:
${matchLines}

TONE & STYLE — drive maximum engagement:
${ko ? `- This is KNOCKOUT football. One team GOES HOME TONIGHT. Use that tension.
- Make a bold stats-backed prediction: "The numbers heavily favour [Team] — and [Other Team] knows it"
- Use knockout language: "ELIMINATION NIGHT", "LAST CHANCE", "NO WAY BACK", "HISTORY ON THE LINE"
- Finish with a debate starter: "Who advances? Drop your prediction 👇"
- Make fans of BOTH teams feel something — either confident or afraid` :
`- Make a bold claim fans will want to argue about
- Use strong language: "This could get UGLY", "Don't sleep on [team]", "The stats are not kind to [team]"
- Tease a shocking stat angle: "You won't believe what the head-to-head record shows..."`}
- Mention both teams with their flag emojis
- End with CTA: "Back your side on 2 Sides 👇" followed by: ${PLAY_STORE_URL}
- Include 4–6 hashtags: #WC2026 #FIFAWorldCup #Football #2Sides plus team-specific ones
- Total length: 130–190 words
- Output the post text only — no preamble, no quotes`;
}

function resultPrompt(fixture, result) {
  const a    = TEAM[fixture.aId] ?? { name: fixture.aId, flag: '' };
  const b    = TEAM[fixture.bId] ?? { name: fixture.bId, flag: '' };
  const aWon = result.aScore > result.bScore;
  const draw = result.aScore === result.bScore;
  const ko   = isKnockout(fixture);
  const round = roundLabel(fixture);

  let statsLine = '';
  if (result.stats) {
    const s = result.stats;
    const parts = [];
    if (s.possession_a != null) parts.push(`Possession: ${s.possession_a}%–${s.possession_b}%`);
    if (s.shots_on_target_a != null) parts.push(`Shots on target: ${s.shots_on_target_a}–${s.shots_on_target_b}`);
    if (parts.length) statsLine = `\nStats: ${parts.join(' | ')}`;
  }

  const upset = ko && (
    (aWon && ['argentina','brazil','france','england','spain','germany','portugal'].includes(fixture.bId)) ||
    (!aWon && !draw && ['argentina','brazil','france','england','spain','germany','portugal'].includes(fixture.aId))
  );

  return `You are the social media manager for "2 Sides", a football comparison and simulation app.

ABOUT THE APP (facts only — do not add or invent features):
- 2 Sides lets fans compare any two WC2026 nations head-to-head using real stats
- Users can simulate matchups to see who wins on paper
- NOT a live score app — do not say "real-time", "instant", or "live updates"

Write a DRAMATIC, ragebait Facebook post about this WC2026 ${round} result:

${a.flag} ${a.name} ${result.aScore}–${result.bScore} ${b.name} ${b.flag}
Outcome: ${draw ? 'Draw' : aWon ? `${a.name} WIN — ${ko ? b.name + ' ELIMINATED' : ''}` : `${b.name} WIN — ${ko ? a.name + ' ELIMINATED' : ''}`}${statsLine}

TONE & STYLE — maximise comments, shares, and reactions:
${ko && upset ? `- SHOCK RESULT ENERGY: "THAT IS AN ELIMINATION. [Underdog] just sent [Favourite] HOME 🤯"
- Rub salt in the wound respectfully: "The stats had [Favourite] as heavy favourites… football wrote a different story"
- Demand reaction: "Comment 😭 if you're devastated or 🔥 if you called this"` :
ko ? `- "IT'S OVER FOR [Eliminated team]. Full stop."
- Make fans argue: frame a controversial angle on the result ("Was it deserved? The stats will spark debate")
- Use: "HISTORY MADE", "DREAM IS OVER", or challenge fans to defend the loser` :
draw ? `- Treat a draw as a controversy: "BOTH teams dropped points there. Who bottled it?"
- Debate starter: "[Team A] fans livid or [Team B] fans disappointed — which is worse?"` :
`- Bold take on the winning team: are they genuine contenders or flattered to deceive?
- Stats callout: did the numbers back the winner or was this a heist?`}
- Tie back to app: "What does the head-to-head comparison say? Check 2 Sides 👇"
- End with CTA followed by: ${PLAY_STORE_URL}
- Include 4–6 hashtags: #WC2026 #FIFAWorldCup #Football #2Sides plus team names
- Total length: 110–160 words
- Output the post text only`;
}

// ─── Instagram copy prompts ───────────────────────────────────────────────────
// Instagram captions need a punchy first line (shows before "more"), slightly
// shorter text, and more hashtags (10–20 works well for reach).

const APP_CONTEXT = `ABOUT 2 SIDES (facts only — never invent or exaggerate features):
- Comparison app: pick any two WC2026 nations and compare them side by side using real stats (FIFA ranking, WC titles, win rate, goals, clean sheets, WC appearances)
- Simulation: run a matchup to see who wins on paper based on the stats
- Shows WC2026 group standings and match scores (updated daily — NOT live streaming)
- Pre-match notifications to remind users before kickoff
- Simple, clean app — pick two sides, compare, simulate, decide
- Do NOT mention: live scores, real-time updates, instant goals, streaming, or anything not listed above`;

function igPreviewPrompt(fixtures) {
  const ko = fixtures.some(isKnockout);
  const matchLines = fixtures
    .map(f => `[${roundLabel(f)}] ${teamLabel(f.aId)} vs ${teamLabel(f.bId)} · ${kickoffLabel(f.ko)}`)
    .join('\n');

  return `You are the Instagram manager for "2 Sides", a football comparison and simulation app.

${APP_CONTEXT}

Write a DRAMATIC Instagram caption previewing these WC2026 ${ko ? 'KNOCKOUT' : ''} matches:
${matchLines}

Rules:
- First line: explosive hook — under 10 words, emojis, maximum tension${ko ? ' ("ONE TEAM\'S DREAM ENDS TONIGHT")' : ''}
- 2–3 sentences: teams, what's at stake, bold stats-backed prediction
${ko ? `- Use elimination language: "NO SECOND CHANCE", "SURVIVE OR GO HOME"
- Make a clear prediction and invite disagreement: "We're backing [Team] — fight us in the comments 🔥"` :
`- Strong opinion fans will argue about: "The stats say this isn't even close"
- Tease which team the numbers favour`}
- End with: "Back your side on 2 Sides — link in bio 👆"
- Add 14–20 hashtags on a new line: #WC2026 #Football #WorldCup2026 #FIFAWorldCup #2Sides plus team-specific
- Total caption: 80–130 words
- Output the caption only`;
}

function igResultPrompt(fixture, result) {
  const a    = TEAM[fixture.aId] ?? { name: fixture.aId, flag: '' };
  const b    = TEAM[fixture.bId] ?? { name: fixture.bId, flag: '' };
  const aWon = result.aScore > result.bScore;
  const draw = result.aScore === result.bScore;
  const ko   = isKnockout(fixture);
  const round = roundLabel(fixture);

  let statsLine = '';
  if (result.stats) {
    const s = result.stats;
    const parts = [];
    if (s.possession_a != null) parts.push(`Possession ${s.possession_a}%–${s.possession_b}%`);
    if (s.shots_on_target_a != null) parts.push(`SoT ${s.shots_on_target_a}–${s.shots_on_target_b}`);
    if (parts.length) statsLine = `\nStats: ${parts.join(' | ')}`;
  }

  return `You are the Instagram manager for "2 Sides", a football comparison and simulation app.

${APP_CONTEXT}

Write a DRAMATIC Instagram caption for this WC2026 ${round} result:
${a.flag} ${a.name} ${result.aScore}–${result.bScore} ${b.name} ${b.flag}
Outcome: ${draw ? 'Draw' : aWon ? `${a.name} WIN${ko ? ` — ${b.name} ELIMINATED` : ''}` : `${b.name} WIN${ko ? ` — ${a.name} ELIMINATED` : ''}`}${statsLine}

Rules:
- First line: the scoreline as the hook — make it land hard with emojis${ko ? ' ("THEY\'RE OUT. IT\'S OVER.")' : ''}
- 2 sentences: what happened + a spicy take (robbery? deserved? stats said this all along?)
${ko ? `- "Did the stats see this coming? Check the head-to-head on 2 Sides 👇"` :
`- Tie to stats: "Did the numbers predict this?"
- Invite argument: "Deserved or lucky? Drop your verdict 👇"`}
- End with: "Compare on 2 Sides — link in bio 👆"
- Add 12–18 hashtags on a new line
- Total caption: 70–110 words
- Output the caption only`;
}

// ─── Post type handlers ───────────────────────────────────────────────────────

async function handlePreview(client) {
  const nowMs    = Date.now();
  const windowLo = nowMs + 16 * 3_600_000;  // 16h from now
  const windowHi = nowMs + 30 * 3_600_000;  // 30h from now

  const allFixtures = [...WC2026_FIXTURES, ...loadKnockoutFixtures()];
  const upcoming = allFixtures.filter(f => {
    const koMs = new Date(f.ko).getTime();
    return koMs >= windowLo && koMs <= windowHi;
  });

  if (upcoming.length === 0) {
    console.log('[fb-post] preview: no fixtures in 16–30h window — nothing to post');
    return null;
  }

  console.log(`[fb-post] preview: ${upcoming.length} fixture(s) in window: ${upcoming.map(f => f.id).join(', ')}`);
  const text = await generateCopy(client, previewPrompt(upcoming));
  return { text, fixtures: upcoming.map(f => f.id), fixturesData: upcoming };
}

async function handleResult(client) {
  const results   = loadJson(join(WC_DIR, 'results.json'), { matches: {} });
  const posted    = loadJson(join(WC_DIR, 'posted-results.json'), { posted: [] });
  const postedSet = new Set(posted.posted);
  const nowMs     = Date.now();

  const allFixtures = [...WC2026_FIXTURES, ...loadKnockoutFixtures()];

  // Fixtures with scores, not yet posted, completed within last 36h
  const toPost = allFixtures.filter(f => {
    if (postedSet.has(f.id)) return false;
    const r = results.matches?.[f.id];
    if (!r?.played || r.aScore == null) return false;
    const koMs = new Date(f.ko).getTime();
    return (nowMs - koMs) < 36 * 3_600_000;
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

  return { text, fixtureId: fixture.id, matchResult: result, fixture };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey   = process.env.ANTHROPIC_API_KEY?.trim();
  const fbToken  = process.env.FB_PAGE_ACCESS_TOKEN?.trim();
  const fbPageId = process.env.FB_PAGE_ID?.trim();
  const igUserId = process.env.IG_USER_ID?.trim(); // optional

  if (!apiKey)   { console.error('[post] ANTHROPIC_API_KEY is not set'); process.exit(1); }
  if (!fbToken)  { console.error('[post] FB_PAGE_ACCESS_TOKEN is not set'); process.exit(1); }
  if (!fbPageId) { console.error('[post] FB_PAGE_ID is not set'); process.exit(1); }
  if (!igUserId) console.log('[post] IG_USER_ID not set — skipping Instagram');

  const isAuto   = !process.env.POST_TYPE || process.env.POST_TYPE === 'auto';
  const postType = resolvePostType(process.env.POST_TYPE);
  console.log(`[post] Running post type: ${postType}${isAuto ? ' (auto)' : ''}`);

  const client        = new Anthropic({ apiKey });
  const imageFilename = pickRandomImage();
  const imagePath     = join(ROOT, 'assets', imageFilename);
  const imageUrl      = `${ASSETS_BASE_URL}/${imageFilename}`;
  console.log(`[post] Using image: ${imageFilename}`);

  let result;
  if (postType === 'result') {
    result = await handleResult(client);
    if (!result && isAuto) {
      console.log('[post] No new results — falling back to match preview');
      result = await handlePreview(client);
    }
  } else if (postType === 'preview') {
    result = await handlePreview(client);
  } else {
    console.error(`[post] Unknown POST_TYPE: ${postType}`); process.exit(1);
  }

  if (!result) {
    console.log('[post] Nothing to post — exiting cleanly');
    return;
  }

  // ── Facebook ──
  console.log(`[fb-post] Generated copy (${result.text.length} chars):\n---\n${result.text}\n---`);
  const photoId = await uploadPhoto(imagePath, imageFilename, fbToken, fbPageId);
  await createPost(result.text, photoId, fbToken, fbPageId);

  // ── Instagram ──
  if (igUserId) {
    try {
      const igPromptFn = result.fixturesData
        ? () => igPreviewPrompt(result.fixturesData)
        : () => igResultPrompt(result.fixture, result.matchResult);

      const igCaption = await generateCopy(client, igPromptFn());
      console.log(`[ig-post] Generated caption (${igCaption.length} chars):\n---\n${igCaption}\n---`);
      await postToInstagram(igCaption, imageUrl, fbToken, igUserId);
    } catch (err) {
      console.warn('[ig-post] Skipped — Instagram posting failed (non-fatal):', err.message);
    }
  }

  console.log('[post] ✓ Done');
}

main().catch(err => {
  console.error('[fb-post] Fatal:', err);
  process.exit(1);
});
