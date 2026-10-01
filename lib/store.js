/**
 * Config persistence for the Sub2API usage plugin.
 *
 * Two files under the DSH home (mode 0600, atomic rename):
 *   sub2api-usage.json          — everything that is safe to read out loud
 *   sub2api-usage.secrets.json  — credential / password only
 *
 * The secret file is written on every save that changes either field and is
 * never sent to the browser (the API returns a masked hint instead).
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_CONFIG, normalizeConfig } from './core.js';

const CONFIG_FILE = 'sub2api-usage.json';
const SECRETS_FILE = 'sub2api-usage.secrets.json';

/** DSH home first (DSH_HOME), legacy ~/.dsh second. */
export function resolveDataDir(env = process.env) {
  const configured = typeof env?.DSH_SUB2API_DIR === 'string' ? env.DSH_SUB2API_DIR.trim() : '';
  if (configured !== '') return configured;
  const home = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (home !== '') return home;
  try {
    return join(homedir(), '.dsh');
  } catch {
    return join(process.cwd(), '.dsh');
  }
}

async function readJson(path) {
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`读取 ${path} 失败：${error.message}`);
  }
}

async function atomicWriteJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    // Windows and some filesystems have no POSIX mode bits; harmless.
  }
}

export class ConfigStore {
  /**
   * @param dir - directory holding both files.
   * @param hooks - test seam: `onRead` fires once per real file read, so a test
   *   can prove that concurrent callers share a single load.
   */
  constructor(dir = resolveDataDir(), hooks = {}) {
    this.dir = dir;
    this.configPath = join(dir, CONFIG_FILE);
    this.secretsPath = join(dir, SECRETS_FILE);
    this.hooks = hooks;
    /** In-flight first load; concurrent callers await this exact promise. */
    this.loading = undefined;
    /** Write queue, so two saves never interleave their merge-and-write. */
    this.queue = Promise.resolve();
    this.config = normalizeConfig(DEFAULT_CONFIG);
    this.credential = '';
    this.password = '';
    this.loaded = false;
  }

  /**
   * Single-flight load. Without it, a slow background load started at apply()
   * can resolve after a save and overwrite the just-saved credential in memory
   * (the file stays correct, but every later query uses an empty credential).
   */
  async load() {
    if (this.loaded) return this;
    if (this.loading === undefined) {
      this.loading = (async () => {
        await mkdir(this.dir, { recursive: true });
        this.hooks.onRead?.();
        const [saved, secrets] = await Promise.all([readJson(this.configPath), readJson(this.secretsPath)]);
        this.config = normalizeConfig({ ...DEFAULT_CONFIG, ...saved });
        this.credential = typeof secrets.credential === 'string' ? secrets.credential : '';
        this.password = typeof secrets.password === 'string' ? secrets.password : '';
        this.loaded = true;
      })();
    }
    try {
      await this.loading;
    } finally {
      this.loading = undefined;
    }
    return this;
  }

  /** The full config including secrets — host side only. */
  full() {
    return { ...this.config, credential: this.credential, password: this.password };
  }

  /**
   * Apply a patch. `credential`/`password` use three-state semantics:
   * absent/undefined → keep, any string (including '') → replace.
   * Saves are serialized: each one merges onto the state the previous left.
   */
  update(patch = {}) {
    const run = async () => {
      await this.load();
      const nextCredential = typeof patch.credential === 'string' ? patch.credential.trim() : this.credential;
      const nextPassword = typeof patch.password === 'string' ? patch.password : this.password;
      const merged = normalizeConfig({ ...this.full(), ...patch, credential: nextCredential, password: nextPassword });
      this.config = merged;
      this.credential = nextCredential;
      this.password = nextPassword;
      const { credential, password, ...safe } = merged;
      await atomicWriteJson(this.configPath, safe);
      await atomicWriteJson(this.secretsPath, { credential, password });
      return this.full();
    };
    const chained = this.queue.then(run, run);
    this.queue = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }

  /** Absolute paths, for diagnostics and the README. */
  paths() {
    return { config: this.configPath, secrets: this.secretsPath };
  }
}
