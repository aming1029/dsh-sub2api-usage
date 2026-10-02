/**
 * Documentation guards. The README is the package's front page on GitHub and in
 * the DSH plugin list, so a dead screenshot path or a table-of-contents link that
 * points at a renamed heading is a real defect — and one that is invisible until
 * someone opens the page. These checks are cheap and catch exactly that.
 */
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
const lines = readme.split('\n');

/** GitHub's heading slugger, near enough: lowercase, drop punctuation, spaces to dashes. */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

const headings = lines
  .filter((line) => /^#{1,6}\s+/.test(line))
  .map((line) => slug(line.replace(/^#{1,6}\s+/, '')));

test('code fences are balanced', () => {
  const fences = lines.filter((line) => line.trimStart().startsWith('```')).length;
  assert.equal(fences % 2, 0, `found ${fences} fence markers; every block must be closed`);
});

test('every relative image and link resolves to a real file', async () => {
  const targets = new Set();
  for (const match of readme.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    targets.add(target.split('#')[0]);
  }
  assert.ok(targets.size > 0, 'the README should show at least one screenshot');
  for (const target of targets) {
    await access(join(ROOT, target)).catch(() => {
      assert.fail(`README references ${target}, which does not exist`);
    });
  }
});

test('screenshots referenced by the README are non-trivial PNGs', async () => {
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+\.png)\)/g)].map((match) => match[1]);
  assert.ok(images.length >= 3, `expected the three panel screenshots, found ${images.length}`);
  for (const image of images) {
    const bytes = await readFile(join(ROOT, image));
    assert.ok(bytes.length > 20_000, `${image} looks like a placeholder (${bytes.length} bytes)`);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${image} is not a PNG`);
  }
});

test('the table of contents points at headings that exist', () => {
  const links = [...readme.matchAll(/^- \[[^\]]+\]\(#([^)]+)\)$/gm)].map((match) => match[1]);
  assert.ok(links.length >= 10, `expected a full table of contents, found ${links.length} entries`);
  const missing = links.filter((link) => !headings.includes(link));
  assert.deepEqual(missing, [], `table of contents links without a heading: ${missing.join(', ')}`);
});

test('every documented default matches the shipped config', async () => {
  const { DEFAULT_CONFIG } = await import('../lib/core.js');
  const documented = new Map([
    ['`baseUrl`', DEFAULT_CONFIG.baseUrl],
    ['`mode`', DEFAULT_CONFIG.mode],
    ['`intervalSec`', String(DEFAULT_CONFIG.intervalSec)],
    ['`rangeDays`', String(DEFAULT_CONFIG.rangeDays)],
    ['`lowBalance`', String(DEFAULT_CONFIG.lowBalance)],
    ['`timeoutMs`', String(DEFAULT_CONFIG.timeoutMs)],
    ['`timezone`', DEFAULT_CONFIG.timezone],
    ['`paths.usage`', DEFAULT_CONFIG.paths.usage],
    ['`paths.me`', DEFAULT_CONFIG.paths.me],
    ['`paths.adminUser`', DEFAULT_CONFIG.paths.adminUser],
    ['`paths.adminUsers`', DEFAULT_CONFIG.paths.adminUsers],
    ['`custom.method`', DEFAULT_CONFIG.custom.method],
    ['`custom.path`', DEFAULT_CONFIG.custom.path],
  ]);
  for (const [label, value] of documented) {
    assert.ok(readme.includes(label), `README no longer documents ${label}`);
    assert.ok(readme.includes(value), `README does not state the real default (${value}) for ${label}`);
  }
});

test('the API routes documented for scripted use are the ones the host registers', async () => {
  const host = await readFile(join(ROOT, 'lib/index.js'), 'utf8');
  for (const route of ['/state', '/config', '/query', '/test']) {
    assert.ok(readme.includes(`/sub2api-usage/api${route}`), `README omits the ${route} route`);
    assert.ok(host.includes(`path === '${route}'`), `host half no longer serves ${route}`);
  }
});
