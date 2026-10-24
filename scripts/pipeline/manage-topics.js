#!/usr/bin/env node
/**
 * manage-topics.js — admin actions on voting topics, used by the "Manage
 * polls" workflow (and runnable locally).
 *
 *   create   add one poll (from POLL_* env vars) or many (POLL_TOPICS_JSON)
 *   reopen   give topics a new lifetime — by id, or `expired` for all lapsed
 *   retire   take a topic out of circulation (moves it to rejected/)
 *
 * Everything is read from environment variables, never from argv or shell
 * interpolation: the values are free text typed into a web form, and an
 * unescaped `"` in a question must not be able to become a shell command.
 *
 * All-or-nothing: if ANY item in a request is invalid, nothing is written.
 * A half-applied bulk submission is harder to reason about than a rejected one.
 *
 * Env (create):  POLL_QUESTION POLL_YES_LABEL POLL_NO_LABEL POLL_CONTEXT
 *                POLL_CATEGORY POLL_SOURCE_NAME POLL_SOURCE_URL
 *                POLL_EXTRA_SOURCE_URLS POLL_OPEN_DAYS POLL_TREND_SCORE POLL_TAGS
 *                — or POLL_TOPICS_JSON, a JSON array of objects with the same
 *                fields in snake_case (question, yes_label, …)
 * Env (reopen):  POLL_TOPIC_IDS (comma list, or "expired"), POLL_OPEN_DAYS
 * Env (retire):  POLL_TOPIC_IDS, POLL_REASON
 * Env (all):     POLL_REQUESTED_BY (required), POLL_COUNTRY (default IN),
 *                POLL_DRY_RUN=true, POLL_SKIP_SOURCE_CHECK=true,
 *                POLL_SUMMARY_FILE (markdown appended here, e.g. $GITHUB_STEP_SUMMARY)
 *
 * Usage: node scripts/pipeline/manage-topics.js <create|reopen|retire>
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { buildManualTopic } from './lib/manual-topic.js';
import { existingIds } from './lib/topic-id.js';
import { activeUntilFor } from './lib/topic-lifetime.js';
import { normalizeQuestion } from './lib/normalize.js';
import { checkUrl } from './lib/probe.js';
import { classify, isAllowlisted, OUTCOME } from './lib/liveness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '../..');

const readJson = (f, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
};
const writeJson = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
};
const truthy = v => ['true', '1', 'yes'].includes(String(v ?? '').toLowerCase());
const csv = v => String(v ?? '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

/** Every question already on disk (any state), normalised the way validate-data.js compares them. */
function existingQuestions(root, country) {
  const out = new Set();
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) {
        const t = readJson(full);
        if (t?.question) out.add(normalizeQuestion(t.question));
      }
    }
  };
  walk(path.join(root, 'topics', country));
  return out;
}

/** Checks each source link; dead links are errors, unreachable ones only warn, allowlisted + live get `verified`. */
async function checkSources(topic, domains, checker, errors, warnings) {
  for (const source of topic.sources) {
    const result = await checker(source.url, 8000);
    const outcome = classify(result, isAllowlisted(source.url, domains));
    const detail = result.errorKind ? result.errorKind : `HTTP ${result.status}`;
    if (outcome === OUTCOME.DEAD) {
      errors.push(`source ${source.url}: link is dead (${detail}) — check it for typos`);
    } else if (outcome === OUTCOME.UNVERIFIABLE) {
      warnings.push(`source ${source.url}: could not be checked (${detail}); kept, not badged verified`);
    } else if (outcome === OUTCOME.VERIFIED) {
      source.verified = true;
    }
  }
}

function summaryLine(change) {
  const w = (change.warnings ?? []).map(x => `\n  - ⚠️ ${x}`).join('');
  return `- ${change.icon} \`${change.id}\` — ${change.text}${w}`;
}

/**
 * Pure-ish entry point (the CLI below is a thin wrapper) so tests can drive
 * the whole thing against a temp directory.
 * @returns { ok, errors, changes: [{id, icon, text, warnings}], summaryMd }
 */
export async function runManage(action, env, opts = {}) {
  const root = opts.root ?? DEFAULT_ROOT;
  const now = opts.now ?? Date.now();
  const checker = opts.checker ?? checkUrl;
  const dryRun = opts.dryRun ?? truthy(env.POLL_DRY_RUN);
  const skipSourceCheck = opts.skipSourceCheck ?? truthy(env.POLL_SKIP_SOURCE_CHECK);

  const country = (env.POLL_COUNTRY || 'IN').trim();
  const requestedBy = (env.POLL_REQUESTED_BY || '').trim();
  const errors = [];
  const changes = [];
  const nowIso = new Date(now).toISOString();

  const dir = sub => path.join(root, 'topics', country, sub);
  const activePath = id => path.join(dir('active'), `${id}.json`);

  if (!['create', 'reopen', 'retire'].includes(action)) {
    return { ok: false, errors: [`unknown action "${action}" (use create, reopen or retire)`], changes, summaryMd: '' };
  }
  if (!/^[\w.@ -]{1,60}$/.test(requestedBy)) {
    return { ok: false, errors: ['requested_by: required — who is making this change'], changes, summaryMd: '' };
  }

  // Staged writes, applied only if everything validated.
  const writes = [];   // [path, json]
  const deletes = [];  // [path]

  if (action === 'create') {
    const rules = readJson(path.join(root, 'config/poll-rules.json'));
    const categoryIds = readJson(path.join(root, 'config/categories.json'), { categories: [] }).categories.map(c => c.id);
    const tiers = readJson(path.join(root, 'config/review-tiers.json'), {});
    const domains = readJson(path.join(root, 'config/source-allowlist.json'), { domains: [] }).domains ?? [];
    if (!rules) return { ok: false, errors: ['config/poll-rules.json is missing'], changes, summaryMd: '' };

    let items;
    if (env.POLL_TOPICS_JSON && env.POLL_TOPICS_JSON.trim()) {
      try { items = JSON.parse(env.POLL_TOPICS_JSON); } catch (e) {
        return { ok: false, errors: [`topics_json is not valid JSON: ${e.message}`], changes, summaryMd: '' };
      }
      if (!Array.isArray(items) || items.length === 0 || items.some(i => !i || typeof i !== 'object' || Array.isArray(i))) {
        return { ok: false, errors: ['topics_json must be a non-empty array of poll objects'], changes, summaryMd: '' };
      }
    } else {
      items = [{
        question: env.POLL_QUESTION, yes_label: env.POLL_YES_LABEL, no_label: env.POLL_NO_LABEL,
        context: env.POLL_CONTEXT, category: env.POLL_CATEGORY, source_name: env.POLL_SOURCE_NAME,
        source_url: env.POLL_SOURCE_URL, extra_source_urls: env.POLL_EXTRA_SOURCE_URLS,
        open_days: env.POLL_OPEN_DAYS, trend_score: env.POLL_TREND_SCORE, tags: env.POLL_TAGS,
      }];
    }
    if (items.length > 20) return { ok: false, errors: ['at most 20 polls per run'], changes, summaryMd: '' };

    const ctx = {
      now, rules, categoryIds, tiers, runId: env.GITHUB_RUN_ID ?? 'local',
      takenIds: existingIds(root, country), takenQuestions: existingQuestions(root, country),
    };

    items.forEach((item, i) => {
      const prefix = items.length > 1 ? `poll ${i + 1}: ` : '';
      const r = buildManualTopic({ country, requested_by: requestedBy, ...item }, ctx);
      if (!r.ok) { r.errors.forEach(e => errors.push(prefix + e)); return; }
      r.warnings = r.warnings.map(w => prefix + w);
      changes.push({
        id: r.topic.id, icon: '✅', topic: r.topic, warnings: r.warnings,
        text: `${r.topic.question} → /t/${r.topic.id}`,
      });
    });

    if (!errors.length && !skipSourceCheck) {
      for (const c of changes) await checkSources(c.topic, domains, checker, errors, c.warnings);
    }
    if (!errors.length) for (const c of changes) writes.push([activePath(c.id), c.topic]);
  }

  if (action === 'reopen' || action === 'retire') {
    const requested = csv(env.POLL_TOPIC_IDS);
    if (requested.length === 0) errors.push('topic_ids: required (a comma-separated list' + (action === 'reopen' ? ', or "expired"' : '') + ')');

    let ids = requested;
    if (action === 'reopen' && requested.length === 1 && requested[0].toLowerCase() === 'expired') {
      ids = fs.existsSync(dir('active'))
        ? fs.readdirSync(dir('active')).filter(f => f.endsWith('.json'))
            .map(f => readJson(path.join(dir('active'), f)))
            .filter(t => t && t.status === 'published' && Date.parse(t.activeUntil) <= now)
            .map(t => t.id)
        : [];
      if (ids.length === 0) return { ok: true, errors: [], changes, summaryMd: '_No expired topics — nothing to reopen._\n' };
    }

    const openDaysRaw = (env.POLL_OPEN_DAYS ?? '').trim();
    const openDays = openDaysRaw === '' ? 0 : Number(openDaysRaw);
    if (action === 'reopen' && (!Number.isInteger(openDays) || openDays < 0 || openDays > 3650)) {
      errors.push(`open_days: whole number 0–3650, where 0 means open-ended (got "${openDaysRaw}")`);
    }

    for (const id of ids) {
      if (!/^[a-z]{2}-[0-9]{4}-[0-9]{2}-[a-z0-9-]+$/.test(id)) { errors.push(`${id}: not a valid topic id`); continue; }
      const topic = readJson(activePath(id));
      if (!topic) { errors.push(`${id}: not found among active topics`); continue; }
      if (topic.status !== 'published') { errors.push(`${id}: status is "${topic.status}", expected published`); continue; }

      if (action === 'reopen') {
        const next = { ...topic, activeUntil: activeUntilFor(now, openDays) };
        writes.push([activePath(id), next]);
        changes.push({ id, icon: '🔓', topic: next, text: `reopened until ${next.activeUntil.slice(0, 10)}` });
      } else {
        const next = {
          ...topic,
          status: 'retracted',
          review: { ...topic.review, state: 'rejected', reviewedBy: requestedBy, reviewedAt: nowIso,
                    reason: (env.POLL_REASON || '').trim() || 'retired by an admin (manage-polls)' },
        };
        writes.push([path.join(dir('rejected'), `${id}.json`), next]);
        deletes.push(activePath(id));
        changes.push({ id, icon: '🗄️', topic: next, text: `retired — its page and feed entry are removed on the next deploy` });
      }
    }
  }

  const ok = errors.length === 0;
  if (ok && !dryRun) {
    for (const [p, data] of writes) writeJson(p, data);
    for (const p of deletes) fs.unlinkSync(p);
  }

  const heading = { create: 'Create polls', reopen: 'Reopen topics', retire: 'Retire topics' }[action];
  const summaryMd = ok
    ? `### ${heading}${dryRun ? ' — dry run, nothing written' : ''}\n\n${changes.map(summaryLine).join('\n')}\n`
    : `### ${heading} — rejected, nothing written\n\n${errors.map(e => `- ❌ ${e}`).join('\n')}\n`;

  return { ok, errors, changes: changes.map(({ topic, ...c }) => c), summaryMd };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const action = process.argv[2];
  const result = await runManage(action, process.env, { dryRun: process.argv.includes('--dry-run') || undefined });
  console.log(result.summaryMd);
  if (process.env.POLL_SUMMARY_FILE) fs.appendFileSync(process.env.POLL_SUMMARY_FILE, result.summaryMd + '\n');
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error('✗ manage-topics failed:', err); process.exit(1); });
}
