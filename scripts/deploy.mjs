/**
 * Copy this package's runtime files into the profile that has it installed.
 *
 * pnpm installs a `file:` dependency as a hard-linked clone, so an edit here may
 * or may not reach the running app: run this after a change, then let client HMR
 * (or a page refresh) pick the new bundle up.
 *
 *   node scripts/deploy.mjs                 # auto-detect the profile
 *   node scripts/deploy.mjs --profile desktop
 *   node scripts/deploy.mjs --dir <node_modules/dsh-sub2api-usage>
 *
 * Files are written in place rather than copied over the target path: when the
 * two paths share one inode, `fs.cp` refuses ("src and dest cannot be the same").
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = 'dsh-sub2api-usage';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const FILES = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'];
const DIRS = ['lib', 'scripts', 'test', 'assets'];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function targets() {
  const explicit = argValue('--dir');
  if (explicit !== undefined) return [explicit];
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  const profile = argValue('--profile');
  const names = profile !== undefined ? [profile] : ['desktop', 'web', 'tui'];
  const found = [];
  for (const name of names) {
    const candidate = join(home, 'profiles', name, 'node_modules', PACKAGE);
    try {
      await stat(join(candidate, 'package.json'));
      found.push(candidate);
    } catch {
      // not installed in that profile
    }
  }
  return found;
}

async function copyFile(from, to) {
  let bytes;
  try {
    bytes = await readFile(from);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      console.warn(`跳过缺失文件 ${from}`);
      return;
    }
    throw error;
  }
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, bytes);
}
async function copyTree(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  for (const entry of await readdir(fromDir, { withFileTypes: true })) {
    const from = join(fromDir, entry.name);
    const to = join(toDir, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else await copyFile(from, to);
  }
}

const list = await targets();
if (list.length === 0) {
  console.error(
    `没有找到已安装的 ${PACKAGE}。先安装：\ndsh plugin --profile desktop add file:${root.replace(/\\/g, '/')}`,
  );
  process.exit(1);
}

for (const target of list) {
  for (const file of FILES) await copyFile(join(root, file), join(target, file));
  for (const dir of DIRS) await copyTree(join(root, dir), join(target, dir));
  const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
  console.log(`已同步 ${PACKAGE}@${manifest.version} → ${target}`);
}
console.log('页面会在 HMR 到达后自动重载该插件；必要时按 F5 刷新。');
