/**
 * Sub2API usage — client (browser) half.
 *
 * A `window.__ModuleLoader__.load` browser module (no build step, no JSX):
 *  · `sidebar.footer.action` — a live balance chip at the sidebar foot
 *  · `sidebar.panellist`     — the global-panel icon
 *  · `main` (key)            — the usage detail panel itself
 *
 * All data comes from this package's host half over same-origin HTTP, so the
 * credential stays on the host and the upstream site needs no CORS headers.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sub2api-usage',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var PANEL_ID = 'sub2api-usage';
    var API = '/sub2api-usage/api';
    var LABEL = 'Sub2API 用量';

    var CSS = `
.s2u-root{height:100%;overflow:auto;padding:calc(var(--dsh-frame-top-clearance,0px) + 18px) 26px 96px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px;line-height:1.55;box-sizing:border-box}
.s2u-root *{box-sizing:border-box}
.s2u-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.s2u-title{font-size:17px;font-weight:600;letter-spacing:.01em}
.s2u-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.s2u-spacer{flex:1}
.s2u-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;transition:background .12s ease,border-color .12s ease}
.s2u-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.s2u-btn:disabled{opacity:.5;cursor:not-allowed}
.s2u-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.s2u-btn-primary:hover:not(:disabled){filter:brightness(1.08)}
.s2u-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:16px}
.s2u-tab{appearance:none;background:none;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);padding:7px 12px;font-size:13px;cursor:pointer;font-family:inherit}
.s2u-tab[data-active="true"]{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.s2u-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.s2u-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px}
.s2u-card-wide{grid-column:1/-1}
.s2u-label{color:var(--dsw-alias-label-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.s2u-value{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}
.s2u-value-sm{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.s2u-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-top:4px;word-break:break-all}
.s2u-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.s2u-row:last-child{border-bottom:none}
.s2u-row-key{color:var(--dsw-alias-label-secondary)}
.s2u-row-val{font-variant-numeric:tabular-nums;text-align:right;word-break:break-all}
.s2u-bar{position:relative;height:7px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:8px}
.s2u-bar>i{position:absolute;inset:0 auto 0 0;border-radius:99px;background:var(--dsw-alias-brand-primary);display:block}
.s2u-bar>i[data-state="warn"]{background:var(--dsw-alias-state-warn-primary)}
.s2u-bar>i[data-state="error"]{background:var(--dsw-alias-state-error-primary)}
.s2u-chart{margin-top:8px}
.s2u-chart-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.s2u-chart-stats{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:10px}
.s2u-chart-stats b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
.s2u-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.s2u-seg>button{appearance:none;border:0;border-right:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;padding:3px 10px;cursor:pointer;transition:background .12s ease}
.s2u-seg>button:last-child{border-right:0}
.s2u-seg>button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.s2u-seg>button[data-active="true"]{background:var(--dsw-alias-brand-primary);color:#fff}
.s2u-seg>button:disabled{opacity:.45;cursor:not-allowed}
.s2u-chart-canvas{position:relative;width:100%}
.s2u-chart-svg{display:block;width:100%;height:auto;overflow:visible;outline:none}
.s2u-chart-svg:focus-visible .s2u-chart-frame{stroke:var(--dsw-alias-brand-primary)}
.s2u-chart-frame{fill:var(--dsw-alias-bg-layer-2);fill-opacity:.35;stroke:var(--dsw-alias-border-l1)}
.s2u-chart-grid{stroke:var(--dsw-alias-border-l1);stroke-dasharray:2 4}
.s2u-chart-area{fill:var(--dsw-alias-brand-primary);fill-opacity:.13;stroke:none}
.s2u-chart-line{fill:none;stroke:var(--dsw-alias-brand-primary);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.s2u-chart-dot{fill:var(--dsw-alias-bg-base);stroke:var(--dsw-alias-brand-primary);stroke-width:2}
.s2u-chart-hit{fill:transparent}
.s2u-chart-hit:hover{fill:var(--dsw-alias-brand-primary);fill-opacity:.06}
.s2u-chart-hit[data-on="true"]{fill:var(--dsw-alias-brand-primary);fill-opacity:.09}
.s2u-chart-tick{fill:var(--dsw-alias-label-tertiary);font-size:10px;font-variant-numeric:tabular-nums}
.s2u-chart-cross{stroke:var(--dsw-alias-brand-primary);stroke-width:1;stroke-dasharray:3 3;fill:none}
.s2u-chart-tip{position:absolute;transform:translate(-50%,-100%);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.55;white-space:nowrap;pointer-events:none;box-shadow:0 8px 22px rgba(0,0,0,.18);z-index:3}
.s2u-chart-tip b{display:block;font-size:12px;font-variant-numeric:tabular-nums}
.s2u-chart-tip i{font-style:normal;color:var(--dsw-alias-label-tertiary)}
.s2u-chart-tip i+span{font-variant-numeric:tabular-nums;float:right;margin-left:12px;color:var(--dsw-alias-label-primary)}
.s2u-chart-tip div{overflow:hidden}
.s2u-banner{border-radius:9px;padding:10px 13px;margin-bottom:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font-size:12px}
.s2u-banner[data-tone="error"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.s2u-banner[data-tone="warn"]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}
.s2u-banner[data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.s2u-banner b{display:block;margin-bottom:2px}
.s2u-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.s2u-field{display:flex;flex-direction:column;gap:5px}
.s2u-field>span{color:var(--dsw-alias-label-secondary);font-size:12px}
.s2u-field>em{color:var(--dsw-alias-label-tertiary);font-size:11px;font-style:normal}
.s2u-input,.s2u-select,.s2u-area{width:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font-size:12.5px;font-family:inherit;outline:none}
.s2u-input:focus,.s2u-select:focus,.s2u-area:focus{border-color:var(--dsw-alias-brand-primary)}
.s2u-area{min-height:74px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.s2u-fieldset{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;margin:0 0 14px}
.s2u-fieldset>legend{padding:0 6px;color:var(--dsw-alias-label-tertiary);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.s2u-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.s2u-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.s2u-dot{width:7px;height:7px;border-radius:99px;background:var(--dsw-alias-state-idle-primary);display:inline-block;flex:none}
.s2u-dot[data-state="ok"]{background:var(--dsw-alias-state-success-primary)}
.s2u-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary)}
.s2u-dot[data-state="warn"]{background:var(--dsw-alias-state-warn-primary)}
.s2u-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.s2u-pre{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;max-height:340px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.s2u-table{width:100%;border-collapse:collapse;font-size:12.5px}
.s2u-table th{text-align:left;color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.s2u-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-variant-numeric:tabular-nums}
.s2u-table td.num{text-align:right}
.s2u-footchip{display:inline-flex;align-items:center;gap:7px;max-width:100%;appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:8px;padding:5px 9px;font-size:12px;font-family:inherit;cursor:pointer;transition:background .12s ease}
.s2u-footchip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.s2u-footchip .v{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary)}
.s2u-footchip .m{color:var(--dsw-alias-label-tertiary);font-size:11px}
.s2u-glyph{display:inline-flex;align-items:center;justify-content:center;position:relative}
.s2u-glyph .alert{position:absolute;right:-2px;top:-2px;width:6px;height:6px;border-radius:99px;background:var(--dsw-alias-state-warn-primary)}
.s2u-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:18px 0;text-align:center}
.s2u-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
@media(max-width:900px){.s2u-split{grid-template-columns:minmax(0,1fr)}}
`;

    function installStyles() {
      var el = document.createElement('style');
      el.setAttribute('data-dsh-plugin', PANEL_ID);
      el.textContent = CSS;
      document.head.appendChild(el);
      return function disposeStyles() {
        el.remove();
      };
    }

    // ---------------------------------------------------------------- helpers

    function money(value, symbol) {
      if (value === undefined || value === null || Number.isNaN(Number(value))) return '—';
      var text = Math.abs(Number(value)) >= 1000 ? Number(value).toFixed(0) : Number(value).toFixed(2);
      return (symbol || '$') + text;
    }

    function compactNumber(value) {
      var n = Number(value);
      if (!Number.isFinite(n)) return '—';
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
      return String(Math.round(n * 100) / 100);
    }

    function clockText(iso) {
      if (!iso) return '';
      var date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
    }

    // ------------------------------------------------------------ chart maths
    // Kept in this bundle on purpose: the browser half may only require("react"),
    // so it cannot import lib/core.js. Everything below is pure and is pinned by
    // the geometry assertions in test/client.test.mjs.

    /**
     * Axis/tooltip number formatting. `decimals` comes from the tick step, so a
     * 0 / 0.5 / 1 / 1.5 / 2 axis reads as $0.00 / $0.50 / $1.00 / $1.50 / $2.00
     * instead of mixing $0 with $0.7500.
     */
    function chartText(value, symbol, kind, decimals) {
      var n = Number(value);
      if (!Number.isFinite(n)) return '—';
      var sign = n < 0 ? '-' : '';
      var abs = Math.abs(n);
      var prefix = kind === 'cost' ? (symbol || '') : '';
      var places = Number.isFinite(Number(decimals)) ? Math.max(0, Math.min(6, Math.round(Number(decimals)))) : null;
      var trimmed = function (divisor, suffix) {
        return sign + prefix + (abs / divisor).toFixed(1).replace(/\.0$/, '') + suffix;
      };
      if (places !== null && abs < 1e4) return sign + prefix + abs.toFixed(places);
      if (abs >= 1e9) return trimmed(1e9, 'B');
      if (abs >= 1e6) return trimmed(1e6, 'M');
      if (abs >= 1e4) return trimmed(1e3, 'k');
      if (abs >= 100) return sign + prefix + Math.round(abs);
      if (abs >= 1) return sign + prefix + abs.toFixed(2);
      if (abs === 0) return prefix + '0';
      return sign + prefix + abs.toFixed(4);
    }

    /** How many decimals a given tick step needs to stay uniform. */
    /**
     * Decimals for an axis step. Money never drops below cents, counts never
     * gain a pointless `.0`, and either kind gets extra digits when the step is
     * not exactly representable without them (0.375 must not print as 0.38).
     */
    function stepDecimals(step, kind) {
      var value = Math.abs(Number(step));
      if (!Number.isFinite(value) || value <= 0) return kind === 'cost' ? 2 : 0;
      var floor = kind === 'cost'
        ? (value >= 100 ? 0 : 2)
        : (value >= 1 ? 0 : value >= 0.1 ? 1 : 2);
      for (var digits = floor; digits < 6; digits += 1) {
        if (Math.abs(Number(value.toFixed(digits)) - value) < 1e-9) return digits;
      }
      return 6;
    }

    function groupDigits(value) {
      var n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** Round a maximum up to 1 / 2 / 2.5 / 5 × 10ⁿ so axis labels read cleanly. */
    function niceCeil(value, steps) {
      var target = Number(value);
      if (!Number.isFinite(target) || target <= 0) return 1;
      var rough = target / steps;
      var magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
      var normalized = rough / magnitude;
      var step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
      var niceStep = step * magnitude;
      // toPrecision kills float noise such as 0.08000000000000002.
      return Number((Math.ceil(target / niceStep) * niceStep).toPrecision(12));
    }

    /** `2026-10-01` → `10-01`; labels that are not dates pass through. */
    function shortDay(date) {
      var text = date === undefined || date === null ? '' : String(date);
      var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
      return match ? match[2] + '-' + match[3] : text;
    }

    function round2(value) {
      return Math.round(value * 100) / 100;
    }

    /**
     * Plot geometry for a trend line: pixels, path strings and axis ticks.
     * An all-zero series still gets a real axis; one point gets a centred dot.
     * A row whose value is not a finite number keeps its slot on the x axis but
     * breaks the line — that is how "nobody sampled this hour" stays a hole
     * instead of becoming a fake zero.
     */
    function buildChart(rows, options) {
      var opts = options || {};
      var list = rows || [];
      var width = Number(opts.width) > 0 ? Number(opts.width) : 640;
      var height = Number(opts.height) > 0 ? Number(opts.height) : 176;
      var padLeft = opts.padLeft === undefined ? 46 : opts.padLeft;
      var padRight = opts.padRight === undefined ? 14 : opts.padRight;
      var padTop = opts.padTop === undefined ? 12 : opts.padTop;
      var padBottom = opts.padBottom === undefined ? 22 : opts.padBottom;
      var steps = opts.steps === undefined ? 4 : opts.steps;
      var labelOf = typeof opts.label === 'function' ? opts.label : function (row) { return shortDay(row && row.date); };

      var slotCount = Math.max(1, list.length);
      var plot = {
        left: padLeft,
        right: Math.max(padLeft + 1, width - padRight),
        top: padTop,
        bottom: Math.max(padTop + 1, height - padBottom),
      };
      var plotWidth = plot.right - plot.left;
      var plotHeight = plot.bottom - plot.top;

      // null/undefined/'' mean "unknown", and Number(null) is 0 — so read the
      // value the same defensive way the metric pickers do.
      var readValue = function (row) {
        if (!row) return NaN;
        var raw = row.value;
        if (raw === null || raw === undefined || raw === '') return NaN;
        var value = Number(raw);
        return Number.isFinite(value) ? value : NaN;
      };
      var peak = 0;
      list.forEach(function (row) {
        var value = readValue(row);
        if (value > peak) peak = value;
      });
      var max = niceCeil(peak, steps);
      var xAt = function (index) {
        return slotCount <= 1 ? plot.left + plotWidth / 2 : plot.left + (plotWidth * index) / (slotCount - 1);
      };
      var yAt = function (value) { return plot.bottom - plotHeight * (value / max); };

      var points = list.map(function (row, index) {
        var value = readValue(row);
        var known = Number.isFinite(value);
        return {
          index: index,
          x: round2(xAt(index)),
          y: known ? round2(yAt(value)) : null,
          known: known,
          value: known ? value : null,
          row: row,
        };
      });
      var knownPoints = points.filter(function (point) { return point.known; });

      // Consecutive known points form one subpath; a hole closes the current
      // one, so the very same string still describes a gapless series. A run of
      // a single point draws nothing, so it is reported for a dot instead.
      var line = '';
      var area = '';
      var isolated = [];
      var run = [];
      var flush = function () {
        if (run.length === 0) return;
        if (run.length === 1) {
          isolated.push(run[0]);
          run = [];
          return;
        }
        var segment = run.map(function (point, index) {
          return (index === 0 ? 'M' : 'L') + point.x + ' ' + point.y;
        }).join(' ');
        line = line === '' ? segment : line + ' ' + segment;
        var piece = segment + ' L' + run[run.length - 1].x + ' ' + plot.bottom + ' L' + run[0].x + ' ' + plot.bottom + ' Z';
        area = area === '' ? piece : area + ' ' + piece;
        run = [];
      };
      points.forEach(function (point) {
        if (point.known) run.push(point);
        else flush();
      });
      flush();

      // One x label per ~78px at most, always including the newest slot.
      var maxLabels = Math.max(2, Math.floor(plotWidth / 78));
      var stride = Math.max(1, Math.ceil((points.length - 1) / Math.max(1, maxLabels - 1)));
      var labelIndices = [];
      for (var index = 0; index < points.length; index += stride) labelIndices.push(index);
      if (points.length > 0 && labelIndices[labelIndices.length - 1] !== points.length - 1) labelIndices.push(points.length - 1);

      var ticks = [];
      for (var step = 0; step <= steps; step += 1) {
        var value = Number(((max / steps) * step).toPrecision(12));
        ticks.push({ value: value, y: round2(yAt(value)) });
      }

      return {
        width: width,
        height: height,
        plot: plot,
        empty: knownPoints.length === 0,
        holes: points.length - knownPoints.length,
        isolated: isolated,
        total: knownPoints.reduce(function (sum, point) { return sum + point.value; }, 0),
        peak: peak,
        points: points,
        line: line,
        area: area,
        ticks: ticks.reverse(),
        xLabels: labelIndices.map(function (index) {
          return { index: index, x: points[index].x, label: labelOf(points[index].row, index) };
        }),
      };
    }

    function ratio(used, limit) {
      if (!Number.isFinite(Number(used)) || !Number.isFinite(Number(limit)) || Number(limit) <= 0) return null;
      return Math.max(0, Math.min(1, Number(used) / Number(limit)));
    }

    function barState(fraction) {
      if (fraction === null) return 'ok';
      if (fraction >= 0.95) return 'error';
      if (fraction >= 0.75) return 'warn';
      return 'ok';
    }

    function useStoreValue(store) {
      var bump = React.useState(0)[1];
      React.useEffect(function () {
        return store.subscribe(function () {
          bump(function (n) { return n + 1; });
        });
      }, [store]);
      return store.get();
    }

    // ------------------------------------------------------------------ store

    function createStore() {
      var state = {
        config: null,
        snapshot: null,
        hourly: null,
        error: null,
        files: null,
        phase: 'loading',
        busy: false,
        toast: null,
        queriedAt: null,
        attemptedAt: null,
      };
      var listeners = new Set();
      var scheduler = null;

      function emit() {
        listeners.forEach(function (listener) { listener(); });
      }

      function set(patch) {
        state = Object.assign({}, state, patch);
        emit();
      }

      function request(path, init) {
        return fetch(API + path, Object.assign({ headers: { 'content-type': 'application/json' } }, init)).then(
          function (response) {
            if (response.status === 403) {
              throw Object.assign(new Error('仅允许本机访问该接口'), { code: 'forbidden', hint: '请在本机浏览器里打开这个页面。' });
            }
            if (response.status === 404) {
              throw Object.assign(new Error('宿主路由未加载'), { code: 'notfound', hint: '插件半区没挂上：确认 dsh-sub2api-usage 已启用，然后重启 DSH。' });
            }
            return response.json().catch(function () {
              throw Object.assign(new Error('响应不是 JSON'), { code: 'parse', hint: '' });
            });
          },
          function (error) {
            throw Object.assign(new Error('无法连接宿主接口：' + (error && error.message ? error.message : error)), { code: 'network', hint: '' });
          },
        );
      }

      function applyResult(result) {
        if (result && result.ok) {
          set({
            snapshot: result.snapshot,
            hourly: result.hourly || state.hourly,
            error: null,
            phase: 'ready',
            queriedAt: new Date().toISOString(),
          });
          return result;
        }
        var error = (result && result.error) || { code: 'internal', message: '未知错误', hint: '' };
        set({ error: error, phase: 'error' });
        return result;
      }

      function failure(error) {
        var info = { code: error.code || 'internal', message: error.message || String(error), hint: error.hint || '' };
        set({ error: info, phase: 'error', busy: false });
        return { ok: false, error: info };
      }

      var store = {
        get: function () { return state; },
        subscribe: function (listener) {
          listeners.add(listener);
          return function () { listeners.delete(listener); };
        },

        load: function () {
          var self = this;
          return request('/state', { method: 'GET' })
            .then(function (body) {
              if (!body || body.ok !== true) throw Object.assign(new Error('状态接口返回异常'), { code: 'internal', hint: '' });
              var last = body.last || {};
              set({
                config: body.config,
                files: body.files || null,
                snapshot: last.snapshot || null,
                hourly: body.hourly || null,
                error: last.error || null,
                phase: last.snapshot ? 'ready' : 'idle',
                queriedAt: last.snapshot ? last.snapshot.at : null,
              });
              return body;
            })
            .catch(function (error) { return failure(error); });
        },

        query: function (options) {
          // attemptedAt (not queriedAt) drives the ticker: a failing config must
          // not turn the poller into a 5-second retry loop.
          set({ busy: true, attemptedAt: new Date().toISOString() });
          var body = {};
          if (options && options.start && options.end) {
            body.start = options.start;
            body.end = options.end;
          } else if (options && options.days) {
            body.days = options.days;
          }
          return request('/query', { method: 'POST', body: JSON.stringify(body) })
            .then(function (result) { var out = applyResult(result); set({ busy: false }); return out; })
            .catch(function (error) { return failure(error); });
        },

        save: function (patch, options) {
          set({ busy: true });
          return request('/config', { method: 'POST', body: JSON.stringify(patch) })
            .then(function (result) {
              if (!result || result.ok !== true) throw Object.assign(new Error((result && result.error && result.error.message) || '保存失败'), { code: 'internal', hint: '' });
              set({
                config: result.config,
                busy: false,
                toast: (result.changed && result.changed.length ? '已保存：' + result.changed.join('、') : '已保存') +
                  (options && options.then === 'query' ? '，正在查询…' : ''),
              });
              return result;
            })
            .catch(function (error) { return failure(error); });
        },

        test: function (candidate) {
          return request('/test', { method: 'POST', body: JSON.stringify({ config: candidate }) });
        },

        clearToast: function () { set({ toast: null }); },

        /** Adaptive ticker: reads intervalSec on every pass, so config edits apply at once. */
        start: function () {
          if (scheduler !== null) return function () {};
          var first = true;
          var tick = function () {
            var current = state;
            if (first) {
              first = false;
              store.load().then(function () { return store.query(); });
            } else if (current.config && current.config.intervalSec > 0) {
              var stamp = current.attemptedAt || current.queriedAt;
              var last = stamp ? Date.parse(stamp) : 0;
              var wait = Math.max(current.config.intervalSec, 15) * 1000;
              if (!Number.isFinite(last) || Date.now() - last >= wait) store.query();
            }
          };
          tick();
          var id = window.setInterval(tick, 5000);
          scheduler = id;
          return function () {
            window.clearInterval(id);
            scheduler = null;
          };
        },
      };
      return store;
    }

    // ------------------------------------------------------------- components

    function Glyph(props) {
      var size = props.size || 16;
      var alert = props.alert === true;
      return h(
        'span',
        { className: 's2u-glyph', style: { width: size, height: size } },
        h(
          'svg',
          { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 6, width: 19, height: 13, rx: 3, stroke: 'currentColor', strokeWidth: 1.7 }),
          h('path', { d: 'M2.5 10h19', stroke: 'currentColor', strokeWidth: 1.7 }),
          h('circle', { cx: 17, cy: 14.5, r: 1.6, fill: 'currentColor' }),
          h('path', { d: 'M6 3.6h9.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        ),
        alert ? h('i', { className: 'alert' }) : null,
      );
    }

    function statusOf(state) {
      if (state.error) return 'error';
      if (state.snapshot) {
        var balance = state.snapshot.headline.balance;
        var threshold = state.snapshot.lowBalance;
        if (Number.isFinite(balance) && Number.isFinite(threshold) && balance < threshold) return 'warn';
        return 'ok';
      }
      return 'idle';
    }

    function balanceText(snapshot) {
      if (!snapshot) return '—';
      var value = snapshot.headline.balance;
      if (value === undefined || value === null) value = snapshot.headline.remaining;
      return money(value, snapshot.currencySymbol);
    }

    /** The sidebar-foot chip: always-visible balance, click opens the panel. */
    function UsageChip(props) {
      var state = useStoreValue(props.store);
      var tone = statusOf(state);
      // "Not configured yet" is a first-run state, not a failure.
      var text = state.snapshot
        ? balanceText(state.snapshot)
        : state.error
          ? (state.error.code === 'config' ? '未配置' : '查询失败')
          : '读取中';
      return h(
        'button',
        {
          type: 'button',
          className: 's2u-footchip',
          title: LABEL + '：' + text + (state.queriedAt ? ' · ' + clockText(state.queriedAt) : '') + '（点击查看详情）',
          onClick: function () { props.open(); },
        },
        h('i', { className: 's2u-dot', 'data-state': tone }),
        props.wide === false ? null : h('span', { className: 'v' }, text),
        props.wide === false ? null : h('span', { className: 'm' }, '用量'),
      );
    }

    /** The sidebar panel-list icon (rendered inside the shell's own button). */
    function PanelIcon(props) {
      var state = useStoreValue(props.store);
      var tone = statusOf(state);
      return h(Glyph, { size: props.size || 16, alert: tone === 'warn' || tone === 'error' });
    }

    function Row(props) {
      return h(
        'div',
        { className: 's2u-row' },
        h('span', { className: 's2u-row-key' }, props.label),
        h('span', { className: 's2u-row-val' }, props.value === undefined || props.value === null || props.value === '' ? '—' : String(props.value)),
      );
    }

    function UsageBar(props) {
      var fraction = ratio(props.used, props.limit);
      return h(
        'div',
        null,
        h(
          'div',
          { className: 's2u-row', style: { borderBottom: 'none', paddingBottom: 0 } },
          h('span', { className: 's2u-row-key' }, props.label),
          h('span', { className: 's2u-row-val' }, props.right),
        ),
        h('div', { className: 's2u-bar' }, h('i', { 'data-state': barState(fraction), style: { width: (fraction === null ? 0 : fraction * 100).toFixed(1) + '%' } })),
      );
    }

    var CHART_METRICS = [
      { key: 'cost', label: '花费', kind: 'cost', pick: function (row) { return pickNumber(row, 'value'); } },
      { key: 'requests', label: '请求', kind: 'count', pick: function (row) { return pickNumber(row, 'requests'); } },
      { key: 'tokens', label: 'Tokens', kind: 'count', pick: function (row) { return pickNumber(row, 'tokens'); } },
    ];
    var CHART_RANGES = [7, 14, 30, 90];
    /** Hourly windows: 1 day, 3 days, 7 days, and the sampler's 14-day ceiling. */
    var HOURLY_RANGES = [24, 72, 168, 336];
    var CHART_GRANULARITIES = [
      { key: 'day', label: '按天' },
      { key: 'hour', label: '按小时' },
    ];

    /** `2026-10-02T13:00` → `13:00`, widened to `10-02 13:00` for long windows. */
    function shortHour(hour, hours) {
      var text = hour === undefined || hour === null ? '' : String(hour);
      var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(text);
      if (!match) return text;
      return (Number(hours) > 36 ? match[2] + '-' + match[3] + ' ' : '') + match[4] + ':00';
    }

    /** A missing number is a hole, not a zero — never let Number() decide. */
    function pickNumber(row, field) {
      if (!row) return NaN;
      var raw = row[field];
      if (raw === null || raw === undefined || raw === '') return NaN;
      var value = Number(raw);
      return Number.isFinite(value) ? value : NaN;
    }

    function rangeLabel(hours) {
      return hours <= 24 ? hours + ' 小时' : Math.round(hours / 24) + ' 天';
    }

    /**
     * Trend line: day buckets straight from the site, hour buckets from the
     * host's local sampling. Metric switch, granularity switch, hover/keyboard
     * readout and range shortcuts; geometry comes from buildChart above, so
     * this component only places nodes.
     */
    function UsageChart(props) {
      var granularity = props.granularity === 'hour' ? 'hour' : 'day';
      var hourly = props.hourly || null;
      var windowHours = Number(props.activeHours) > 0 ? Number(props.activeHours) : Number(hourly && hourly.hours) || 24;
      var rows = granularity === 'hour' ? hourlyRows(hourly) : dailyRows(props.daily);
      var symbol = props.symbol || '$';
      var metricState = React.useState('cost');
      var metric = metricState[0];
      var setMetric = metricState[1];
      var hoverState = React.useState(-1);
      var hover = hoverState[0];
      var setHover = hoverState[1];
      var widthState = React.useState(0);
      var boxWidth = widthState[0];
      var setBoxWidth = widthState[1];
      var canvasRef = React.useRef(null);

      // The panel is resizable, so measure instead of guessing; 640 keeps the
      // first paint sensible (and the test harness has no ResizeObserver).
      React.useEffect(function () {
        var node = canvasRef.current;
        if (!node || typeof node.getBoundingClientRect !== 'function') return undefined;
        var apply = function (next) {
          var rounded = Math.round(Number(next) || 0);
          if (rounded > 0) setBoxWidth(rounded);
        };
        apply(node.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') return undefined;
        var observer = new ResizeObserver(function (entries) {
          var entry = entries && entries[0];
          var box = entry && (entry.contentRect || (entry.target && entry.target.getBoundingClientRect()));
          if (box) apply(box.width);
        });
        observer.observe(node);
        return function () { return observer.disconnect(); };
      }, []);

      var labelOf = function (key) {
        return granularity === 'hour' ? shortHour(key, windowHours) : shortDay(key);
      };
      var available = CHART_METRICS.filter(function (item) {
        return rows.some(function (row) { return Number.isFinite(item.pick(row)); });
      });
      var active = available.filter(function (item) { return item.key === metric; })[0] || available[0];

      var head = function (trailing) {
        return h(
          'div',
          { className: 's2u-chart-head' },
          h('div', { className: 's2u-seg' }, CHART_GRANULARITIES.map(function (item) {
            return h('button', {
              key: item.key,
              type: 'button',
              'data-grain': item.key,
              'data-active': String(item.key === granularity),
              onClick: function () {
                if (props.onGranularity) props.onGranularity(item.key);
                setHover(-1);
              },
            }, item.label);
          })),
          available.length > 1
            ? h('div', { className: 's2u-seg' }, available.map(function (item) {
                return h('button', {
                  key: item.key,
                  type: 'button',
                  'data-metric': item.key,
                  'data-active': String(item.key === active.key),
                  onClick: function () { setMetric(item.key); setHover(-1); },
                }, item.label);
              }))
            : null,
          granularity === 'hour'
            ? props.onHourlyRange
              ? h('div', { className: 's2u-seg' }, HOURLY_RANGES.map(function (hours) {
                  return h('button', {
                    key: hours,
                    type: 'button',
                    disabled: props.busy === true,
                    'data-active': String(windowHours === hours),
                    onClick: function () { props.onHourlyRange(hours); },
                  }, rangeLabel(hours));
                }))
              : null
            : props.onRange
              ? h('div', { className: 's2u-seg' }, CHART_RANGES.map(function (days) {
                  return h('button', {
                    key: days,
                    type: 'button',
                    disabled: props.busy === true,
                    'data-active': String(Number(props.activeDays) === days),
                    onClick: function () { props.onRange(days); },
                  }, days + ' 天');
                }))
              : null,
          h('span', { className: 's2u-spacer' }),
          (trailing || []).filter(Boolean),
        );
      };

      if (!active) {
        var message = granularity === 'hour'
          ? hourly === null
            ? '宿主没有返回小时窗口：确认插件已更新并重启 DSH。'
            : hourly.samples === 0
              ? '还没有小时数据：本机采样从插件运行后开始累计，刷新几次就有曲线了（按天视图不受影响）。'
              : '这个窗口内没有采样到小时数据——插件当时没有在运行。'
          : rows.length === 0 ? '该区间没有日用量数据' : '该站点没有返回可绘制的用量字段';
        return h('div', { className: 's2u-chart' }, head(null), h('div', { className: 's2u-empty' }, message));
      }

      var series = rows
        .map(function (row) {
          var value = active.pick(row);
          return { date: row.date, value: Number.isFinite(value) ? value : null, source: row };
        });
      var geo = buildChart(series, {
        width: boxWidth > 0 ? boxWidth : 640,
        height: 176,
        padLeft: 46,
        padRight: 14,
        padTop: 12,
        padBottom: 22,
        steps: 4,
        label: function (row) { return labelOf(row && row.date); },
      });
      var known = geo.points.filter(function (point) { return point.known; });
      var bandWidth = geo.points.length > 1
        ? Math.max(6, (geo.plot.right - geo.plot.left) / (geo.points.length - 1))
        : geo.plot.right - geo.plot.left;
      var at = hover >= 0 && hover < geo.points.length ? geo.points[hover] : null;
      var peakPoint = known.reduce(function (best, point) { return best === null || point.value > best.value ? point : best; }, null);
      var tickStep = geo.ticks.length > 1 ? Math.abs(geo.ticks[0].value - geo.ticks[1].value) : geo.ticks[0].value;
      var tickDecimals = stepDecimals(tickStep, active.kind);

      var unit = function (value) {
        if (active.kind === 'cost') return money(value, symbol);
        // Counts stay exact while they are short enough to read, then compact.
        if (Math.abs(Number(value)) >= 1e6) return chartText(value, symbol, 'count', tickDecimals) + (active.key === 'requests' ? ' 次' : '');
        return groupDigits(value) + (active.key === 'requests' ? ' 次' : '');
      };
      var exact = function (value) {
        if (active.kind === 'cost') return money(value, symbol);
        return groupDigits(value) + (active.key === 'requests' ? ' 次' : '');
      };
      var stats = [
        ['合计', unit(geo.total)],
        [granularity === 'hour' ? '时均' : '日均', unit(geo.total / Math.max(1, known.length))],
        ['峰值', unit(geo.peak) + (known.length > 1 && peakPoint ? '（' + labelOf(peakPoint.row.date) + '）' : '')],
        ['区间', known.length === 0 ? '—' : labelOf(known[0].row.date) + ' → ' + labelOf(known[known.length - 1].row.date)],
      ];
      var spanText = granularity === 'hour'
        ? known.length + ' / ' + geo.points.length + ' 小时' + (geo.holes > 0 ? '（' + geo.holes + ' 小时无采样）' : '')
        : geo.points.length + ' 个数据点';
      var ariaText = granularity === 'hour' ? spanText : geo.points.length + ' 天';

      return h(
        'div',
        { className: 's2u-chart' },
        head([h('span', { className: 's2u-hint' }, spanText)]),
        h('div', { className: 's2u-chart-stats' }, stats.map(function (pair) {
          return h('span', { key: pair[0] }, pair[0] + ' ', h('b', null, pair[1]));
        })),
        h(
          'div',
          { className: 's2u-chart-canvas', ref: canvasRef },
          h(
            'svg',
            {
              className: 's2u-chart-svg',
              viewBox: '0 0 ' + geo.width + ' ' + geo.height,
              width: geo.width,
              height: geo.height,
              role: 'img',
              tabIndex: 0,
              'data-chart': 'usage',
              'data-granularity': granularity,
              'data-points': String(geo.points.length),
              'aria-label': active.label + (granularity === 'hour' ? '按小时趋势，' : '按天趋势，') + ariaText,
              onMouseLeave: function () { setHover(-1); },
              onKeyDown: function (event) {
                var key = event && event.key;
                if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
                if (event.preventDefault) event.preventDefault();
                setHover(function (previous) {
                  var base = previous < 0 ? (key === 'ArrowRight' ? -1 : geo.points.length) : previous;
                  return Math.max(0, Math.min(geo.points.length - 1, base + (key === 'ArrowRight' ? 1 : -1)));
                });
              },
            },
            h('rect', {
              className: 's2u-chart-frame',
              x: geo.plot.left,
              y: geo.plot.top,
              width: geo.plot.right - geo.plot.left,
              height: geo.plot.bottom - geo.plot.top,
              rx: 4,
            }),
            geo.ticks.map(function (tick) {
              return h(
                'g',
                { key: 'tick' + tick.value },
                h('line', { className: 's2u-chart-grid', x1: geo.plot.left, x2: geo.plot.right, y1: tick.y, y2: tick.y }),
                h('text', { className: 's2u-chart-tick', x: geo.plot.left - 6, y: tick.y + 3, textAnchor: 'end' }, chartText(tick.value, symbol, active.kind, tickDecimals)),
              );
            }),
            geo.area ? h('path', { className: 's2u-chart-area', d: geo.area }) : null,
            geo.line ? h('path', { className: 's2u-chart-line', d: geo.line }) : null,
            // A point with no known neighbour has no line to sit on, so mark it.
            geo.isolated.map(function (point) {
              return h('circle', { key: 'dot' + point.index, className: 's2u-chart-dot', cx: point.x, cy: point.y, r: 3.5 });
            }),
            at && at.known
              ? h(
                  'g',
                  null,
                  h('line', { className: 's2u-chart-cross', x1: at.x, x2: at.x, y1: geo.plot.top, y2: geo.plot.bottom }),
                  h('circle', { className: 's2u-chart-dot', cx: at.x, cy: at.y, r: 3.5 }),
                )
              : null,
            geo.points.map(function (point) {
              return h(
                'rect',
                {
                  key: 'hit' + point.index,
                  className: 's2u-chart-hit',
                  x: round2(Math.max(geo.plot.left, point.x - bandWidth / 2)),
                  y: geo.plot.top,
                  width: round2(Math.min(bandWidth, geo.plot.right - Math.max(geo.plot.left, point.x - bandWidth / 2))),
                  height: geo.plot.bottom - geo.plot.top,
                  'data-index': point.index,
                  'data-on': String(hover === point.index),
                  'data-missing': String(!point.known),
                  onMouseEnter: function () { setHover(point.index); },
                  onFocus: function () { setHover(point.index); },
                },
                h('title', null, point.known
                  ? point.row.date + ' · ' + exact(point.value)
                  : point.row.date + ' · 无采样'),
              );
            }),
            geo.xLabels.map(function (label) {
              return h('text', {
                key: 'x' + label.index,
                className: 's2u-chart-tick',
                x: label.x,
                y: geo.height - 6,
                textAnchor: 'middle',
              }, label.label);
            }),
          ),
          at
            ? h(
                'div',
                {
                  className: 's2u-chart-tip',
                  'data-tip': at.row.date,
                  'data-missing': String(!at.known),
                  style: {
                    left: Math.max(80, Math.min(geo.width - 80, at.x)) + 'px',
                    top: Math.max(30, at.known ? at.y - 4 : geo.plot.top + 20) + 'px',
                  },
                },
                h('b', null, granularity === 'hour' ? at.row.date.replace('T', ' ').slice(0, 16) : at.row.date),
                at.known
                  ? h('div', null, h('i', null, active.label), h('span', null, exact(at.value)))
                  : h('div', null, h('i', null, '采样'), h('span', null, '这个小时没有数据')),
                at.known && Number.isFinite(Number(at.row.source && at.row.source.requests)) && active.key !== 'requests'
                  ? h('div', null, h('i', null, '请求'), h('span', null, groupDigits(at.row.source.requests) + ' 次'))
                  : null,
                at.known && Number.isFinite(Number(at.row.source && at.row.source.tokens)) && active.key !== 'tokens'
                  ? h('div', null, h('i', null, 'Tokens'), h('span', null, groupDigits(at.row.source.tokens)))
                  : null,
                at.known && Number.isFinite(Number(at.row.source && at.row.source.actual)) && Math.abs(Number(at.row.source.actual) - at.value) > 1e-9
                  ? h('div', null, h('i', null, '实际扣费'), h('span', null, money(at.row.source.actual, symbol)))
                  : null,
                granularity === 'hour' && at.known && at.row.source && Number.isFinite(Number(at.row.source.spanMin))
                  ? h('div', null, h('i', null, '采样'), h('span', null, Math.round(Number(at.row.source.spanMin)) + ' 分钟' + (at.row.source.partial === true ? '（含中断时段）' : '')))
                  : null,
              )
            : null,
        ),
        h('div', { className: 's2u-hint' }, granularity === 'hour'
          ? '鼠标移入看每小时明细，左右方向键可切换；小时数据由插件本机采样累计（DSH 运行期间），没有采样到的小时不会画成 0。'
          : '鼠标移入看单日明细，左右方向键可切换；数据来自站点返回的按天用量。'),
      );
    }

    /** Day rows: straight from the snapshot. */
    function dailyRows(daily) {
      return (daily || []).filter(function (row) { return row && row.date !== undefined; });
    }

    /**
     * Hourly rows: the host already returns one slot per hour of the window,
     * with `missing: true` where nothing was sampled. A missing slot keeps its
     * x position and breaks the line.
     */
    function hourlyRows(hourly) {
      var buckets = (hourly && hourly.buckets) || [];
      return buckets.map(function (bucket) {
        if (!bucket || bucket.missing === true) {
          return { date: bucket && bucket.hour ? bucket.hour : '', value: null, missing: true };
        }
        return {
          date: bucket.hour,
          value: pickNumber(bucket, 'cost'),
          requests: pickNumber(bucket, 'requests'),
          tokens: pickNumber(bucket, 'tokens'),
          actual: pickNumber(bucket, 'actual'),
          spanMin: pickNumber(bucket, 'spanMin'),
          partial: bucket.partial === true,
        };
      });
    }

    /** The caption next to 用量趋势: which series, how much of it, over how long. */
    function trendSubtitle(granularity, hourly, snapshot) {
      var wrap = function (text) {
        return h('span', { style: { textTransform: 'none', letterSpacing: 0, marginLeft: 8 } }, text);
      };
      if (granularity === 'hour') {
        if (hourly === null || hourly === undefined) return wrap('按小时 · 宿主未返回窗口');
        var known = ((hourly.buckets) || []).filter(function (bucket) { return bucket && bucket.missing !== true; });
        if (known.length === 0) return wrap('按小时 · 本机采样中');
        var sum = known.reduce(function (acc, bucket) { return acc + (Number(bucket.cost) || 0); }, 0);
        return wrap('按小时 · ' + money(sum, snapshot.currencySymbol) + ' / ' + known.length + ' 小时（本机采样）');
      }
      var daily = snapshot.daily || [];
      if (daily.length === 0) return null;
      return wrap(money(daily.reduce(function (acc, item) { return acc + (Number(item.value) || 0); }, 0), snapshot.currencySymbol) + ' / ' + daily.length + ' 天');
    }

    function OverviewTab(props) {
      var snapshot = props.snapshot;
      var headline = snapshot.headline;
      var used = headline.limit !== undefined ? headline.used : undefined;
      var limit = headline.limit;
      var quotaFraction = ratio(used, limit);
      // Range shortcuts re-save rangeDays so the choice also survives a reload
      // and the next automatic refresh.
      var onRange = props.store
        ? function (days) {
            props.store.save({ rangeDays: days }, { then: 'query' }).then(function (result) {
              if (result && result.ok) props.store.query();
            });
          }
        : undefined;
      // The hourly window only changes which buckets are shown, so saving it and
      // re-reading the host state is enough — no upstream request.
      var onHourlyRange = props.store
        ? function (hours) {
            setWindowHours(hours);
            props.store.save({ hourlyHours: hours }).then(function (result) {
              if (result && result.ok) props.store.load();
            });
          }
        : undefined;
      var onGranularity = function (next) {
        setGranularityView(next);
        if (props.store) props.store.save({ granularity: next });
      };
      // The saved config is the default, but the switch must move the moment it
      // is clicked: a host half that predates these two fields (only possible
      // until DSH is restarted) would otherwise bounce the view straight back.
      // Both effects only fire when the stored value itself changes, so a click
      // is never undone by the config we just read back.
      var [granularityView, setGranularityView] = React.useState(null);
      var [windowHours, setWindowHours] = React.useState(null);
      var storedGranularity = props.config && props.config.granularity === 'hour' ? 'hour' : 'day';
      var storedHours = props.config && Number(props.config.hourlyHours) > 0 ? Number(props.config.hourlyHours) : undefined;
      React.useEffect(function () {
        setGranularityView(null);
      }, [storedGranularity]);
      React.useEffect(function () {
        setWindowHours(null);
      }, [storedHours]);
      var granularity = granularityView || storedGranularity;
      return h(
        'div',
        null,
        h(
          'div',
          { className: 's2u-grid' },
          h(
            'div',
            { className: 's2u-card' },
            h('div', { className: 's2u-label' }, '钱包余额'),
            h('div', { className: 's2u-value' }, balanceText(snapshot)),
            h(
              'div',
              { className: 's2u-hint' },
              [
                headline.balancePointer ? '取自 ' + headline.balancePointer : '',
                snapshot.mode ? '模式 ' + snapshot.mode : '',
                snapshot.latencyMs ? snapshot.latencyMs + 'ms' : '',
              ].filter(Boolean).join(' · ') || '—',
            ),
          ),
          h(
            'div',
            { className: 's2u-card' },
            h('div', { className: 's2u-label' }, '账户'),
            h(
              'div',
              { className: 's2u-value-sm' },
              (snapshot.user && (snapshot.user.email || snapshot.user.name)) || snapshot.credentialHint || '—',
            ),
            h(
              'div',
              { className: 's2u-hint' },
              snapshot.user && snapshot.user.id !== undefined
                ? '用户 ID ' + snapshot.user.id
                : (snapshot.credentialHint ? '该接口不返回账号信息，按凭证查询' : '—'),
            ),
          ),
          headline.frozen !== undefined || headline.recharged !== undefined
            ? h(
                'div',
                { className: 's2u-card' },
                h('div', { className: 's2u-label' }, '冻结 / 已充值'),
                h('div', { className: 's2u-value-sm' }, money(headline.frozen, snapshot.currencySymbol) + ' / ' + money(headline.recharged, snapshot.currencySymbol)),
                h('div', { className: 's2u-hint' }, '区间 ' + (snapshot.range ? snapshot.range.start + ' → ' + snapshot.range.end : '—')),
              )
            : null,
          limit !== undefined || (headline.remaining !== undefined && headline.remaining !== headline.balance)
            ? h(
                'div',
                { className: 's2u-card' },
                h('div', { className: 's2u-label' }, headline.remaining !== undefined ? '剩余额度' : '额度'),
                h('div', { className: 's2u-value-sm' }, money(headline.remaining !== undefined ? headline.remaining : limit, snapshot.currencySymbol)),
                h('div', { className: 's2u-hint' }, headline.quotaMode ? '计费模式 ' + headline.quotaMode : '取自 ' + (snapshot.range ? snapshot.range.start + ' → ' + snapshot.range.end : '—')),
              )
            : null,
        ),
        limit !== undefined || used !== undefined
          ? h(
              'div',
              { className: 's2u-card s2u-card-wide', style: { marginTop: 12 } },
              h('div', { className: 's2u-label' }, '额度使用'),
              h(UsageBar, {
                label: '区间用量',
                used: used,
                limit: limit,
                right: money(used, snapshot.currencySymbol) + ' / ' + money(limit, snapshot.currencySymbol) + (quotaFraction === null ? '' : '（' + (quotaFraction * 100).toFixed(1) + '%）'),
              }),
            )
          : null,
        Object.keys(snapshot.subscription || {}).length > 0
          ? h(
              'div',
              { className: 's2u-card s2u-card-wide', style: { marginTop: 12 } },
              h('div', { className: 's2u-label' }, '订阅用量'),
              ['daily', 'weekly', 'monthly'].filter(function (key) { return snapshot.subscription[key]; }).map(function (key) {
                var side = snapshot.subscription[key];
                var names = { daily: '日', weekly: '周', monthly: '月' };
                return h(UsageBar, {
                  key: key,
                  label: names[key],
                  used: side.used,
                  limit: side.limit,
                  right: money(side.used, snapshot.currencySymbol) + ' / ' + money(side.limit, snapshot.currencySymbol),
                });
              }),
            )
          : null,
        h(
          'div',
          { className: 's2u-card s2u-card-wide', style: { marginTop: 12 } },
          h(
            'div',
            { className: 's2u-label' },
            '用量趋势',
            trendSubtitle(granularity, props.hourly, snapshot),
          ),
          h(UsageChart, {
            daily: snapshot.daily,
            hourly: props.hourly,
            granularity: granularity,
            symbol: snapshot.currencySymbol,
            activeDays: props.config ? props.config.rangeDays : undefined,
            activeHours: windowHours || storedHours,
            busy: props.busy === true,
            onRange: onRange,
            onHourlyRange: onHourlyRange,
            onGranularity: onGranularity,
          }),
        ),
        h(
          'div',
          { className: 's2u-split', style: { marginTop: 12 } },
          h(
            'div',
            { className: 's2u-card' },
            h('div', { className: 's2u-label' }, '模型用量'),
            (snapshot.models && snapshot.models.length
              ? snapshot.models.map(function (model, index) {
                  return h(UsageBar, {
                    key: index,
                    label: model.name,
                    used: model.cost,
                    limit: snapshot.models.reduce(function (acc, item) { return acc + (Number(item.cost) || 0); }, 0),
                    right: (model.cost === undefined ? '—' : money(model.cost, snapshot.currencySymbol)) + (model.sub ? ' · ' + model.sub : ''),
                  });
                })
              : [h('div', { key: 'empty', className: 's2u-empty' }, '该站点未返回模型统计')]),
          ),
          snapshot.rateLimits && snapshot.rateLimits.length
            ? h(
                'div',
                { className: 's2u-card' },
                h('div', { className: 's2u-label' }, '限流窗口'),
                h(
                  'table',
                  { className: 's2u-table' },
                  h('thead', null, h('tr', null, ['窗口', '已用', '上限', '剩余', '重置'].map(function (label) { return h('th', { key: label }, label); }))),
                  h(
                    'tbody',
                    null,
                    snapshot.rateLimits.map(function (item, index) {
                      return h(
                        'tr',
                        { key: index },
                        h('td', null, item.label),
                        h('td', { className: 'num' }, item.used === undefined ? '—' : compactNumber(item.used)),
                        h('td', { className: 'num' }, item.limit === undefined ? '—' : compactNumber(item.limit)),
                        h('td', { className: 'num' }, item.remaining === undefined ? '—' : compactNumber(item.remaining)),
                        h('td', { className: 'num' }, item.reset ? String(item.reset) : '—'),
                      );
                    }),
                  ),
                ),
              )
            : h(
                'div',
                { className: 's2u-card' },
                h('div', { className: 's2u-label' }, '限流窗口'),
                h('div', { className: 's2u-empty' }, '该站点未返回限流信息'),
              ),
        ),
      );
    }

    function DetailTab(props) {
      var snapshot = props.snapshot;
      var totals = snapshot.totals || [];
      var fields = snapshot.fields || [];
      var users = snapshot.users || [];
      return h(
        'div',
        null,
        snapshot.warnings && snapshot.warnings.length
          ? h('div', { className: 's2u-banner', 'data-tone': 'warn' }, snapshot.warnings.map(function (text, index) { return h('div', { key: index }, text); }))
          : null,
        users.length
          ? h(
              'div',
              { className: 's2u-card s2u-card-wide', style: { marginBottom: 12 } },
              h('div', { className: 's2u-label' }, '用户列表（' + users.length + '）'),
              h(
                'table',
                { className: 's2u-table' },
                h('thead', null, h('tr', null, ['ID', '邮箱', '余额', '冻结', '已充值', '状态'].map(function (label) { return h('th', { key: label }, label); }))),
                h(
                  'tbody',
                  null,
                  users.map(function (user, index) {
                    return h(
                      'tr',
                      { key: index },
                      h('td', null, user.id === undefined ? '—' : String(user.id)),
                      h('td', null, user.email || '—'),
                      h('td', { className: 'num' }, money(user.balance, snapshot.currencySymbol)),
                      h('td', { className: 'num' }, money(user.frozen, snapshot.currencySymbol)),
                      h('td', { className: 'num' }, money(user.recharged, snapshot.currencySymbol)),
                      h('td', null, user.status === undefined ? '—' : String(user.status)),
                    );
                  }),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 's2u-split' },
          h(
            'div',
            { className: 's2u-card' },
            h('div', { className: 's2u-label' }, '汇总字段'),
            totals.length ? totals.map(function (item, index) { return h(Row, { key: index, label: item.label, value: typeof item.value === 'object' ? JSON.stringify(item.value) : item.value }); }) : h('div', { className: 's2u-empty' }, '该站点未返回 total 字段'),
            h('div', { className: 's2u-label', style: { marginTop: 14 } }, '识别到的字段'),
            fields.length ? fields.map(function (item, index) { return h(Row, { key: index, label: item.label, value: item.value }); }) : h('div', { className: 's2u-empty' }, '没有可展示的标量字段'),
          ),
          h(
            'div',
            { className: 's2u-card' },
            h('div', { className: 's2u-label' }, '原始响应'),
            snapshot.raw.map(function (step, index) {
              return h(
                'div',
                { key: index, style: { marginBottom: 10 } },
                h('div', { className: 's2u-hint' }, step.label + ' · HTTP ' + (step.status === undefined ? '—' : step.status) + ' · ' + step.url),
                h('pre', { className: 's2u-pre' }, step.json === undefined ? '(无 JSON 响应)' : JSON.stringify(step.json, null, 2)),
              );
            }),
          ),
        ),
      );
    }

    function Field(props) {
      return h(
        'label',
        { className: 's2u-field' },
        h('span', null, props.label),
        props.children,
        props.hint ? h('em', null, props.hint) : null,
      );
    }

    var MODE_HELP = {
      auto: '按凭证形状自动判断：admin-… → 管理员，sk-… → 站点 Key，JWT/账号密码 → 用户。',
      admin: 'GET /api/v1/admin/users/:id（请求头 x-api-key: admin-…），可查任意用户余额。',
      key: 'GET /v1/usage?start_date=&end_date=（Authorization: Bearer sk-…），查该 Key 的余额、订阅与限流。',
      user: 'POST /api/v1/auth/login → GET /api/v1/auth/me，查当前登录账号。',
      custom: '完全自定义请求：方法 / 路径 / 请求头 / 请求体，自选 JSON 指针取字段。',
    };

    function SettingsTab(props) {
      var state = props.state;
      var config = state.config || {};
      var seed = function () {
        return {
          baseUrl: config.baseUrl || '',
          mode: config.mode || 'auto',
          credential: '',
          email: config.email || '',
          password: '',
          adminUserId: config.adminUserId || '',
          search: config.search || '',
          listUsers: config.listUsers === true,
          timezone: config.timezone || 'Asia/Shanghai',
          rangeDays: config.rangeDays === undefined ? 30 : config.rangeDays,
          granularity: config.granularity === 'hour' ? 'hour' : 'day',
          hourlyHours: config.hourlyHours === undefined ? 24 : config.hourlyHours,
          intervalSec: config.intervalSec === undefined ? 120 : config.intervalSec,
          lowBalance: config.lowBalance === undefined ? 5 : config.lowBalance,
          currencySymbol: config.currencySymbol || '$',
          timeoutMs: config.timeoutMs === undefined ? 15000 : config.timeoutMs,
          customMethod: (config.custom && config.custom.method) || 'GET',
          customPath: (config.custom && config.custom.path) || '',
          customHeaders: (config.custom && config.custom.headers) || '',
          customBody: (config.custom && config.custom.body) || '',
          pointerBalance: (config.pointers && config.pointers.balance) || '',
          pointerRemaining: (config.pointers && config.pointers.remaining) || '',
          pointerUsed: (config.pointers && config.pointers.used) || '',
          pointerLimit: (config.pointers && config.pointers.limit) || '',
          pathUsage: (config.paths && config.paths.usage) || '',
          pathMe: (config.paths && config.paths.me) || '',
          pathAdminUser: (config.paths && config.paths.adminUser) || '',
          pathAdminUsers: (config.paths && config.paths.adminUsers) || '',
        };
      };
      var draftState = React.useState(seed);
      var draft = draftState[0];
      var setDraft = draftState[1];
      var probeState = React.useState(null);
      var probe = probeState[0];
      var setProbe = probeState[1];
      var testingState = React.useState(false);
      var testing = testingState[0];
      var setTesting = testingState[1];

      React.useEffect(function () {
        setDraft(seed());
      }, [state.config]);

      var change = function (key) {
        return function (event) {
          var value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
          setDraft(function (previous) { return Object.assign({}, previous, { [key]: value }); });
        };
      };

      var toPatch = function (extra) {
        var patch = {
          baseUrl: draft.baseUrl,
          mode: draft.mode,
          email: draft.email,
          adminUserId: draft.adminUserId,
          search: draft.search,
          listUsers: draft.listUsers === true,
          timezone: draft.timezone,
          rangeDays: Number(draft.rangeDays),
          granularity: draft.granularity === 'hour' ? 'hour' : 'day',
          hourlyHours: Number(draft.hourlyHours),
          intervalSec: Number(draft.intervalSec),
          lowBalance: Number(draft.lowBalance),
          currencySymbol: draft.currencySymbol,
          timeoutMs: Number(draft.timeoutMs),
          custom: { method: draft.customMethod, path: draft.customPath, headers: draft.customHeaders, body: draft.customBody },
          pointers: {
            balance: draft.pointerBalance,
            remaining: draft.pointerRemaining,
            used: draft.pointerUsed,
            limit: draft.pointerLimit,
          },
          paths: {
            usage: draft.pathUsage,
            me: draft.pathMe,
            adminUser: draft.pathAdminUser,
            adminUsers: draft.pathAdminUsers,
          },
        };
        if (draft.credential !== '') patch.credential = draft.credential;
        if (draft.password !== '') patch.password = draft.password;
        if (extra && extra.credential !== undefined) patch.credential = extra.credential;
        return patch;
      };

      var save = function (event) {
        if (event) event.preventDefault();
        props.store.save(toPatch(), { then: 'query' }).then(function (result) {
          if (result && result.ok) {
            setDraft(function (previous) { return Object.assign({}, previous, { credential: '', password: '' }); });
            props.store.query();
          }
        });
      };

      var test = function () {
        setTesting(true);
        setProbe(null);
        props.store.test(toPatch()).then(function (result) {
          setTesting(false);
          setProbe(result && result.ok
            ? { tone: 'ok', title: '连接成功', detail: '模式 ' + result.snapshot.mode + ' · 余额 ' + balanceText(result.snapshot) + ' · ' + result.snapshot.latencyMs + 'ms' }
            : { tone: 'error', title: '连接失败', detail: ((result && result.error && result.error.message) || '未知错误') + (((result && result.error && result.error.hint) || '') ? ' —— ' + result.error.hint : '') });
        });
      };

      var clearCredential = function () {
        props.store.save({ credential: '', password: '' }, {}).then(function () {
          props.store.query();
        });
      };

      return h(
        'form',
        { onSubmit: save },
        probe ? h('div', { className: 's2u-banner', 'data-tone': probe.tone }, h('b', null, probe.title), probe.detail) : null,
        h(
          'fieldset',
          { className: 's2u-fieldset' },
          h('legend', null, '查询接口'),
          h(
            'div',
            { className: 's2u-form' },
            h(
              Field,
              { label: '服务地址（可自定义）', hint: '留空则用默认站点；支持任意 sub2api 部署。' },
              h('input', { className: 's2u-input', value: draft.baseUrl, onChange: change('baseUrl'), placeholder: 'https://aiapi.aaming.icu', spellCheck: false }),
            ),
            h(
              Field,
              { label: '查询模式', hint: MODE_HELP[draft.mode] || '' },
              h(
                'select',
                { className: 's2u-select', value: draft.mode, onChange: change('mode') },
                [['auto', '自动识别'], ['key', '站点 Key（sk-…）'], ['admin', '管理员（admin-… / 管理员令牌）'], ['user', '账号密码 / 访问令牌'], ['custom', '自定义请求']].map(function (pair) {
                  return h('option', { key: pair[0], value: pair[0] }, pair[1]);
                }),
              ),
            ),
            h(
              Field,
              { label: '凭证', hint: config.hasCredential ? '已保存：' + config.credentialHint + '（留空则保持不变）' : '尚未保存凭证。' },
              h('input', { className: 's2u-input', type: 'password', value: draft.credential, onChange: change('credential'), placeholder: config.hasCredential ? config.credentialHint : 'admin-… / sk-… / 访问令牌', autoComplete: 'off' }),
            ),
          ),
          draft.mode === 'user' || draft.mode === 'auto'
            ? h(
                'div',
                { className: 's2u-form', style: { marginTop: 12 } },
                h(Field, { label: '邮箱（账号模式）' }, h('input', { className: 's2u-input', value: draft.email, onChange: change('email'), placeholder: 'you@example.com', spellCheck: false })),
                h(
                  Field,
                  { label: '密码（账号模式）', hint: config.hasPassword ? '已保存密码（留空保持不变）' : '仅保存在本机 DSH 配置目录。' },
                  h('input', { className: 's2u-input', type: 'password', value: draft.password, onChange: change('password'), autoComplete: 'new-password' }),
                ),
              )
            : null,
          draft.mode === 'admin' || draft.mode === 'auto'
            ? h(
                'div',
                { className: 's2u-form', style: { marginTop: 12 } },
                h(Field, { label: '用户 ID（管理员模式）', hint: '留空或勾选下方列表则查用户列表。' }, h('input', { className: 's2u-input', value: draft.adminUserId, onChange: change('adminUserId'), placeholder: '例如 123' })),
                h(Field, { label: '搜索关键词（管理员模式）' }, h('input', { className: 's2u-input', value: draft.search, onChange: change('search'), placeholder: '邮箱或用户名' })),
                h(
                  Field,
                  { label: '拉取用户列表' },
                  h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 } },
                    h('input', { type: 'checkbox', checked: draft.listUsers === true, onChange: change('listUsers') }),
                    '按余额排序返回前若干用户（配合下方排序字段）'),
                ),
              )
            : null,
        ),
        draft.mode === 'custom'
          ? h(
              'fieldset',
              { className: 's2u-fieldset' },
              h('legend', null, '自定义请求'),
              h(
                'div',
                { className: 's2u-form' },
                h(
                  Field,
                  { label: '方法' },
                  h('select', { className: 's2u-select', value: draft.customMethod, onChange: change('customMethod') },
                    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(function (method) { return h('option', { key: method, value: method }, method); })),
                ),
                h(Field, { label: '路径', hint: '占位符：{start} {end} {timezone} {id}' }, h('input', { className: 's2u-input', value: draft.customPath, onChange: change('customPath'), spellCheck: false })),
              ),
              h('div', { style: { marginTop: 12 } },
                h(Field, { label: '请求头（JSON 对象）', hint: '例如 {"x-api-key":"admin-…"}；凭证输入框的内容不会自动加入。' }, h('textarea', { className: 's2u-area', value: draft.customHeaders, onChange: change('customHeaders'), spellCheck: false }))),
              h('div', { style: { marginTop: 12 } },
                h(Field, { label: '请求体（JSON，GET 可留空）' }, h('textarea', { className: 's2u-area', value: draft.customBody, onChange: change('customBody'), spellCheck: false }))),
            )
          : null,
        h(
          'fieldset',
          { className: 's2u-fieldset' },
          h('legend', null, '字段映射与路径'),
          h(
            'div',
            { className: 's2u-form' },
            h(Field, { label: '余额 JSON 指针', hint: '留空则自动识别 data.balance / remaining 等常见位置。' }, h('input', { className: 's2u-input', value: draft.pointerBalance, onChange: change('pointerBalance'), placeholder: '/data/balance', spellCheck: false })),
            h(Field, { label: '剩余额度指针' }, h('input', { className: 's2u-input', value: draft.pointerRemaining, onChange: change('pointerRemaining'), placeholder: '/data/quota/remaining', spellCheck: false })),
            h(Field, { label: '已用指针' }, h('input', { className: 's2u-input', value: draft.pointerUsed, onChange: change('pointerUsed'), placeholder: '/data/quota/used', spellCheck: false })),
            h(Field, { label: '额度上限指针' }, h('input', { className: 's2u-input', value: draft.pointerLimit, onChange: change('pointerLimit'), placeholder: '/data/quota/limit', spellCheck: false })),
            h(Field, { label: '用量路径' }, h('input', { className: 's2u-input', value: draft.pathUsage, onChange: change('pathUsage'), spellCheck: false })),
            h(Field, { label: '当前用户路径' }, h('input', { className: 's2u-input', value: draft.pathMe, onChange: change('pathMe'), spellCheck: false })),
            h(Field, { label: '管理员单用户路径' }, h('input', { className: 's2u-input', value: draft.pathAdminUser, onChange: change('pathAdminUser'), spellCheck: false })),
            h(Field, { label: '管理员用户列表路径' }, h('input', { className: 's2u-input', value: draft.pathAdminUsers, onChange: change('pathAdminUsers'), spellCheck: false })),
          ),
        ),
        h(
          'fieldset',
          { className: 's2u-fieldset' },
          h('legend', null, '刷新与显示'),
          h(
            'div',
            { className: 's2u-form' },
            h(Field, { label: '自动刷新间隔（秒）', hint: '0 = 只手动刷新。' }, h('input', { className: 's2u-input', type: 'number', min: 0, value: draft.intervalSec, onChange: change('intervalSec') })),
            h(Field, { label: '统计区间（天）' }, h('input', { className: 's2u-input', type: 'number', min: 1, max: 365, value: draft.rangeDays, onChange: change('rangeDays') })),
            h(
              Field,
              { label: '趋势默认粒度', hint: '按小时的数据由插件本机采样累计（DSH 运行期间）。' },
              h('select', { className: 's2u-select', value: draft.granularity, onChange: change('granularity') },
                h('option', { value: 'day' }, '按天'),
                h('option', { value: 'hour' }, '按小时')),
            ),
            h(Field, { label: '小时区间（小时）', hint: '6–336：按小时视图看最近多少小时。' }, h('input', { className: 's2u-input', type: 'number', min: 6, max: 336, value: draft.hourlyHours, onChange: change('hourlyHours') })),
            h(Field, { label: '低余额提醒阈值' }, h('input', { className: 's2u-input', type: 'number', step: '0.01', value: draft.lowBalance, onChange: change('lowBalance') })),
            h(Field, { label: '货币符号' }, h('input', { className: 's2u-input', value: draft.currencySymbol, onChange: change('currencySymbol') })),
            h(Field, { label: '超时（毫秒）' }, h('input', { className: 's2u-input', type: 'number', min: 1000, value: draft.timeoutMs, onChange: change('timeoutMs') })),
            h(Field, { label: '时区' }, h('input', { className: 's2u-input', value: draft.timezone, onChange: change('timezone') })),
          ),
        ),
        h(
          'div',
          { className: 's2u-actions' },
          h('button', { className: 's2u-btn s2u-btn-primary', type: 'submit', disabled: state.busy }, '保存并查询'),
          h('button', { className: 's2u-btn', type: 'button', disabled: testing, onClick: test }, testing ? '测试中…' : '测试连接（不保存）'),
          h('button', { className: 's2u-btn', type: 'button', onClick: clearCredential }, '清除凭证'),
        ),
        state.files
          ? h('div', { className: 's2u-hint', style: { marginTop: 12 } }, '配置文件：' + state.files.config + ' · 凭证文件：' + state.files.secrets)
          : null,
      );
    }

    /** The main-panel page: overview / detail / settings. */
    function UsagePanel(props) {
      var state = useStoreValue(props.store);
      var tabState = React.useState('overview');
      var tab = tabState[0];
      var setTab = tabState[1];
      var snapshot = state.snapshot;

      React.useEffect(function () {
        if (!state.toast) return undefined;
        var id = window.setTimeout(function () { props.store.clearToast(); }, 2600);
        return function () { window.clearTimeout(id); };
      }, [state.toast]);

      return h(
        'div',
        { className: 's2u-root' },
        h(
          'div',
          { className: 's2u-head' },
          h('span', { className: 's2u-title' }, LABEL),
          h('i', { className: 's2u-dot', 'data-state': statusOf(state) }),
          snapshot ? h('span', { className: 's2u-sub' }, snapshot.baseUrl + ' · ' + snapshot.mode + ' 模式 · ' + clockText(state.queriedAt)) : h('span', { className: 's2u-sub' }, '尚未查询'),
          h('span', { className: 's2u-spacer' }),
          snapshot ? h('span', { className: 's2u-chip' }, '余额 ' + balanceText(snapshot)) : null,
          h('button', { className: 's2u-btn', type: 'button', disabled: state.busy, onClick: function () { props.store.query(); } }, state.busy ? '查询中…' : '刷新'),
        ),
        state.toast ? h('div', { className: 's2u-banner', 'data-tone': 'ok' }, state.toast) : null,
        state.error
          ? h(
              'div',
              { className: 's2u-banner', 'data-tone': 'error' },
              h('b', null, '查询失败（' + state.error.code + '）：' + state.error.message),
              state.error.hint || '',
            )
          : null,
        h(
          'div',
          { className: 's2u-tabs' },
          [['overview', '概览'], ['detail', '明细'], ['settings', '设置']].map(function (pair) {
            return h('button', { key: pair[0], type: 'button', className: 's2u-tab', 'data-active': String(tab === pair[0]), onClick: function () { setTab(pair[0]); } }, pair[1]);
          }),
        ),
        tab === 'settings'
          ? h(SettingsTab, { store: props.store, state: state })
          : !snapshot
            ? h('div', { className: 's2u-empty' }, state.phase === 'loading' ? '正在读取配置…' : '还没有数据：点「刷新」，或到「设置」填写查询接口。')
            : tab === 'overview'
              ? h(OverviewTab, { snapshot: snapshot, hourly: state.hourly, store: props.store, config: state.config, busy: state.busy })
              : h(DetailTab, { snapshot: snapshot }),
      );
    }

    // ------------------------------------------------------------------ apply

    var inject = ['slots', 'layout'];

    function apply(ctx) {
      var store = createStore();
      /**
       * Open the panel. During a plugin remount the key can be momentarily
       * unregistered (layout.selectPanel throws on an unknown key and leaves the
       * current view alone), so retry once on the next tick.
       */
      var openPanel = function () {
        var go = function () {
          var layout = ctx.get('layout');
          if (!layout || typeof layout.selectPanel !== 'function') return false;
          layout.selectPanel(PANEL_ID);
          return true;
        };
        try {
          go();
        } catch (error) {
          window.setTimeout(function () {
            try {
              go();
            } catch (ignored) {
              // still unregistered: the sidebar row itself works once mounted
            }
          }, 150);
        }
      };

      ctx.effect(function () { return installStyles(); }, 'sub2api-usage: styles');
      ctx.effect(function () { return store.start(); }, 'sub2api-usage: poller');

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: PANEL_ID,
              order: 40,
              label: LABEL,
              inject: function () { return { store: store, open: openPanel }; },
            },
            UsageChip,
          );
        });
      }, 'sub2api-usage: sidebar balance chip');

      ctx.effect(function () {
        return ctx.slots.inject('sidebar.panellist', function () {
          return ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 40,
              label: LABEL,
              inject: function () { return { store: store }; },
            },
            PanelIcon,
          );
        });
      }, 'sub2api-usage: sidebar panel icon');

      ctx.effect(function () {
        return ctx.slots.inject('main', function () {
          return ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: undefined,
              inject: function () { return { store: store }; },
            },
            UsagePanel,
          );
        });
      }, 'sub2api-usage: main panel');
    }

    exports.name = 'sub2api-usage-client';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
