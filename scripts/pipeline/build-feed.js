#!/usr/bin/env node
/**
 * build-feed.js — assembles feeds/<country>/feed.json + manifest.json.
 *
 * Merges editorial topics with machine-written tallies, downsamples the tally
 * history into the fixed-length series the UI draws, ranks, and trims. Cheap and
 * LLM-free, so it can run every 15 minutes.
 *
 * Usage: node scripts/pipeline/build-feed.js [--country IN] [--limit 60]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '../..');
/** Points in the emitted series. 7 = one per day over the chart's week window. */
const TREND_POINTS = 7;

function parseArgs(argv) {
  const args = { country: 'IN', limit: 60, allowEmpty: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--country') args.country = argv[++i];
    else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--allow-empty') args.allowEmpty = true;
  }
  return args;
}

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Picks TREND_POINTS evenly spaced samples, always keeping the first and last
 * so the "X% → Y%" label the UI derives from the ends stays truthful.
 * Returns [] for a series too short to describe a trend — the UI hides the row
 * rather than drawing a flat line that implies stability we haven't observed.
 */
function downsample(history) {
  if (!Array.isArray(history) || history.length < 2) return [];
  if (history.length <= TREND_POINTS) return history.map(p => p.pct);

  const step = (history.length - 1) / (TREND_POINTS - 1);
  return Array.from({ length: TREND_POINTS }, (_, i) =>
    history[Math.round(i * step)].pct,
  );
}

/** "+9" / "-4" / "0" over the emitted window. */
function deltaLabel(series) {
  if (series.length < 2) return '0';
  const d = series[series.length - 1] - series[0];
  return d > 0 ? `+${d}` : String(d);
}

function rank(topic, tally) {
  const hours = (Date.now() - new Date(topic.publishedAt).getTime()) / 3_600_000;
  const recency = Math.pow(0.5, hours / 36);
  const trend = (topic.trendScore || 50) / 100;
  // A topic nobody has voted on yet should still surface, so the floor is 1.
  const engagement = Math.log10(Math.max(1, tally.current.total)) / 6;
  return trend * recency * (1 + engagement);
}

/** Down-weights a third-or-later consecutive topic from the same category. */
function interleave(topics) {
  const out = [];
  const pending = [...topics];
  let lastCat = null, run = 0;

  while (pending.length) {
    let idx = pending.findIndex(t => (t.category !== lastCat || run < 2));
    if (idx === -1) idx = 0;
    const [picked] = pending.splice(idx, 1);
    run = picked.category === lastCat ? run + 1 : 1;
    lastCat = picked.category;
    out.push(picked);
  }
  return out;
}

function main() {
  const { country, limit, allowEmpty } = parseArgs(process.argv.slice(2));
  const activeDir = path.join(ROOT, 'topics', country, 'active');
  if (!fs.existsSync(activeDir)) {
    console.error(`✗ no topics/${country}/active directory`);
    process.exit(1);
  }

  const now = Date.now();
  const nowIso = new Date().toISOString();
  const categories = readJson(path.join(ROOT, 'config', 'categories.json'), { categories: [] });

  const candidates = fs.readdirSync(activeDir)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(activeDir, f)))
    .filter(Boolean)
    .filter(t => t.status === 'published')
    .filter(t => new Date(t.activeFrom).getTime() <= now)
    .filter(t => new Date(t.activeUntil).getTime() > now);

  const emptyTally = {
    current: { yes: 0, no: 0, total: 0, pct: 0, asOf: nowIso, velocity: 0 },
    history: [], regions: [],
  };

  const enriched = candidates.map(topic => {
    const tally = readJson(path.join(ROOT, 'tallies', country, `${topic.id}.json`), emptyTally);
    const series = downsample(tally.history);

    return {
      topic: {
        id: topic.id,
        category: topic.category,
        question: topic.question,
        context: topic.context,
        sides: topic.sides,
        sources: topic.sources.map(s => ({
          name: s.name, url: s.url, verified: s.verified, publishedAt: s.publishedAt,
        })),
        bookmarks: topic.bookmarks || 0,
        publishedAt: topic.publishedAt,
        activeUntil: topic.activeUntil,
        contentVersion: topic.contentVersion,
        tally: {
          yes: tally.current.yes,
          no: tally.current.no,
          total: tally.current.total,
          pct: tally.current.pct,
          asOf: tally.current.asOf,
          velocity: tally.current.velocity || 0,
          // Empty until a topic has two snapshots — the UI hides the chart then.
          trend: series.map((p, i) => ({
            at: (tally.history[Math.min(i, tally.history.length - 1)] || {}).at || nowIso,
            pct: p,
          })),
          delta: deltaLabel(series),
          regions: [
            { label: 'India', pct: tally.current.pct, votes: tally.current.total },
            ...(tally.regions || []).slice(0, 2)
              .map(r => ({ label: r.label, pct: r.pct, votes: r.votes })),
          ],
        },
      },
      score: rank(topic, tally.current ? tally : emptyTally),
    };
  });

  const topics = interleave(
    enriched.sort((a, b) => b.score - a.score).slice(0, limit).map(e => e.topic),
  );

  // Publishing an empty feed is a silent outage: every user gets "no topics"
  // and the cause looks like a network problem. An empty active/ is almost
  // always a mistake, so it has to be asked for explicitly.
  if (topics.length === 0 && !allowEmpty) {
    console.error(`✗ refusing to publish an empty feed for ${country} — topics/${country}/active has no publishable topic`);
    console.error('  pass --allow-empty if that is genuinely intended');
    process.exit(1);
  }

  // "sample" means the tallies are synthetic and the app must badge every
  // number as such. validate-data.js refuses to pass a synthetic tally while
  // this says "live", so the flip cannot happen while invented data remains.
  const dataMode = process.env.DATA_MODE ?? 'sample';
  if (!['sample', 'live'].includes(dataMode)) {
    console.error(`✗ DATA_MODE must be "sample" or "live", got "${dataMode}"`);
    process.exit(1);
  }

  const body = { schemaVersion: 1, country, generatedAt: nowIso, categories: categories.categories, topics };
  const feedVersion = `${nowIso}-${crypto.createHash('sha1')
    .update(JSON.stringify(topics)).digest('hex').slice(0, 6)}`;

  writeJson(path.join(ROOT, 'feeds', country, 'feed.json'), { ...body, feedVersion });
  writeJson(path.join(ROOT, 'feeds', country, 'manifest.json'), {
    feedVersion,
    topicCount: topics.length,
    generatedAt: nowIso,
    dataMode,
    // Must stay <= the shipped app.json version or the client-side gate this
    // feeds would lock every existing install out of the app.
    minAppVersion: '2.3.0',
    ads: {
      enabled: true,
      graceVotes: 10,
      interstitialEveryNVotes: 5,
      interstitialMinGapSec: 90,
      nativeEveryNTopics: 0,
      rewardedInsights: false,
    },
  });

  const withTrend = topics.filter(t => t.tally.trend.length > 0).length;
  console.log(`✓ feed: ${topics.length} topic(s), ${withTrend} with a trend series · dataMode=${dataMode}`);
  console.log(`  feedVersion ${feedVersion}`);
}

main();
