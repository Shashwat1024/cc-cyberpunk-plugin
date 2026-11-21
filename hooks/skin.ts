// Skins: how the mod's own parts look under each status line style. The style
// is chosen with /polish and kept in polish/config.json; every themed part of
// the mod (panes, spinner, tool rows, mode tag, toasts, recap) follows it.
// The cyberpunk skin is original genre art: no game's names, logos or layouts.

import type { Phase, Rep } from '../types'

export type Skin = {
  name: string
  /** the cyberpunk extras: tags, hacker verbs, data rain, mode tag, job card */
  cyber: boolean
  accent: string
  accent2: string
  bar: string
  good: string
  warn: string
  bad: string
  muted: string
  labels: {
    context: string
    timeline: string
    files: string
    agents: string
    notes: string
    calls: string
    edits: string
    commands: string
    errors: string
    efficiency: string
    pacing: string
    spend: string
    cache: string
    hogs: string
    lag: string
    activity: string
  }
  upper: boolean
}

const BASE_LABELS = {
  context: 'Context',
  timeline: 'Timeline',
  files: 'Files edited',
  agents: 'Agents',
  notes: 'Notes',
  calls: 'call',
  edits: 'edit',
  commands: 'command',
  errors: 'error',
  efficiency: 'Efficiency',
  pacing: 'Pacing',
  spend: 'Spend (est.)',
  cache: 'Cache',
  hogs: 'Context hogs',
  lag: 'Slowest tools',
  activity: 'Activity',
}

const base = (name: string, accent: string, accent2: string, bar = accent): Skin => ({
  name,
  cyber: false,
  accent,
  accent2,
  bar,
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  muted: '#7c8799',
  labels: BASE_LABELS,
  upper: false,
})

export const SKINS: Record<string, Skin> = {
  classic: base('classic', '#7dafff', '#a7b4c6'),
  minimal: { ...base('minimal', '#9aa5b8', '#6b7280'), muted: '#6b7280' },
  sky: base('sky', '#6fb3ee', '#f7c98b'),
  aurora: base('aurora', '#a78bfa', '#2dd4bf', '#8b5cf6'),
  cockpit: {
    ...base('cockpit', '#38bdf8', '#5f7185'),
    upper: true,
    labels: {
      ...BASE_LABELS,
      context: 'CTX',
      timeline: 'LOG',
      files: 'FILES',
      agents: 'AGENTS',
      notes: 'NOTES',
      efficiency: 'EFFICIENCY',
      pacing: 'PACING',
      spend: 'SPEND (EST.)',
      cache: 'CACHE',
      hogs: 'CONTEXT HOGS',
      lag: 'SLOWEST',
      activity: 'ACTIVITY',
    },
  },
  neon: base('neon', '#ff2bd6', '#00e5ff'),
  cyberpunk: {
    name: 'cyberpunk',
    cyber: true,
    accent: '#f3e600',
    accent2: '#00f0ff',
    bar: '#ff2a6d',
    good: '#05ffa1',
    warn: '#f3e600',
    bad: '#ff003c',
    muted: '#6a6a90',
    upper: true,
    labels: {
      context: 'NEURAL',
      timeline: 'NET LOG',
      files: 'SHARDS',
      agents: 'DAEMONS',
      notes: 'DATA SHARDS',
      calls: 'op',
      edits: 'rewrite',
      commands: 'exec',
      errors: 'breach',
      efficiency: 'OPS REPORT',
      pacing: 'BURN RATE',
      spend: 'CREDITS (EST.)',
      cache: 'CACHE',
      hogs: 'MEMORY HOGS',
      lag: 'LAG LEADERS',
      activity: 'GRID ACTIVITY',
    },
  },
}

/**
 * The cyberdeck emblem: a diamond of diagonal hazard stripes, 12 cells by 8
 * lines of braille dots, drawn dimmed beside the header. Replace these lines
 * with your own braille art to make the deck yours.
 */
export const SIGIL_ART: string[] = (() => {
  const left = [0x01, 0x02, 0x04, 0x40]
  const right = [0x08, 0x10, 0x20, 0x80]
  const [w, h] = [24, 32]
  const lines: string[] = []
  for (let line = 0; line < h / 4; line++) {
    let s = ''
    for (let cx = 0; cx < w / 2; cx++) {
      let bits = 0
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          const x = cx * 2 + c
          const y = line * 4 + r
          // inside a diamond, with stripes running down to the left
          const inside = Math.abs(x - w / 2 + 0.5) / (w / 2) + Math.abs(y - h / 2 + 0.5) / (h / 2) <= 1
          if (inside && (x + y) % 6 < 3) bits |= (c === 0 ? left : right)[r] ?? 0
        }
      }
      s += String.fromCodePoint(0x2800 + bits)
    }
    lines.push(s)
  }
  return lines
})()

/** The heatmap's five colours: empty, then four rising levels in the skin's colour. */
export function heatLevels(skin: Skin): string[] {
  const base = skin.cyber ? '#ff2a6d' : skin.name === 'classic' || skin.name === 'minimal' ? '#39d353' : skin.bar
  const empty = skin.cyber ? '#1a1530' : '#1f242c'
  const mix = (t: number) => {
    const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
    const [a, b] = [p(empty), p(base)]
    return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')}`
  }
  return [empty, mix(0.3), mix(0.55), mix(0.8), mix(1)]
}

export const skinFor = (style: string): Skin => SKINS[style] ?? (SKINS.classic as Skin)

// ---------- cyberpunk vocabulary ----------

export const CYBER = {
  yellow: '#f3e600',
  cyan: '#00f0ff',
  pink: '#ff2a6d',
  red: '#ff003c',
  green: '#05ffa1',
  violet: '#c77dff',
  ink: '#0a0a12',
  dim: '#6a6a90',
}

export const CYBER_PHASE: Record<Phase, string> = {
  read: CYBER.cyan,
  edit: CYBER.pink,
  run: CYBER.green,
  other: CYBER.violet,
}

/** A short neon tag per tool, for the ops log. */
export function tagOf(tool: string): string {
  if (tool === 'Read' || tool === 'NotebookRead') return 'RD/'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS' || tool === 'ToolSearch') return 'SCAN/'
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'WR/'
  if (tool === 'Write') return 'FORGE/'
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'BashOutput' || tool === 'Monitor') return 'EX/'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'NET/'
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') return 'AGT/'
  if (tool.startsWith('mcp__')) return 'MCP/'
  return 'SYS/'
}

/** What the spinner says a tool call is doing, before its target. */
export function verbOf(tool: string): string {
  if (tool === 'Read' || tool === 'NotebookRead') return 'Decrypting'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS' || tool === 'ToolSearch') return 'Scanning subnet for'
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'Rewriting'
  if (tool === 'Write') return 'Forging'
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'Monitor') return 'Executing'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Jacking into'
  if (tool === 'Agent' || tool === 'Task') return 'Deploying daemon'
  if (tool.startsWith('mcp__')) return 'Interfacing with'
  return 'Running'
}

export function modeVerb(mode: string): string {
  if (mode === 'thinking') return 'Running neural sim'
  if (mode === 'responding') return 'Transmitting'
  if (mode === 'requesting') return 'Handshaking'
  return 'Processing'
}

const MODE_TAGS: Record<string, { tag: string; subtitle: string }> = {
  auto: { tag: 'AUTO', subtitle: 'autonomous run' },
  plan: { tag: 'RECON', subtitle: 'plan only, no writes' },
  acceptEdits: { tag: 'WRITE', subtitle: 'edits auto-accepted' },
  bypassPermissions: { tag: 'OVERRIDE', subtitle: 'all locks off' },
  dontAsk: { tag: 'SILENT', subtitle: 'no prompts, rules decide' },
  default: { tag: 'MANUAL', subtitle: 'safe mode' },
}

/**
 * The permission mode's tag and cyberpunk subtitle: from the mode Claude Code
 * reported (`auto`, `plan`, ...), else from the hint line's words.
 */
export function modeTag(mode: string, hint = ''): { tag: string; subtitle: string } {
  const known = MODE_TAGS[mode]
  if (known) return known
  const text = hint.toLowerCase()
  if (text.includes('bypass')) return MODE_TAGS.bypassPermissions as { tag: string; subtitle: string }
  if (text.includes('auto mode')) return MODE_TAGS.auto as { tag: string; subtitle: string }
  if (text.includes('plan mode')) return MODE_TAGS.plan as { tag: string; subtitle: string }
  if (text.includes('accept edits')) return MODE_TAGS.acceptEdits as { tag: string; subtitle: string }
  return MODE_TAGS.default as { tag: string; subtitle: string }
}

/** A stable 4-digit hex id for a text, like a data shard's serial. */
export function hexId(textValue: string): string {
  let h = 2166136261
  for (let i = 0; i < textValue.length; i++) {
    h ^= textValue.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).slice(-4).toUpperCase().padStart(4, '0')
}

/** A run of hex bytes that drifts with the frame, for the data rain. */
export function hexStream(cells: number, frame: number): string {
  let out = ''
  for (let i = 0; out.length < cells; i++) {
    let x = Math.imul(i - Math.floor(frame / 2) + 1000003, 2654435761) >>> 0
    x ^= x >>> 13
    out += `${(x >>> 0).toString(16).slice(-2).toUpperCase().padStart(2, '0')} `
  }
  return out.slice(0, cells)
}

// ---------- street rep ----------

export type { Rep }

const TITLES = ['Script Kiddie', 'Code Runner', 'Wire Ghost', 'Daemon Smith', 'Grid Legend']

export function levelOf(points: number): { level: number; title: string; into: number; span: number } {
  const span = 250
  const level = 1 + Math.floor(points / span)
  return { level, title: TITLES[Math.min(TITLES.length - 1, level - 1)] ?? 'Grid Legend', into: points % span, span }
}

/** Rep for one finished job: a base for finishing, plus its work. */
export function repFor(job: { edits: number; commands: number; commits: number; errors: number }): number {
  return Math.max(1, 10 + job.edits + job.commands * 2 + job.commits * 25 - job.errors)
}

/** The day's key in local time. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whether `prev` is the day before `today` (both day keys). */
export function isYesterday(prev: string, today: string): boolean {
  const t = new Date(`${today}T12:00:00`)
  t.setDate(t.getDate() - 1)
  return dayKey(t.getTime()) === prev
}
