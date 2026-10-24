/**
 * Topic id generation, shared by the batch generator (generate-topics.js) and
 * the admin path (manage-topics.js). Extracted from generate-topics.js, which
 * could not be imported (it runs main() and needs ANTHROPIC_API_KEY).
 *
 * Ids look like `in-2026-10-us-tariff-standoff-hold` and must match the data
 * schema's `^[a-z]{2}-[0-9]{4}-[0-9]{2}-[a-z0-9-]+$`.
 */
import fs from 'fs';
import path from 'path';

const STOPWORDS = new Set(['should', 'india', 'the', 'a', 'an', 'be', 'to', 'of', 'in', 'is', 'for', 'do']);

export function slugify(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** in-YYYY-MM-<slug>, suffixed -2, -3… on collision with anything in `taken` (which it updates). */
export function makeId(country, question, taken, now = new Date()) {
  const prefix = `${country.toLowerCase()}-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const base = `${prefix}-${slugify(question) || 'topic'}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Every topic id already on disk — active, pending, rejected and archive — so ids are never reused. */
export function existingIds(root, country) {
  const ids = new Set();
  for (const sub of ['active', 'pending', 'rejected', 'archive']) {
    const dir = path.join(root, 'topics', country, sub);
    if (!fs.existsSync(dir)) continue;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.json')) ids.add(e.name.replace(/\.json$/, ''));
      }
    };
    walk(dir);
  }
  return ids;
}
