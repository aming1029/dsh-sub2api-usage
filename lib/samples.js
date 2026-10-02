/**
 * Hourly usage sampling.
 *
 * The panel can chart days straight from the site's `daily_usage`, but no
 * Sub2API endpoint hands out hours for a site key:
 *
 *   GET /v1/usage?…&granularity=hour   → 200, still day buckets only
 *   GET /api/v1/usage/dashboard/…      → 401 "Invalid token" (needs a login)
 *
 * So the host derives hours from what it already receives: every response
 * carries a *running* total for today (`usage.today`, or today's row in
 * `daily_usage`). Differencing two consecutive responses gives the usage of the
 * elapsed interval, which is added to the bucket of the hour it ended in.
 *
 * Consequences, kept honest on purpose:
 *   - hours only exist while DSH was running (no samples, no bucket),
 *   - an hour nobody sampled stays a hole and is never drawn as 0,
 *   - a delta that spans a long gap is attributed to the hour it arrived in and
 *     the bucket is flagged `partial`, so the tooltip can say so.
 */
export const HOURLY_FILE = 'sub2api-usage.hourly.json';

/** Two weeks of buckets is far more than the chart can show. */
export const HOURLY_RETAIN_HOURS = 336;

/** A sample gap beyond this is treated as an interrupted run. */
export const HOURLY_GAP_MINUTES = 90;

/** Numbers the sampler differences, in the order they are persisted. */
export const HOURLY_METRICS = ['cost', 'actual', 'requests', 'tokens'];

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/** Wall-clock day + hour in the site's timezone, with a UTC fallback. */
export function zoneParts(date, timezone) {
  const when = date instanceof Date ? date : new Date(date);
  const zone = typeof timezone === 'string' && timezone.trim() !== '' ? timezone.trim() : 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(when);
    const read = (type) => parts.find((part) => part.type === type)?.value ?? '';
    const day = `${read('year')}-${read('month')}-${read('day')}`;
    const hour = String(Number(read('hour')) % 24).padStart(2, '0');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}$/.test(hour)) return { day, hour, zone };
  } catch {
    // Unknown IANA name: fall through to UTC rather than failing the query.
  }
  const iso = when.toISOString();
  return { day: iso.slice(0, 10), hour: iso.slice(11, 13), zone: 'UTC' };
}

/** `2026-10-02T13:00` — sortable, and readable in the JSON file. */
export function hourKey(date, timezone) {
  const { day, hour } = zoneParts(date, timezone);
  return `${day}T${hour}:00`;
}

/** Window keys ending at the hour containing `now`, oldest first. */
export function hourKeysEndingAt(now, timezone, hours) {
  const count = Math.max(1, Math.min(HOURLY_RETAIN_HOURS, Math.trunc(Number(hours) || 1)));
  const end = now instanceof Date ? now : new Date(now);
  const keys = [];
  for (let back = count - 1; back >= 0; back -= 1) keys.push(hourKey(new Date(end.getTime() - back * 3600 * 1000), timezone));
  return keys;
}

/** Shift an hour key by whole hours (DST-free arithmetic on the key itself). */
export function shiftHourKey(key, hours) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):00$/.exec(String(key));
  if (match === null) return null;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]));
  const shifted = new Date(base + hours * 3600 * 1000);
  return `${shifted.toISOString().slice(0, 13)}:00`;
}

/**
 * The running totals this snapshot reports, or null when the site exposes no
 * usable counters. `todayKey` picks the matching row when only `daily_usage`
 * is available.
 */
export function countersFrom(snapshot, todayKey = '') {
  const today = snapshot?.today;
  if (today !== undefined && today !== null) {
    const counters = {};
    for (const metric of HOURLY_METRICS) {
      const value = Number(today[metric]);
      if (Number.isFinite(value)) counters[metric] = value;
    }
    if (Object.keys(counters).length > 0) return counters;
  }
  const rows = Array.isArray(snapshot?.daily) ? snapshot.daily : [];
  const row = (todayKey === '' ? rows[rows.length - 1] : rows.filter((item) => item && item.date === todayKey).pop()) ?? null;
  if (row === null) return null;
  const counters = {};
  const cost = Number(row.value);
  if (Number.isFinite(cost)) counters.cost = cost;
  for (const metric of ['actual', 'requests', 'tokens']) {
    const value = Number(row[metric]);
    if (Number.isFinite(value)) counters[metric] = value;
  }
  return Object.keys(counters).length > 0 ? counters : null;
}

function emptyBucket(hour) {
  return { hour, cost: 0, actual: 0, requests: 0, tokens: 0, spanMin: 0, partial: false };
}

/**
 * Keeps an hour → usage map on disk. One instance per host process.
 */
export function createSampler(options = {}) {
  const file = options.file;
  const retainHours = Number.isFinite(Number(options.retainHours)) ? Number(options.retainHours) : HOURLY_RETAIN_HOURS;
  const gapMinutes = Number.isFinite(Number(options.gapMinutes)) ? Number(options.gapMinutes) : HOURLY_GAP_MINUTES;
  const warn = typeof options.warn === 'function' ? options.warn : () => {};
  const state = { buckets: {}, last: null, samples: 0, loaded: false };
  let loading;

  async function readFile() {
    if (file === undefined) return {};
    try {
      const { readFile: read } = await import('node:fs/promises');
      const parsed = JSON.parse(await read(file, 'utf8'));
      return parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error?.code !== 'ENOENT') warn(`小时采样文件读取失败（将以空数据开始）：${error.message}`);
      return {};
    }
  }

  async function writeFile() {
    if (file === undefined) return;
    const { mkdir, rename, writeFile: write } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const payload = {
      version: 1,
      samples: state.samples,
      last: state.last,
      buckets: state.buckets,
    };
    try {
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await write(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, file);
    } catch (error) {
      warn(`小时采样文件写入失败：${error.message}`);
    }
  }

  function prune(now, timezone) {
    const oldest = shiftHourKey(hourKey(now, timezone), -retainHours);
    if (oldest === null) return 0;
    let dropped = 0;
    for (const key of Object.keys(state.buckets)) {
      if (key < oldest) {
        delete state.buckets[key];
        dropped += 1;
      }
    }
    return dropped;
  }

  return {
    async load() {
      if (state.loaded) return state;
      if (loading === undefined) {
        loading = (async () => {
          const saved = await readFile();
          const buckets = saved.buckets !== null && typeof saved.buckets === 'object' ? saved.buckets : {};
          state.buckets = {};
          for (const [key, value] of Object.entries(buckets)) {
            if (value === null || typeof value !== 'object') continue;
            const bucket = emptyBucket(key);
            for (const metric of HOURLY_METRICS) bucket[metric] = finiteOr(value[metric], 0);
            bucket.spanMin = finiteOr(value.spanMin, 0);
            bucket.partial = value.partial === true;
            state.buckets[key] = bucket;
          }
          state.last = saved.last !== null && typeof saved.last === 'object' ? saved.last : null;
          state.samples = finiteOr(saved.samples, 0);
          state.loaded = true;
        })();
      }
      try {
        await loading;
      } finally {
        loading = undefined;
      }
      return state;
    },

    /**
     * Fold one successful snapshot into the hour buckets.
     * @returns `{ added, hour, first, reason }` — `added` means the hour is now
     *   known (even when nothing was spent, which is what keeps a quiet hour at
     *   0 instead of a hole).
     */
    async observe(snapshot, { timezone = 'UTC', now = new Date() } = {}) {
      await this.load();
      const when = now instanceof Date ? now : new Date(now);
      const { day, hour } = zoneParts(when, timezone);
      const key = `${day}T${hour}:00`;
      const counters = countersFrom(snapshot, day);
      if (counters === null) return { added: false, hour: key, first: false, reason: 'no-counters' };

      const previous = state.last;
      const sample = { at: when.toISOString(), day, hour };
      for (const metric of HOURLY_METRICS) if (Number.isFinite(counters[metric])) sample[metric] = counters[metric];

      if (previous === null || typeof previous.at !== 'string') {
        state.last = sample;
        state.samples += 1;
        await writeFile();
        return { added: false, hour: key, first: true, reason: 'baseline' };
      }

      const spanMin = Math.max(0, (when.getTime() - Date.parse(previous.at)) / 60000);
      const sameDay = previous.day === day;
      // A counter that went backwards means the site's day rolled over, and the
      // current value is then the new day's total rather than a negative delta.
      const delta = {};
      for (const metric of HOURLY_METRICS) {
        const before = Number(previous[metric]);
        const current = Number(counters[metric]);
        if (!Number.isFinite(before) || !Number.isFinite(current)) continue;
        delta[metric] = sameDay ? Math.max(0, current - before) : Math.max(0, current);
      }

      const bucket = state.buckets[key] ?? emptyBucket(key);
      for (const metric of HOURLY_METRICS) {
        if (Number.isFinite(delta[metric]) && delta[metric] > 0) bucket[metric] = round6(finiteOr(bucket[metric], 0) + delta[metric]);
      }
      bucket.spanMin = round6(finiteOr(bucket.spanMin, 0) + spanMin);
      // Flag it when the delta is not a clean single interval: the bucket then
      // holds more (or less) than one hour of usage.
      if (!sameDay || spanMin > gapMinutes || Number.isNaN(Date.parse(previous.at))) bucket.partial = true;
      state.buckets[key] = bucket;
      state.last = sample;
      state.samples += 1;
      prune(when, timezone);
      await writeFile();
      return { added: true, hour: key, first: false, spanMin: round6(spanMin), partial: bucket.partial };
    },

    /**
     * The chart window: one entry per hour, `missing: true` for hours nobody
     * sampled, so the caller can leave a hole instead of drawing a zero.
     */
    read(hours, { timezone = 'UTC', now = new Date() } = {}) {
      const when = now instanceof Date ? now : new Date(now);
      const keys = hourKeysEndingAt(when, timezone, hours);
      const known = keys.map((key) => state.buckets[key]).filter(Boolean);
      return {
        hours: keys.length,
        from: keys[0],
        to: keys[keys.length - 1],
        retainedHours: retainHours,
        samples: state.samples,
        since: known.length > 0 ? known[0].hour : null,
        buckets: keys.map((key) => {
          const bucket = state.buckets[key];
          if (bucket === undefined) return { hour: key, missing: true };
          return { ...bucket };
        }),
      };
    },

    /** Test/diagnostic helper: the raw bucket map. */
    buckets() {
      return state.buckets;
    },
  };
}
