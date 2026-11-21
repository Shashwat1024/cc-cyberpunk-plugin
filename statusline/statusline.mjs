#!/usr/bin/env node
// Polish status line for Claude Code: six switchable styles.
// Reads the status line JSON Claude Code sends on stdin and prints the bar.
//
// Styles (config.json "style", or /polish <style> from the cc-cyberpunk-plugin):
//   classic  Powerline segments with smooth gauges and a time-of-day palette
//   minimal  one dim line that brightens when something needs attention
//   sky      the bar is the real sky for the time of day, with a moving sun or moon
//   aurora   one flowing violet-blue-teal ramp, heat-ribbon meters, braille trend lines
//   cockpit  two-line instrument panel with trend lines and burn-rate forecasts
//   neon     black synthwave bar, gradient model name, neon meters, LIVE/IDLE mark
//
// Test overrides: POLISH_STYLE, POLISH_HOUR (0-24, fractional), POLISH_SEPARATOR,
// POLISH_STATE_DIR, POLISH_NO_GIT, COLUMNS.
//
// Width safety: meters are background-coloured spaces (one cell everywhere), trend
// lines are braille (neutral width), and every other symbol is followed by a space,
// because some fonts draw symbols like ↻ wider than one cell.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

const DIR =
  process.env.POLISH_STATE_DIR ||
  join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'cc-cyberpunk');

export const STYLES = ['classic', 'minimal', 'sky', 'aurora', 'cockpit', 'neon', 'cyberpunk'];

// ---------- helpers ----------

const readJson = (path, fallback) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const hex = h => {
  const v = h.replace('#', '');
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16));
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1)));
const fg = c => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = c => `\x1b[48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NORMAL = '\x1b[22m';
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

function luminance(c) {
  const [r, g, b] = c.map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const DARK_TEXT = hex('#10131a');
const LIGHT_TEXT = hex('#f8fafc');
const readable = back => (contrast(DARK_TEXT, back) >= contrast(LIGHT_TEXT, back) ? DARK_TEXT : LIGHT_TEXT);
/** The wanted colour when it reads on `back`, else black or white text. */
const pick = (want, back, min = 3) => (contrast(want, back) >= min ? want : readable(back));

/** A colour along a list of stops, t from 0 to 1. */
function ramp(stops, t) {
  const x = clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

// green -> amber -> red as a gauge fills
const GREEN = hex('#4ade80');
const AMBER = hex('#fbbf24');
const RED = hex('#f87171');
function loadColor(pct) {
  if (pct <= 0) return GREEN;
  if (pct < 60) return mix(GREEN, AMBER, pct / 60);
  if (pct < 90) return mix(AMBER, RED, (pct - 60) / 30);
  return RED;
}

/** East Asian wide characters (kana, kanji, hangul, full-width forms) take two cells. */
const isWide = cp =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6);
const cellsOf = s => [...s].reduce((n, ch) => n + (isWide(ch.codePointAt(0)) ? 2 : 1), 0);

function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function clock(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---------- data ----------

function readStdin() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function modelName(input) {
  const name = (input.model?.display_name || input.model?.id || 'Claude').trim();
  return name.replace(/\s*\([^)]*\bcontext\b[^)]*\)/i, '').replace(/^Claude\s+/i, '').trim();
}

function contextPercent(input) {
  const w = input.context_window;
  if (!w) return null;
  const native = w.used_percentage;
  if (typeof native === 'number' && Number.isFinite(native) && native > 0) return clamp(Math.round(native), 0, 100);
  const u = w.current_usage;
  const tokens =
    (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
  const size = w.context_window_size ?? 0;
  return size > 0 ? clamp(Math.round((tokens / size) * 100), 0, 100) : 0;
}

function usage(input) {
  const five = input.rate_limits?.five_hour;
  const pct = five?.used_percentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const resetsAt = typeof five.resets_at === 'number' ? five.resets_at * 1000 : null;
  const week = input.rate_limits?.seven_day?.used_percentage;
  return {
    pct: clamp(Math.round(pct), 0, 100),
    resetsIn: resetsAt ? Math.max(0, resetsAt - Date.now()) : null,
    week: typeof week === 'number' && Number.isFinite(week) ? clamp(Math.round(week), 0, 100) : null,
  };
}

function gitInfo(cwd, cache) {
  if (!cwd) return null;
  const hit = cache.git?.[cwd];
  if (hit && Date.now() - hit.at < 5000) return hit.info;
  let info = null;
  try {
    const opts = { cwd, timeout: 300, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, encoding: 'utf8' };
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts).trim();
    let dirty = 0;
    try {
      dirty = execFileSync('git', ['status', '--porcelain', '-uno'], opts).split('\n').filter(Boolean).length;
    } catch {
      dirty = -1;
    }
    // commits not yet pushed; no upstream means nothing to count
    let ahead = 0;
    try {
      ahead = Number.parseInt(execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], opts).trim(), 10) || 0;
    } catch {
      ahead = 0;
    }
    info = { branch, dirty, ahead };
  } catch {
    info = null;
  }
  const git = { ...(cache.git || {}), [cwd]: { at: Date.now(), info } };
  const keys = Object.keys(git);
  if (keys.length > 20) for (const k of keys.slice(0, keys.length - 20)) delete git[k];
  cache.git = git;
  return info;
}

/** Samples of context and 5h usage for this session, for trend lines and forecasts. */
function history(cache, sessionId, ctx, u5) {
  const all = cache.history || {};
  const key = sessionId || 'default';
  const entry = all[key] || { at: 0, s: [] };
  const now = Date.now();
  const last = entry.s[entry.s.length - 1];
  const changed = !last || last[1] !== ctx || last[2] !== u5;
  if (!last || (changed && now - last[0] > 5000) || now - last[0] > 60000) entry.s.push([now, ctx ?? 0, u5 ?? -1]);
  entry.s = entry.s.slice(-48);
  entry.at = now;
  all[key] = entry;
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const k of keys.slice(6)) delete all[k];
  cache.history = all;
  return entry.s;
}

/** Minutes until `value` reaches 100 at the recent pace, or null when it is not rising. */
function forecast(samples, index, windowMs) {
  const now = Date.now();
  let start = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i][index] < samples[i - 1][index] - 3) start = i;
  const recent = samples.slice(start).filter(s => now - s[0] <= windowMs && s[index] >= 0);
  if (recent.length < 2) return null;
  const [t0, v0] = [recent[0][0], recent[0][index]];
  const [t1, v1] = [recent[recent.length - 1][0], recent[recent.length - 1][index]];
  const minutes = (t1 - t0) / 60000;
  if (minutes < 2 || v1 <= v0) return null;
  return (100 - v1) / ((v1 - v0) / minutes);
}

/** The new level for 45 seconds after REP crosses into it, else null. */
function levelUp(cache, rep) {
  if (!rep || typeof rep.level !== 'number') return null;
  const now = Date.now();
  const prev = cache.rep;
  const at = prev && rep.level > prev.level ? now : prev?.upAt || 0;
  cache.rep = { level: rep.level, upAt: at };
  return now - at < 45_000 ? rep.level : null;
}

function hudState() {
  const state = readJson(join(DIR, 'state.json'), {});
  const fresh = state.at && Date.now() - state.at < 10 * 60 * 1000;
  return {
    failed: Boolean(fresh && state.lastToolFailed),
    running: Boolean(state.running && state.updated && Date.now() - state.updated < 15 * 60 * 1000),
    calls: typeof state.calls === 'number' ? state.calls : null,
    activity: Array.isArray(state.activity) ? state.activity : [],
    daemons: Array.isArray(state.daemons) ? state.daemons : [],
    rep: state.rep && typeof state.rep.points === 'number' ? state.rep : null,
    mode: typeof state.mode === 'string' ? state.mode : '',
    today: state.today && typeof state.today.usd === 'number' ? state.today : null,
    budget: state.budget && typeof state.budget === 'object' ? state.budget : {},
    // a forecast still ahead, from a state written in the last 15 minutes
    pace:
      state.pace && typeof state.pace.hitsAt === 'number' && state.pace.hitsAt > Date.now() &&
      state.updated && Date.now() - state.updated < 15 * 60 * 1000
        ? state.pace
        : null,
  };
}

/** A local clock time like "3:40 PM". */
function clockTime(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const windowName = kind => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind);

/**
 * Efficiency chips: a limit coming before its reset, today's estimated spend
 * against the budget, and the prompt cache's hit rate. Low priority except the
 * limit warning, so they give way first on a narrow terminal.
 */
function effItems(d, flavor) {
  const cyber = flavor === 'cyber';
  const raw = flavor !== 'sky';
  const items = [];
  if (d.hud.pace) {
    const at = clockTime(d.hud.pace.hitsAt);
    items.push(text(cyber ? `ICE BREACH @ ${at}` : `${windowName(d.hud.pace.kind)} → ${at} ⚠ `, { fg: RED, bold: true, raw }, 1));
  }
  const budget = d.hud.budget?.usdPerDay;
  if (budget) {
    const spent = d.hud.today?.usd ?? 0;
    const ratio = spent / budget;
    items.push(
      text(cyber ? `₵ ${spent.toFixed(2)}/${budget}` : `≈$${spent.toFixed(2)}/$${budget}`, {
        fg: ratio >= 1 ? RED : ratio >= 0.8 ? AMBER : GREEN,
        bold: ratio >= 0.8,
        raw,
      }, 5),
    );
  }
  if (typeof d.cacheHit === 'number') {
    const pct = Math.round(d.cacheHit * 100);
    items.push({ ...text(`${cyber ? 'CACHE' : 'cache'} ${pct}%`, { fg: pct >= 80 ? GREEN : pct >= 50 ? AMBER : RED, raw }, 6), isCache: true });
  }
  return items;
}

// ---------- canvas: one cell per column, each with its own colours ----------

function makeCanvas(cols, bgAt) {
  return Array.from({ length: cols }, (_, i) => ({ ch: ' ', fg: null, bg: bgAt(i), bold: false, dim: false, used: false }));
}

function paintText(cv, col, text, opts = {}) {
  for (const ch of text) {
    const cell = cv[col];
    const wide = isWide(ch.codePointAt(0));
    if (!cell || (wide && !cv[col + 1])) break;
    cell.ch = ch;
    cell.fg = opts.fg ? (opts.raw ? opts.fg : pick(opts.fg, cell.bg, opts.min ?? 3)) : null;
    if (opts.bg) cell.bg = opts.bg;
    cell.bold = Boolean(opts.bold);
    cell.dim = Boolean(opts.dim);
    cell.used = true;
    col++;
    if (wide) {
      // a double-width character covers the next cell, which prints nothing
      Object.assign(cv[col], { ch: '', fg: cell.fg, bg: cell.bg, bold: cell.bold, dim: cell.dim, used: true });
      col++;
    }
  }
  return col;
}

/** A meter of background-coloured spaces. fill: 'load' | 'heat' | an rgb colour. */
function paintGauge(cv, col, pct, cells, { fill = 'load', track } = {}) {
  const exact = (clamp(pct ?? 0, 0, 100) / 100) * cells;
  const full = Math.floor(exact);
  const frac = exact - full;
  for (let i = 0; i < cells; i++) {
    const cell = cv[col + i];
    if (!cell) break;
    const color = fill === 'heat' ? loadColor(((i + 0.5) / cells) * 100) : fill === 'load' ? loadColor(pct) : fill;
    const tr = track ?? mix(cell.bg, BLACK, 0.4);
    cell.ch = ' ';
    cell.bg = i < full ? color : i === full ? mix(tr, color, frac) : tr;
    cell.used = true;
  }
  return col + cells;
}

/** A braille sparkline: two samples per cell, four dots tall. */
const LEFT = [0x40, 0x04, 0x02, 0x01];
const RIGHT = [0x80, 0x20, 0x10, 0x08];
function sparkChars(values, cells) {
  const v = values.slice(-cells * 2);
  while (v.length < cells * 2) v.unshift(null);
  // scaled to the series' own range, so a climb from 12% to 37% still shows its shape
  const real = v.filter(x => x !== null);
  const lo = Math.min(...real);
  const hi = Math.max(...real);
  let out = '';
  for (let c = 0; c < cells; c++) {
    let bits = 0;
    const [a, b] = [v[c * 2], v[c * 2 + 1]];
    const h = x => (x === null ? 0 : hi === lo ? 2 : 1 + Math.round(((x - lo) / (hi - lo)) * 3));
    for (let k = 0; k < h(a); k++) bits |= LEFT[k];
    for (let k = 0; k < h(b); k++) bits |= RIGHT[k];
    out += String.fromCodePoint(0x2800 + bits);
  }
  return out;
}

/** The solid panel backgrounds (cyberpunk, cockpit, neon, the tape's black): drawn transparent. */
let panels = null;
function isPanel(key) {
  panels ??= new Set([GRID, PANEL, VOID, [0, 0, 0]].map(c => c.join()));
  return panels.has(key);
}

function renderCanvas(cv) {
  let out = '';
  let bgKey = '';
  let fgKey = '';
  let weight = '';
  for (const cell of cv) {
    const b = cell.bg.join();
    if (b !== bgKey) {
      // a panel colour is drawn as the terminal's own background (ESC[49m), so
      // the bar blends into VS Code's grey or the terminal's black alike
      out += isPanel(b) ? '\x1b[49m' : bg(cell.bg);
      bgKey = b;
    }
    const f = cell.fg ?? readable(cell.bg);
    if (f.join() !== fgKey) {
      out += fg(f);
      fgKey = f.join();
    }
    const w = cell.bold ? 'b' : cell.dim ? 'd' : '';
    if (w !== weight) {
      out += NORMAL + (cell.bold ? BOLD : '') + (cell.dim ? DIM : '');
      weight = w;
    }
    out += cell.ch;
  }
  return out + RESET;
}

// Items: { w, prio, paint(cv, col) -> col }. Lower prio survives longer.
const text = (str, opts = {}, prio = 0) => ({ w: cellsOf(str), prio, paint: (cv, c) => paintText(cv, c, str, opts) });
const gaugeItem = (pct, cells, opts, prio = 0) => ({ w: cells, prio, paint: (cv, c) => paintGauge(cv, c, pct, cells, opts) });
const seq = (items, prio = 0) => ({
  w: items.reduce((n, i) => n + i.w, 0),
  prio,
  paint: (cv, c) => items.reduce((col, i) => i.paint(cv, col), c),
});

/** Lays left items from the left edge and right items to the right edge, dropping the least important to fit. */
function layout(cv, left, right, gap = 3) {
  let l = left.filter(Boolean);
  let r = right.filter(Boolean);
  const total = () =>
    l.reduce((n, i) => n + i.w, 0) + Math.max(0, l.length - 1) * gap +
    r.reduce((n, i) => n + i.w, 0) + Math.max(0, r.length - 1) * gap + 2 + (r.length ? gap : 0);
  while (total() > cv.length && l.length + r.length > 1) {
    const worst = Math.max(...l.map(i => i.prio), ...r.map(i => i.prio));
    const inR = r.findLastIndex(i => i.prio === worst);
    if (inR >= 0) r.splice(inR, 1);
    else l.splice(l.findLastIndex(i => i.prio === worst), 1);
  }
  let col = 1;
  l.forEach((item, i) => {
    col = item.paint(cv, col) + (i < l.length - 1 ? gap : 0);
  });
  let rcol = cv.length - 1 - (r.reduce((n, i) => n + i.w, 0) + Math.max(0, r.length - 1) * gap);
  r.forEach(item => {
    rcol = item.paint(cv, rcol) + gap;
  });
}

// ---------- classic ----------

const PALETTES = [
  { hour: 1, accent: '#8b7cf6', folder: '#3b3366', git: '#2c2750', gauge: '#1f1b38', light: '#ece9ff', dark: '#14112a' },
  { hour: 7, accent: '#5fb4f0', folder: '#24507a', git: '#1d3f60', gauge: '#152c45', light: '#e8f4ff', dark: '#0b1b2b' },
  { hour: 13, accent: '#a7b4c6', folder: '#3d4a5c', git: '#323d4c', gauge: '#252d38', light: '#eef2f7', dark: '#151a21' },
  { hour: 19, accent: '#f0a64a', folder: '#6b4420', git: '#55361a', gauge: '#3a2512', light: '#fff1e0', dark: '#241505' },
];

function paletteAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  const sorted = [...PALETTES].sort((a, b) => a.hour - b.hour);
  let i = sorted.length - 1;
  for (let k = 0; k < sorted.length; k++) if (sorted[k].hour <= h) i = k;
  const prev = sorted[i];
  const next = sorted[(i + 1) % sorted.length];
  const span = (next.hour - prev.hour + 24) % 24 || 24;
  const t = ((h - prev.hour + 24) % 24) / span;
  const out = {};
  for (const key of Object.keys(prev)) if (key !== 'hour') out[key] = mix(hex(prev[key]), hex(next[key]), t);
  return out;
}

function inlineGauge(pct, cells, segBg, track) {
  const exact = (clamp(pct, 0, 100) / 100) * cells;
  const full = Math.floor(exact);
  const color = loadColor(pct);
  let out = full > 0 ? `${bg(color)}${' '.repeat(full)}` : '';
  if (full < cells) {
    out += `${bg(mix(track, color, exact - full))} `;
    if (cells - full - 1 > 0) out += `${bg(track)}${' '.repeat(cells - full - 1)}`;
  }
  return `${out}${bg(segBg)}`;
}

// ---------- effort ----------
// The model's effort level, from the status line input: a coloured label and a
// 5-step meter of background-coloured cells. Fast mode adds a FAST tag.
const EFFORT_STEP = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 };
const EFFORT_COLOR = { low: '#60a5fa', medium: '#4ade80', high: '#fbbf24', xhigh: '#fb923c', max: '#f43f5e' };
const effortColor = level => hex(EFFORT_COLOR[level] ?? '#a7b4c6');

function effortItem(d, flavor) {
  if (!d.effort) return null;
  const step = EFFORT_STEP[d.effort] ?? 3;
  const color = effortColor(d.effort);
  const raw = flavor !== 'sky';
  const label = flavor === 'cyber' ? `OVERCLOCK ${d.effort.toUpperCase()} ` : flavor === 'cockpit' ? `EFFORT ${d.effort.toUpperCase()} ` : `${d.effort} `;
  const parts = [
    text(label, { fg: flavor === 'cyber' || flavor === 'cockpit' ? color : color, bold: true, raw }),
    gaugeItem((step / 5) * 100, 5, { fill: color }),
  ];
  if (d.fast) parts.push(text(' FAST', { fg: flavor === 'cyber' ? CY_YELLOW : AMBER, bold: true, raw }));
  return seq(parts, 2);
}

function renderClassic(d, sepStyle) {
  const pal = paletteAt(d.hour);
  const track = mix(pal.gauge, pal.light, 0.16);
  const parts = [{ bg: pal.accent, fg: pal.dark, text: d.model, bold: true }];
  if (d.effort) {
    const step = EFFORT_STEP[d.effort] ?? 3;
    const color = effortColor(d.effort);
    const meter = `${bg(color)}${' '.repeat(step)}${bg(mix(pal.git, BLACK, 0.4))}${' '.repeat(5 - step)}${bg(pal.git)}`;
    parts.push({ bg: pal.git, fg: color, bold: true, text: `${d.effort} ${meter}${d.fast ? `${fg(AMBER)} FAST` : ''}` });
  }
  if (d.folder) parts.push({ bg: pal.folder, fg: pal.light, text: d.folder });
  if (d.git) {
    const mark = d.git.dirty === 0 ? `${fg(GREEN)}✓ ` : d.git.dirty > 0 ? `${fg(AMBER)}±${d.git.dirty}` : '';
    parts.push({ bg: pal.git, fg: pal.light, text: `${d.git.branch} ${mark}`.trim() });
  }
  if (d.ctx !== null) {
    parts.push({
      bg: pal.gauge,
      fg: pal.light,
      text: `ctx ${inlineGauge(d.ctx, 8, pal.gauge, track)}${fg(pal.light)} ${fg(loadColor(d.ctx))}${d.ctx}%`,
    });
  }
  if (d.usage) {
    const reset = d.usage.resetsIn !== null ? `${fg(pal.light)}${DIM} ↻ ${duration(d.usage.resetsIn)}${NORMAL}` : '';
    const week = d.usage.week !== null && d.usage.week >= 50 ? `${fg(loadColor(d.usage.week))} 7d ${d.usage.week}%` : '';
    parts.push({
      bg: pal.gauge,
      fg: pal.light,
      text: `5h ${inlineGauge(d.usage.pct, 8, pal.gauge, track)}${fg(pal.light)} ${fg(loadColor(d.usage.pct))}${d.usage.pct}%${reset}${week}`,
    });
  }
  if (d.hud.failed) parts.push({ bg: hex('#7f1d1d'), fg: hex('#fecaca'), text: '✗ last call failed' });
  if (d.hud.pace) {
    parts.push({ bg: hex('#7f1d1d'), fg: hex('#fecaca'), bold: true, text: `${windowName(d.hud.pace.kind)} → ${clockTime(d.hud.pace.hitsAt)} ⚠ ` });
  }
  if (d.hud.budget?.usdPerDay) {
    const spent = d.hud.today?.usd ?? 0;
    const ratio = spent / d.hud.budget.usdPerDay;
    parts.push({ bg: pal.gauge, fg: ratio >= 1 ? RED : ratio >= 0.8 ? AMBER : pal.light, text: `≈$${spent.toFixed(2)}/$${d.hud.budget.usdPerDay}` });
  }
  if (typeof d.cacheHit === 'number') parts.push({ bg: pal.git, fg: pal.light, text: `cache ${Math.round(d.cacheHit * 100)}%` });

  const sep = sepStyle === 'plain' ? '▌' : '';
  let out = '';
  parts.forEach((p, i) => {
    out += `${bg(p.bg)}${fg(p.fg)}${p.bold ? BOLD : ''} ${p.text} ${p.bold ? NORMAL : ''}`;
    const nextBg = parts[i + 1]?.bg;
    out += nextBg ? `${fg(p.bg)}${bg(nextBg)}${sep}` : `${RESET}${fg(p.bg)}${sep}`;
  });
  return out + RESET;
}

// ---------- minimal ----------

function renderMinimal(d) {
  const pal = paletteAt(d.hour);
  const alert = (d.ctx ?? 0) > 80 || (d.usage?.pct ?? 0) > 80 || d.hud.failed || Boolean(d.hud.pace);
  const items = [d.effort ? `${d.model.toLowerCase()} ${d.effort}${d.fast ? ' fast' : ''}` : d.model.toLowerCase()];
  if (d.folder) items.push(d.folder);
  if (d.git) items.push(d.git.dirty > 0 ? `${d.git.branch}±${d.git.dirty}` : d.git.branch);
  if (!alert) {
    if (d.ctx !== null) items.push(`${d.ctx}%`);
    return `${DIM}${fg(pal.accent)}${items.join(' · ')}${RESET}`;
  }
  const bright = [`${BOLD}${fg(pal.accent)}${items.join(' · ')}${NORMAL}`];
  if (d.ctx !== null) bright.push(`${fg(loadColor(d.ctx))}ctx ${d.ctx}%`);
  if (d.usage && d.usage.pct > 80) bright.push(`${fg(loadColor(d.usage.pct))}5h ${d.usage.pct}%`);
  if (d.hud.failed) bright.push(`${fg(RED)}✗ last call failed`);
  if (d.hud.pace) bright.push(`${fg(RED)}${windowName(d.hud.pace.kind)} limit ~${clockTime(d.hud.pace.hitsAt)}`);
  return bright.join(`${fg(pal.light)} · `) + RESET;
}

// ---------- shared item builders ----------

function gitText(git) {
  if (!git) return null;
  return git.dirty === 0 ? `${git.branch} ✓ ` : git.dirty > 0 ? `${git.branch} ±${git.dirty}` : git.branch;
}

function resetText(u) {
  return u?.resetsIn !== null && u?.resetsIn !== undefined ? `↻ ${duration(u.resetsIn)}` : null;
}

// ---------- sky ----------

const SKY = [
  [0, ['#060a1d', '#0f1638', '#060a1d']],
  [4.5, ['#0f1435', '#2a1f52', '#0f1435']],
  [6, ['#f29ca3', '#f7c98b', '#8fbde8']],
  [8.5, ['#8cc0ec', '#b5dbf7', '#8cc0ec']],
  [12.5, ['#3f8ad6', '#6fb3ee', '#3f8ad6']],
  [16.5, ['#5b9bd6', '#9cc6e8', '#e9c48c']],
  [18.3, ['#3a1d5c', '#d4572e', '#f3a343']],
  [19.6, ['#1b1742', '#3a275f', '#1b1742']],
  [21, ['#0a0f2a', '#161d45', '#0a0f2a']],
  [24, ['#060a1d', '#0f1638', '#060a1d']],
].map(([h, stops]) => [h, stops.map(hex)]);

function skyStops(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
  const [h0, a] = SKY[i];
  const [h1, b] = SKY[i + 1];
  const t = (h - h0) / (h1 - h0);
  return a.map((c, k) => mix(c, b[k], t));
}

const STARS = ['⠁', '⠂', '⠄', '⠈', '⠐', '⠠'];
const hash = n => {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  return x >>> 0; // ^ yields a signed int; keep it unsigned so % never goes negative
};

function renderSky(d, cols) {
  const stops = skyStops(d.hour);
  const cv = makeCanvas(cols, i => ramp(stops, i / Math.max(1, cols - 1)));
  const h = ((d.hour % 24) + 24) % 24;
  const isNight = h < 5.75 || h >= 19.25;

  const left = [
    text(d.model, { bold: true }, 0),
    effortItem(d, 'sky'),
    d.folder ? text(d.folder, {}, 2) : null,
    gitText(d.git) ? text(gitText(d.git), {}, 3) : null,
  ];
  const right = [
    d.hud.failed ? text('✗ failed', { fg: RED, bold: true }, 1) : null,
    ...effItems(d, 'sky'),
    d.ctx !== null ? seq([text('ctx ', {}), text(`${d.ctx}%`, { fg: loadColor(d.ctx), bold: true })], 1) : null,
    d.usage ? seq([text('5h ', {}), text(`${d.usage.pct}%`, { fg: loadColor(d.usage.pct), bold: true })], 2) : null,
    resetText(d.usage) ? text(resetText(d.usage), { dim: !isNight }, 4) : null,
  ];
  layout(cv, left, right, 2);

  // the sun crosses the bar from 6:00 to 18:00, the moon from 18:00 to 6:00
  const frac = h >= 6 && h < 18 ? (h - 6) / 12 : ((h - 18 + 24) % 24) / 12;
  const glyph = h >= 6 && h < 18 ? '☀' : '☾';
  const glow = h >= 6 && h < 18 ? hex('#fff4b8') : hex('#eef1ff');
  const want = 1 + Math.round(frac * (cols - 4));
  const free = c => cv[c] && cv[c + 1] && !cv[c].used && !cv[c + 1].used && (!cv[c - 1] || !cv[c - 1].used);
  for (let off = 0; off < 12; off++) {
    const c = [want + off, want - off].find(free);
    if (c !== undefined) {
      cv[c].ch = glyph;
      cv[c].fg = glow;
      cv[c].bold = true;
      cv[c].used = true;
      // a soft halo behind it
      for (const k of [c - 1, c, c + 1]) if (cv[k]) cv[k].bg = mix(cv[k].bg, glow, k === c ? 0.28 : 0.12);
      break;
    }
  }

  if (isNight) {
    const twinkle = Math.floor(Date.now() / 60000);
    for (let c = 0; c < cols; c++) {
      if (cv[c].used || (cv[c - 1] && cv[c - 1].used) || (cv[c + 1] && cv[c + 1].used)) continue;
      const n = hash(c * 31 + (twinkle % 3));
      if (n % 7 === 0) {
        cv[c].ch = STARS[n % STARS.length];
        cv[c].fg = mix(cv[c].bg, WHITE, 0.45 + (n % 5) * 0.1);
      }
    }
  }
  return renderCanvas(cv);
}

// ---------- aurora ----------

const AURORA = ['#4c1d95', '#1e3a8a', '#0f5f6b', '#4c1d95'].map(hex);

function renderAurora(d, cols) {
  // the ramp shifts a little every minute, so the bar flows between redraws
  const phase = ((Date.now() / 60000) % 30) / 30;
  const cv = makeCanvas(cols, i => ramp(AURORA, (i / cols + phase) % 1));
  const light = hex('#e9e4ff');
  const sparkColor = hex('#c4f1f9');

  const left = [
    seq([text('◆ ', { fg: hex('#c4b5fd'), raw: true }), text(d.model, { fg: WHITE, bold: true, raw: true })], 0),
    effortItem(d, 'aurora'),
    d.folder ? text(d.folder, { fg: light, raw: true }, 3) : null,
    gitText(d.git) ? text(gitText(d.git), { fg: light, raw: true }, 4) : null,
  ];
  const ctxItems = d.ctx === null ? null : seq([
    text('ctx ', { fg: light, raw: true }),
    gaugeItem(d.ctx, 10, { fill: 'heat' }),
    text(` ${d.ctx}%`, { fg: WHITE, bold: true, raw: true }),
  ], 1);
  const ctxSpark = d.samples.length > 1 ? text(sparkChars(d.samples.map(s => s[1]), 5), { fg: sparkColor, raw: true }, 5) : null;
  const usageItems = d.usage ? seq([
    text('5h ', { fg: light, raw: true }),
    gaugeItem(d.usage.pct, 10, { fill: 'heat' }),
    text(` ${d.usage.pct}%`, { fg: WHITE, bold: true, raw: true }),
  ], 2) : null;
  const right = [
    d.hud.failed ? text('✗ failed', { fg: hex('#fecaca'), bold: true, raw: true }, 1) : null,
    ...effItems(d, 'aurora'),
    ctxItems,
    ctxSpark,
    usageItems,
    resetText(d.usage) ? text(resetText(d.usage), { fg: light, raw: true }, 4) : null,
  ];
  layout(cv, left, right, 2);
  return renderCanvas(cv);
}

// ---------- cockpit ----------

const PANEL = hex('#0b1016');
const LABEL = hex('#5f7185');
const VALUE = hex('#e2e8f0');
const CYAN = hex('#38bdf8');

function renderCockpit(d, cols) {
  const label = s => text(s, { fg: LABEL, raw: true });
  const value = (s, opts = {}) => text(s, { fg: VALUE, bold: true, raw: true, ...opts });
  const arrow = text(' ▸ ', { fg: CYAN, raw: true });

  // line 1: who and where, session clock and activity
  const top = makeCanvas(cols, () => PANEL);
  const status = d.hud.running
    ? text('● LIVE', { fg: hex('#4ade80'), bold: true, raw: true }, 0)
    : text('○ IDLE', { fg: LABEL, raw: true }, 0);
  const where = [value(d.model.toUpperCase(), { fg: CYAN })];
  if (d.folder) where.push(arrow, value(d.folder, { bold: false }));
  if (gitText(d.git)) where.push(arrow, value(gitText(d.git), { bold: false }));
  const effort = effortItem(d, 'cockpit');
  const elapsed = d.cost?.total_duration_ms;
  const added = d.cost?.total_lines_added;
  const removed = d.cost?.total_lines_removed;
  layout(top, [seq([status, text('  '), ...where], 0), effort], [
    typeof elapsed === 'number' ? seq([label('T+'), value(clock(elapsed))], 1) : null,
    d.hud.calls !== null ? seq([label('CALLS '), value(String(d.hud.calls))], 2) : null,
    typeof added === 'number'
      ? seq([label('LINES '), text(`+${added}`, { fg: GREEN, raw: true }), text(` -${removed ?? 0}`, { fg: RED, raw: true })], 3)
      : null,
    d.hud.failed ? text('✗ LAST CALL FAILED', { fg: RED, bold: true, raw: true }, 1) : null,
    ...effItems(d, 'cockpit').filter((_, i) => !(d.hud.pace && i === 0)), // the pace shows on line 2
  ]);

  // line 2: instruments
  const bottom = makeCanvas(cols, () => PANEL);
  const track = hex('#1c2733');
  const ctxMins = forecast(d.samples, 1, 30 * 60000);
  const u5Mins = forecast(d.samples, 2, 60 * 60000);
  const ctxBlock = d.ctx === null ? null : seq([
    label('CTX '),
    gaugeItem(d.ctx, 10, { fill: 'load', track }),
    value(` ${String(d.ctx).padStart(2)}%`, { fg: loadColor(d.ctx) }),
  ], 0);
  const ctxTrend = d.samples.length > 1 ? text(` ${sparkChars(d.samples.map(s => s[1]), 5)}`, { fg: CYAN, raw: true }, 4) : null;
  const ctxCast = ctxMins !== null ? text(` full in ~${duration(ctxMins * 60000)}`, { fg: LABEL, raw: true }, 3) : null;
  let usageCast = null;
  if (d.hud.pace) {
    // the mod's forecast reads the real reset time, so it wins
    const mins = (d.hud.pace.hitsAt - Date.now()) / 60000;
    usageCast = text(` limit ~${clockTime(d.hud.pace.hitsAt)} (${duration(mins * 60000)})`, { fg: RED, bold: true, raw: true }, 1);
  } else if (d.usage && u5Mins !== null) {
    const lasts = d.usage.resetsIn !== null && u5Mins * 60000 > d.usage.resetsIn;
    usageCast = lasts
      ? text(' lasts to reset ✓ ', { fg: GREEN, raw: true }, 3)
      : text(` limit ~${clockTime(Date.now() + u5Mins * 60000)} (${duration(u5Mins * 60000)})`, { fg: AMBER, bold: true, raw: true }, 1);
  } else if (resetText(d.usage)) {
    usageCast = text(` ${resetText(d.usage)}`, { fg: LABEL, raw: true }, 3);
  }
  const usageBlock = d.usage ? seq([
    label('5H '),
    gaugeItem(d.usage.pct, 10, { fill: 'load', track }),
    value(` ${String(d.usage.pct).padStart(2)}%`, { fg: loadColor(d.usage.pct) }),
  ], 0) : null;
  const usageTrend = d.usage && d.samples.length > 1
    ? text(` ${sparkChars(d.samples.map(s => Math.max(0, s[2])), 5)}`, { fg: CYAN, raw: true }, 4)
    : null;
  layout(bottom, [ctxBlock, ctxTrend, ctxCast], [usageBlock, usageTrend, usageCast], 1);

  return `${renderCanvas(top)}\n${renderCanvas(bottom)}`;
}

// ---------- neon ----------

const VOID = hex('#07060d');
const MAGENTA = hex('#ff2bd6');
const ELECTRIC = hex('#00e5ff');
const LIME = hex('#39ff14');
const DUSK = hex('#5b5b7a');

function renderNeon(d, cols) {
  const cv = makeCanvas(cols, () => VOID);
  const hot = pct => pct >= 80;
  const letters = [...d.model.toUpperCase()];
  const model = {
    w: letters.length,
    prio: 0,
    paint: (c, col) => {
      letters.forEach((ch, i) => paintText(c, col + i, ch, { fg: ramp([MAGENTA, ELECTRIC], i / Math.max(1, letters.length - 1)), bold: true, raw: true }));
      return col + letters.length;
    },
  };
  const sep = text(' ⟫ ', { fg: mix(MAGENTA, VOID, 0.35), raw: true });
  const state = d.hud.running
    ? text('▶ LIVE ', { fg: LIME, bold: true, raw: true })
    : text('■ IDLE ', { fg: DUSK, raw: true });
  const where = [state, model];
  const effort = effortItem(d, 'neon');
  if (effort) where.push(text(' '), effort);
  if (d.folder) where.push(sep, text(d.folder, { fg: ELECTRIC, raw: true }));
  if (gitText(d.git)) where.push(sep, text(gitText(d.git), { fg: hex('#ff9de2'), raw: true }));

  const meter = (name, pct, color, trackColor) => {
    const fill = hot(pct) ? hex('#ff4d4d') : color;
    return seq([
      text(`${name} `, { fg: fill, bold: hot(pct), raw: true }),
      gaugeItem(pct, 10, { fill, track: trackColor }),
      text(` ${pct}%`, { fg: fill, bold: true, raw: true }),
    ]);
  };
  const right = [
    d.hud.failed ? text('✗ FAIL', { fg: hex('#ff4d4d'), bold: true, raw: true }, 1) : null,
    ...effItems(d, 'neon'),
    d.ctx !== null ? { ...meter('CTX', d.ctx, MAGENTA, hex('#2a1033')), prio: 1 } : null,
    d.usage ? { ...meter('5H', d.usage.pct, ELECTRIC, hex('#0a2233')), prio: 2 } : null,
    resetText(d.usage) ? text(resetText(d.usage), { fg: DUSK, raw: true }, 4) : null,
  ];
  layout(cv, [seq(where, 0)], right, 3);
  return renderCanvas(cv);
}

// ---------- cyberpunk ----------
// A two-line netrunner HUD: hazard stripes, a glitching nameplate, segmented
// meters and a braille trace. Original art: no game's logos, fonts or layouts.

const GRID = hex('#0a0a12');
const CY_YELLOW = hex('#f3e600');
const CY_CYAN = hex('#00f0ff');
const CY_PINK = hex('#ff2a6d');
const CY_RED = hex('#ff003c');
const CY_GREEN = hex('#05ffa1');
const CY_DIM = hex('#5a5a80');
const CY_HAZARD_DARK = hex('#1c1a05');

/**
 * Hazard tape: diagonal stripes drawn in braille dots, dark on yellow. Each cell
 * is 2 dots wide and 4 tall, and the two status lines continue one pattern, so
 * the stripes run unbroken from the top line into the bottom one.
 */
const BRAILLE_LEFT = [0x01, 0x02, 0x04, 0x40];
const BRAILLE_RIGHT = [0x08, 0x10, 0x20, 0x80];
/** Diagonal hazard stripes in braille dots, continuing from the first status line into the second. */
function hazardChar(cellX, line, phase = 0) {
  let bits = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 2; c++) {
      const x = cellX * 2 + c;
      const y = line * 4 + r;
      if ((((x + y + phase) % 6) + 6) % 6 < 3) bits |= (c === 0 ? BRAILLE_LEFT : BRAILLE_RIGHT)[r];
    }
  }
  return String.fromCodePoint(0x2800 + bits);
}

const hazardItem = (n, line, look = { color: CY_YELLOW, phase: 0, glitch: null }) => ({
  w: n,
  prio: 0,
  paint: (cv, col) => {
    for (let i = 0; i < n && cv[col + i]; i++) {
      const torn = look.glitch && look.glitch.line === line && look.glitch.cell === i;
      Object.assign(cv[col + i], {
        ch: torn ? String.fromCodePoint(0x2800 + look.glitch.bits) : hazardChar(i, line, look.phase),
        fg: torn ? CY_PINK : look.color,
        bg: hex('#000000'),
        bold: true,
        dim: false,
        used: true,
      });
    }
    return col + n;
  },
});

/** The permission mode's colour and short name; an unknown mode keeps the classic yellow. */
const MODES = {
  auto: ['#00f0ff', 'AUTO'],
  plan: ['#b26bff', 'PLAN'],
  default: ['#ffb000', 'MANUAL'],
  acceptEdits: ['#05ffa1', 'EDITS'],
  bypassPermissions: ['#ff003c', 'BYPASS'],
  dontAsk: ['#ff6b00', 'NO-ASK'],
};
const modeColor = mode => (MODES[mode] ? hex(MODES[mode][0]) : CY_YELLOW);

/**
 * How the stripes look this redraw: red after a failed call; scrolling with a torn
 * cell while working; a slow breath in the mode's colour at rest.
 */
function sigilLook(d) {
  const now = Date.now();
  const base = modeColor(d.mode);
  if (d.hud.failed) return { color: now % 1000 < 500 ? CY_RED : mix(CY_RED, GRID, 0.35), phase: 0, glitch: null };
  if (d.hud.running) {
    const t = Math.floor(now / 150);
    const roll = hash(t);
    return {
      color: base,
      phase: -t,
      glitch: roll % 3 === 0 ? { line: roll % 2, cell: (roll >> 3) % 4, bits: (roll >> 5) & 0xff } : null,
    };
  }
  const breath = (Math.sin((now / 6000) * 2 * Math.PI) + 1) / 2;
  return { color: mix(base, GRID, 0.1 + 0.5 * breath), phase: 0, glitch: null };
}

/** `⎇ main ●3 ↑1`: the branch, files changed, commits not pushed. */
function cyberGit(git) {
  const parts = [text('⎇ ', { fg: CY_DIM, raw: true }), text(git.branch, { fg: CY_CYAN, raw: true })];
  if (git.dirty > 0) parts.push(text(` ●${git.dirty}`, { fg: CY_PINK, bold: true, raw: true }));
  if (git.ahead > 0) parts.push(text(` ↑${git.ahead}`, { fg: CY_YELLOW, bold: true, raw: true }));
  return seq(parts, 2);
}

/** `segs` lit blocks with a dark gap between each, like a combat HUD readout. */
const segmentItem = (pct, segs, color, prio = 0) => ({
  w: segs * 2 - 1,
  prio,
  paint: (cv, col) => {
    const exact = (clamp(pct, 0, 100) / 100) * segs;
    const full = Math.floor(exact);
    const track = mix(color, GRID, 0.82);
    for (let s = 0; s < segs; s++) {
      const cell = cv[col + s * 2];
      if (!cell) break;
      cell.ch = ' ';
      cell.bg = s < full ? color : s === full ? mix(track, color, exact - full) : track;
      cell.used = true;
      if (cv[col + s * 2 + 1] && s < segs - 1) cv[col + s * 2 + 1].used = true;
    }
    return col + segs * 2 - 1;
  },
});

/** The model on a neon nameplate; a letter tears into cyan-on-pink on some redraws. */
function nameplate(name) {
  const label = ` ${name.toUpperCase().replace(/\s+/g, '·')} `;
  const tick = Math.floor(Date.now() / 30000);
  const roll = hash(tick + 7) % (label.length * 3);
  const glitch = roll >= 1 && roll < label.length - 1 && label[roll] !== '·' ? roll : -1;
  return {
    w: label.length,
    prio: 0,
    paint: (cv, col) => {
      [...label].forEach((ch, i) => {
        const torn = i === glitch;
        paintText(cv, col + i, ch, { fg: torn ? CY_CYAN : GRID, bg: torn ? CY_PINK : CY_YELLOW, bold: true, raw: true });
      });
      return col + label.length;
    },
  };
}

function cyberMeter(name, pct, color) {
  const hot = pct >= 80;
  const tone = hot ? CY_RED : color;
  return seq([
    text(hot ? `⚠ ${name} ` : `${name} `, { fg: tone, bold: hot, raw: true }),
    segmentItem(pct, 8, tone),
    text(` ${String(pct).padStart(2)}%`, { fg: tone, bold: true, raw: true }),
  ]);
}

/** One cell per minute, newest at the right: the colour of what that minute did, red for a failure. */
const netTrafficItem = (activity, cells) => ({
  w: cells,
  prio: 0,
  paint: (cv, col) => {
    const byMinute = new Map(activity.map(a => [a[0], a]));
    const now = Math.floor(Date.now() / 60000);
    const colors = [CY_CYAN, CY_PINK, CY_GREEN, hex('#c77dff')];
    for (let i = 0; i < cells; i++) {
      const cell = cv[col + i];
      if (!cell) break;
      const a = byMinute.get(now - (cells - 1 - i));
      let bg = mix(CY_DIM, GRID, 0.78);
      if (a) {
        const counts = [a[1] || 0, a[2] || 0, a[3] || 0, a[4] || 0];
        const total = counts.reduce((x, y) => x + y, 0);
        const top = counts.indexOf(Math.max(...counts));
        bg = (a[5] || 0) > 0 ? CY_RED : mix(GRID, colors[top], 0.45 + Math.min(1, total / 8) * 0.55);
      }
      Object.assign(cell, { ch: ' ', bg, used: true });
    }
    return col + cells;
  },
});

const TICKS_LIVE = ['// signal stable', '// uplink secure', '// packets flowing', '// daemons humming'];
const TICKS_IDLE = ['// awaiting orders', '// grid quiet', '// standing by', '// line open'];
function cyberTicker(d) {
  const tick = Math.floor(Date.now() / 60000);
  if (d.hud.failed) return '// breach detected';
  if (d.levelUp) return `// rank up: ${String(d.hud.rep?.title || 'new tier').toLowerCase()}`;
  if ((d.ctx ?? 0) >= 80) return '// neural overload imminent';
  if ((d.usage?.pct ?? 0) >= 80) return '// ICE closing in';
  if (d.hud.running) return TICKS_LIVE[tick % TICKS_LIVE.length];
  const h = ((d.hour % 24) + 24) % 24;
  if (h < 5) return '// ghost in the wire';
  return TICKS_IDLE[tick % TICKS_IDLE.length];
}

/**
 * Two lines laid out as one grid: each column holds a top and a bottom item and
 * is as wide as the wider of the two, so the lines stay aligned. Columns are
 * dropped whole (lowest priority first) when the line is too narrow.
 */
function gridRows(top, bottom, left, right, gap = 3) {
  const width = c => Math.max(c.top?.w ?? 0, c.bottom?.w ?? 0);
  let l = left.filter(c => c.top || c.bottom);
  let r = right.filter(c => c.top || c.bottom);
  const total = () =>
    l.reduce((n, c) => n + width(c), 0) + Math.max(0, l.length - 1) * gap +
    r.reduce((n, c) => n + width(c), 0) + Math.max(0, r.length - 1) * gap + 2 + (r.length ? gap : 0);
  while (total() > top.length && l.length + r.length > 1) {
    const worst = Math.max(...l.map(c => c.prio), ...r.map(c => c.prio));
    const inR = r.findLastIndex(c => c.prio === worst);
    if (inR >= 0) r.splice(inR, 1);
    else l.splice(l.findLastIndex(c => c.prio === worst), 1);
  }
  const paintRow = (cv, which) => {
    let col = 1;
    for (const c of l) {
      c[which]?.paint(cv, col);
      col += width(c) + gap;
    }
    col = top.length - 1 - (r.reduce((n, c) => n + width(c), 0) + Math.max(0, r.length - 1) * gap);
    for (const c of r) {
      // right columns hug their right edge, so short items line up on the right
      const item = c[which];
      if (item) item.paint(cv, col + width(c) - item.w);
      col += width(c) + gap;
    }
  };
  paintRow(top, 'top');
  paintRow(bottom, 'bottom');
}

function renderCyberpunk(d, cols) {
  const top = makeCanvas(cols, () => GRID);
  const bottom = makeCanvas(cols, () => GRID);
  const look = sigilLook(d);
  const link = d.hud.running
    ? text('◢ JACKED IN 接続中', { fg: CY_GREEN, bold: true, raw: true })
    : text('◣ STANDBY 待機', { fg: CY_DIM, raw: true });
  const mode = MODES[d.mode]
    ? seq([text('MODE ', { fg: CY_DIM, raw: true }), text(MODES[d.mode][1], { fg: modeColor(d.mode), bold: true, raw: true })])
    : null;
  const elapsed = d.cost?.total_duration_ms;
  const daemon = d.hud.daemons[0]
    ? seq([
        text('DAEMON·', { fg: CY_DIM, raw: true }),
        text(String(d.hud.daemons[0].name).slice(0, 18), { fg: CY_GREEN, raw: true }),
        text(` ${duration(Date.now() - d.hud.daemons[0].started)}`, { fg: CY_DIM, raw: true }),
      ])
    : null;
  // warnings that matter now: a breach, a limit coming before its reset, the budget
  const alerts = [
    d.hud.failed ? text('⚠ BREACH', { fg: CY_RED, bold: true, raw: true }) : null,
    ...effItems(d, 'cyber').filter(item => !item.isCache),
  ].filter(Boolean);
  const alert = alerts.length ? seq(alerts.flatMap((a, i) => (i ? [text('  '), a] : [a]))) : null;
  const rep = d.levelUp
    ? text(` ▲ LV${d.hud.rep.level} UNLOCKED `, {
        fg: GRID,
        bg: Math.floor(Date.now() / 700) % 2 ? CY_YELLOW : CY_PINK,
        bold: true,
        raw: true,
      })
    : d.hud.rep
      ? seq([
          text('REP ', { fg: CY_DIM, raw: true }),
          text(`${d.hud.rep.points} LV${d.hud.rep.level}`, { fg: CY_PINK, bold: true, raw: true }),
          d.hud.rep.streak > 1 ? text(` ${d.hud.rep.streak}d`, { fg: CY_YELLOW, raw: true }) : text(''),
        ])
      : null;

  gridRows(top, bottom, [
    // identity: who, and whether Claude is working
    { prio: 0, top: seq([hazardItem(4, 0, look), text(' '), nameplate(d.model)]), bottom: seq([hazardItem(4, 1, look), text(' '), link]) },
    // how hard it thinks, and the permission mode
    { prio: 2, top: effortItem(d, 'cyber'), bottom: mode },
    // where, and the ticker
    { prio: 4, top: d.folder ? text(`//${d.folder}`, { fg: CY_CYAN, raw: true }) : null, bottom: text(cyberTicker(d), { fg: mix(CY_PINK, GRID, 0.25), raw: true }) },
    // git, and the traffic of the last minutes
    { prio: 6, top: d.git ? cyberGit(d.git) : null, bottom: d.hud.activity.length > 0 ? seq([text('NET ', { fg: CY_DIM, raw: true }), netTrafficItem(d.hud.activity, 16)]) : null },
  ], [
    { prio: 1, top: d.ctx !== null ? cyberMeter('NEURAL', d.ctx, CY_PINK) : null, bottom: rep },
    { prio: 2, top: d.usage ? cyberMeter('BANDWIDTH', d.usage.pct, CY_CYAN) : null, bottom: typeof elapsed === 'number' ? seq([text('UPTIME ', { fg: CY_DIM, raw: true }), text(clock(elapsed), { fg: CY_CYAN, bold: true, raw: true })]) : null },
    // a live warning keeps its column even on a narrow terminal
    { prio: alert ? 0 : 3, top: resetText(d.usage) ? text(`REBOOT ${duration(d.usage.resetsIn)}`, { fg: CY_DIM, raw: true }) : null, bottom: alert ?? daemon },
  ]);

  return `${renderCanvas(top)}\n${renderCanvas(bottom)}`;
}

// ---------- main ----------

const config = readJson(join(DIR, 'config.json'), {});
const configured = config.style || (config.mode === 'minimal' ? 'minimal' : 'classic');
const style = STYLES.includes(process.env.POLISH_STYLE) ? process.env.POLISH_STYLE : STYLES.includes(configured) ? configured : 'classic';
const sepStyle = process.env.POLISH_SEPARATOR || config.separator || 'powerline';
const now = new Date();
const hour = process.env.POLISH_HOUR !== undefined ? Number(process.env.POLISH_HOUR) : now.getHours() + now.getMinutes() / 60;
// Claude Code indents the status line and keeps a little room at the right, so
// leave 6 cells; a line that touches the edge gets cut with an ellipsis.
const cols = Math.max(40, Math.min(400, Number.parseInt(process.env.COLUMNS || '', 10) || 100) - 6);

const input = readStdin();
// the last input, kept for troubleshooting a field the bar should show
if (!process.env.POLISH_STATE_DIR) {
  try {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, 'last-stdin.json'), JSON.stringify(input, null, 2));
  } catch {
    /* optional */
  }
}
// the project folder Claude Code started in; the shell's current folder can wander
const cwd = input.workspace?.project_dir || input.workspace?.current_dir || input.cwd || '';
const cache = readJson(join(DIR, 'cache.json'), {});
const ctx = contextPercent(input);
const u = usage(input);
const hud = hudState();
const data = {
  hour: Number.isFinite(hour) ? hour : 12,
  model: modelName(input),
  folder: cwd ? basename(cwd.replace(/[\\/]+$/, '')) : '',
  // the folder Claude is working in can be a repo even when the project folder is not
  git: process.env.POLISH_NO_GIT ? null : gitInfo(input.workspace?.current_dir || cwd, cache),
  mode: process.env.POLISH_MODE ?? (typeof input.permission_mode === 'string' && input.permission_mode ? input.permission_mode : hud.mode),
  ctx,
  usage: u,
  cost: input.cost ?? null,
  hud,
  levelUp: process.env.POLISH_LEVEL_UP ? Number(process.env.POLISH_LEVEL_UP) : levelUp(cache, hud.rep),
  samples: history(cache, input.session_id, ctx, u ? u.pct : -1),
  sessionId: typeof input.session_id === 'string' ? input.session_id : '',
  cacheHit: typeof input.prompt_cache?.hit_ratio === 'number' ? input.prompt_cache.hit_ratio : null,
  effort: typeof input.effort?.level === 'string' ? input.effort.level : null,
  fast: input.fast_mode === true,
};

try {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'cache.json'), JSON.stringify(cache));
} catch {
  /* the cache is optional */
}

const renderers = {
  classic: () => renderClassic(data, sepStyle),
  minimal: () => renderMinimal(data),
  sky: () => renderSky(data, cols),
  aurora: () => renderAurora(data, cols),
  cockpit: () => renderCockpit(data, cols),
  neon: () => renderNeon(data, cols),
  cyberpunk: () => renderCyberpunk(data, cols),
};

let output;
try {
  output = renderers[style]();
} catch {
  output = renderMinimal(data);
}
process.stdout.write(`${output}\n`);
