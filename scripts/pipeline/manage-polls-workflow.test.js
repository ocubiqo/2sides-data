/**
 * The manage-polls workflow form lists categories by hand (GitHub has no way to
 * load a choice list from a file), so this keeps it equal to categories.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/manage-polls.yml'), 'utf8');

test('workflow category choices equal config/categories.json', () => {
  const m = yml.match(/category:[\s\S]*?options:\s*\[([^\]]+)\]/);
  assert.ok(m, 'category options not found');
  const options = m[1].split(',').map(s => s.trim());
  const cats = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/categories.json'), 'utf8')).categories.map(c => c.id);
  assert.deepEqual(options, cats);
});

test('workflow stays within GitHub\'s 25-input limit and never interpolates inputs into run blocks', () => {
  const inputs = yml.split('\n    inputs:\n')[1].split(/\n# |\nconcurrency/)[0].match(/^ {6}[a-z_]+:$/gm);
  assert.ok(inputs.length <= 25, `${inputs.length} inputs`);
  // A run: body is the lines indented deeper than the `run:` key itself.
  const lines = yml.split('\n');
  lines.forEach((line, n) => {
    const m = line.match(/^(\s*)run:/);
    if (!m) return;
    const body = [line];
    for (let k = n + 1; k < lines.length && (lines[k].trim() === '' || lines[k].search(/\S/) > m[1].length); k++) body.push(lines[k]);
    assert.ok(!/\$\{\{\s*inputs\./.test(body.join('\n')), `inputs interpolated in run: block at line ${n + 1}`);
  });
});
