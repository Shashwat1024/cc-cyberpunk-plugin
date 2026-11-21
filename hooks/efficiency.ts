// Efficiency tracking helpers: pure functions, unit-tested in tests/efficiency.test.ts.
import type { BudgetSetting, DayBucket, LagStat } from '../types'

// ---------- slowest tools: one key per kind of call ----------

/** Programs whose first non-flag argument names what they did (`cargo build`, `npm test`). */
const MULTI = new Set([
  'git', 'cargo', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'deno', 'python', 'python3', 'py', 'uv', 'pip',
  'go', 'docker', 'claude', 'make', 'gh', 'dotnet', 'mvn', 'gradle', 'kubectl', 'terraform', 'tsc',
])
/** Flags that take the next word as their value, so it isn't the subcommand. */
const VALUE_FLAGS = new Set(['-C', '-c', '-p', '--prefix', '--manifest-path', '--cwd', '-f', '--file', '-m'])

const baseName = (p: string): string => p.replace(/^["']|["']$/g, '').split(/[\\/]/).filter(Boolean).pop() ?? p

/** Normalises a tool call into a leaderboard key: `cargo build`, `npm test`, `Read`, `mcp:github`. */
export function commandKey(tool: string, input: unknown): string {
  if (tool.startsWith('mcp__')) return `mcp:${tool.split('__')[1] ?? 'server'}`
  if (tool !== 'Bash' && tool !== 'PowerShell') return tool
  const command = (input as { command?: unknown } | null)?.command
  const raw = typeof command === 'string' ? command : ''
  // the first link of a chain that does real work: skip cd/export/set and the like
  const links = raw.split(/&&|\|\||;|\n/).map(s => s.trim()).filter(Boolean)
  const link = links.find(l => !/^(cd|pushd|popd|export|set|source|\.|echo|mkdir)\b/.test(l)) ?? links[0] ?? ''
  const words = (link.split('|')[0] ?? '').trim().split(/\s+/).filter(Boolean)
  while (words.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '') || ['sudo', 'time', 'exec', 'env'].includes(words[0] ?? ''))) {
    words.shift()
  }
  if (words.length === 0) return tool
  const program = baseName(words[0] ?? '').replace(/\.(exe|cmd|bat)$/i, '')
  if (MULTI.has(program)) {
    for (let i = 1; i < words.length; i++) {
      const word = words[i] ?? ''
      if (VALUE_FLAGS.has(word)) {
        i++
        continue
      }
      if (word.startsWith('-') || /^\d?>/.test(word)) continue
      return `${program} ${baseName(word)}`.slice(0, 40)
    }
  }
  return program.slice(0, 40)
}

/** Adds one call's duration to a leaderboard. */
export function addLag(board: Record<string, LagStat>, key: string, ms: number): Record<string, LagStat> {
  const prev = board[key] ?? { n: 0, total: 0, max: 0 }
  return { ...board, [key]: { n: prev.n + 1, total: prev.total + ms, max: Math.max(prev.max, ms) } }
}

/** Merges two leaderboards, keeping the `limit` keys with the most total time. */
export function mergeLag(a: Record<string, LagStat>, b: Record<string, LagStat>, limit = 150): Record<string, LagStat> {
  const out: Record<string, LagStat> = { ...a }
  for (const [key, s] of Object.entries(b)) {
    const prev = out[key] ?? { n: 0, total: 0, max: 0 }
    out[key] = { n: prev.n + s.n, total: prev.total + s.total, max: Math.max(prev.max, s.max) }
  }
  return Object.fromEntries(Object.entries(out).sort((x, y) => y[1].total - x[1].total).slice(0, limit))
}

/** The slowest keys by total time. */
export function topLag(board: Record<string, LagStat>, count = 8): [string, LagStat][] {
  return Object.entries(board).sort((x, y) => y[1].total - x[1].total).slice(0, count)
}

// ---------- context hogs ----------

/** About four characters to a token: an estimate, always shown with "~". */
export const estTokens = (text: string): number => Math.round(text.length / 4)

export const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// ---------- rate-limit pacing ----------

export type Pace = { hitsAt: number | null; lastsToReset: boolean; perHour: number | null }

/**
 * When a usage window will reach 100% at the recent pace: a straight line
 * through the samples since the last reset, over the last hour.
 */
export function paceForecast(samples: readonly [number, number][], now: number, resetsAt: number | null): Pace {
  let start = 0
  for (let i = 1; i < samples.length; i++) if ((samples[i]?.[1] ?? 0) < (samples[i - 1]?.[1] ?? 0) - 3) start = i
  const recent = samples.slice(start).filter(s => now - s[0] <= 60 * 60_000)
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (!first || !last || recent.length < 2 || last[0] - first[0] < 3 * 60_000 || last[1] <= first[1]) {
    return { hitsAt: null, lastsToReset: true, perHour: null }
  }
  const perMs = (last[1] - first[1]) / (last[0] - first[0])
  const hitsAt = now + (100 - last[1]) / perMs
  return { hitsAt, lastsToReset: resetsAt !== null && hitsAt >= resetsAt, perHour: perMs * 3_600_000 }
}

/** A local clock time like "3:40 PM". */
export function clockTime(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// ---------- cost per result ----------

export type CostMetrics = { perTurn: number | null; perHour: number | null; perCommit: number | null; per100Lines: number | null }

export function costMetrics(m: { usd: number; activeMin: number; turns: number; commits: number; linesChanged: number }): CostMetrics {
  const per = (d: number) => (d > 0 && m.usd > 0 ? m.usd / d : null)
  return {
    perTurn: per(m.turns),
    perHour: per(m.activeMin / 60),
    perCommit: per(m.commits),
    per100Lines: per(m.linesChanged / 100),
  }
}

export const fmtUsd = (usd: number): string => (usd >= 100 ? `$${usd.toFixed(0)}` : usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(3)}`)

// ---------- cache savings ----------

/**
 * $ per million tokens: the input price and the cache-read price, from the
 * Claude API reference (Anthropic first-party rates, 2026-11). A model not
 * listed shows its hit rate but no dollar figure.
 */
export const PRICES: Record<string, { input: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.1 },
  'claude-fable-5-2': { input: 8, cacheRead: 0.2 },
  'claude-mythos-5-2': { input: 8, cacheRead: 0.2 },
}

export function priceOf(model: string): { input: number; cacheRead: number } | null {
  const id = model.toLowerCase().replace(/\[.*\]$/, '').replace(/^.*\./, '')
  const key = Object.keys(PRICES).find(k => id === k || id.startsWith(`${k}-`) || id.startsWith(k))
  return key ? (PRICES[key] ?? null) : null
}

/** What cache reads saved against paying full input price for the same tokens. */
export function cacheSavings(readsByModel: Record<string, number>): { usd: number | null; tokens: number } {
  let usd = 0
  let priced = false
  let tokens = 0
  for (const [model, n] of Object.entries(readsByModel)) {
    tokens += n
    const price = priceOf(model)
    if (price) {
      priced = true
      usd += (n / 1_000_000) * (price.input - price.cacheRead)
    }
  }
  return { usd: priced ? usd : null, tokens }
}

// ---------- activity heatmap ----------

export type HeatMetric = 'time' | 'jobs' | 'cost'
export const HEAT_WEEKS = 12

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The last `HEAT_WEEKS` weeks as a grid: `grid[week][weekday]` (Monday first,
 * the current week last), each a value or null for days still to come.
 */
export function heatGrid(days: Record<string, DayBucket>, metric: HeatMetric, now: number) {
  const today = new Date(now)
  const todayRow = (today.getDay() + 6) % 7
  const grid: (number | null)[][] = []
  const dates: string[][] = []
  let max = 0
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const col: (number | null)[] = []
    const keys: string[] = []
    for (let r = 0; r < 7; r++) {
      const back = (HEAT_WEEKS - 1 - w) * 7 + (todayRow - r)
      if (back < 0) {
        col.push(null)
        keys.push('')
        continue
      }
      const d = new Date(today)
      d.setDate(d.getDate() - back)
      const key = keyOf(d)
      const b = days[key]
      const v = b ? (metric === 'time' ? b.active : metric === 'jobs' ? b.jobs : b.usd) : 0
      max = Math.max(max, v)
      col.push(v)
      keys.push(key)
    }
    grid.push(col)
    dates.push(keys)
  }
  return { grid, dates, max, todayKey: keyOf(today) }
}

/** 0 for nothing, 1-4 for each quarter of the busiest day. */
export const heatLevel = (v: number, max: number): number => (v <= 0 || max <= 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999)))

/** Month labels above the weeks: three-letter names where a month starts. */
export function monthRow(dates: string[][], cellWidth: number): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  let row = ''
  let last = ''
  dates.forEach((week, w) => {
    const first = week.find(Boolean) ?? ''
    const month = first.slice(5, 7)
    if (month && month !== last && row.length <= w * cellWidth) {
      row = row.padEnd(w * cellWidth, ' ') + (names[Number(month) - 1] ?? '')
      last = month
    }
  })
  return row
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of bytes. */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += B64[(n >> 18) & 63] ?? ''
    out += B64[(n >> 12) & 63] ?? ''
    out += i + 1 < bytes.length ? (B64[(n >> 6) & 63] ?? '') : '='
    out += i + 2 < bytes.length ? (B64[n & 63] ?? '') : '='
  }
  return out
}

const hexInt = (hex: string): number => parseInt(hex.replace('#', ''), 16)
const DEFAULT_COLOR = 0x01000000

/**
 * Raster cells for the heatmap: per week a 2-column block and a 1-column gap,
 * seven rows. Each cell is [codePoint, fg, bg] as little-endian u32.
 */
export function heatCells(
  heat: { grid: (number | null)[][]; dates: string[][]; max: number; todayKey: string },
  levels: readonly string[],
): { columns: number; rows: number; cells: string } {
  const columns = HEAT_WEEKS * 3 - 1
  const rows = 7
  const words = new Uint32Array(columns * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = (r * columns + c) * 3
      words[i] = 0x20
      words[i + 1] = DEFAULT_COLOR
      words[i + 2] = DEFAULT_COLOR
      const w = Math.floor(c / 3)
      if (c % 3 === 2) continue
      const v = heat.grid[w]?.[r]
      if (v === null || v === undefined) continue
      const color = levels[heatLevel(v, heat.max)] ?? levels[0] ?? '#222222'
      words[i + 2] = hexInt(color)
      if (heat.dates[w]?.[r] === heat.todayKey && c % 3 === 0) {
        words[i] = 0x2836 // a braille dot pair marks today
        words[i + 1] = 0xffffff
      }
    }
  }
  return { columns, rows, cells: toBase64(new Uint8Array(words.buffer)) }
}

// ---------- budget ----------

export type Budget = BudgetSetting

/** Parses `/budget` arguments: `$20`, `20`, `5h 80%`, `7d 90`, `off`. */
export function parseBudget(args: string, current: Budget): Budget | 'off' | null {
  const text = args.trim().toLowerCase()
  if (text === 'off' || text === 'clear' || text === 'none') return 'off'
  const window = /^(5h|7d)\s+(\d{1,3})\s*%?$/.exec(text)
  if (window) {
    const pct = Number(window[2])
    if (pct < 1 || pct > 100) return null
    return window[1] === '5h' ? { ...current, fiveHour: pct } : { ...current, sevenDay: pct }
  }
  const usd = /^\$?\s*(\d+(?:\.\d+)?)$/.exec(text)
  if (usd) {
    const amount = Number(usd[1])
    return amount > 0 ? { ...current, usdPerDay: amount } : null
  }
  return null
}
