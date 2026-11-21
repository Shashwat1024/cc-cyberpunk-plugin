// Pure helpers and constants for cc-cyberpunk-plugin. State atoms live in the file that
// uses them: `claude plugin validate` follows an atom only within its own file.
import type { Phase, TurnInfo } from '../types'

export const IDLE_TURN: TurnInfo = {
  running: false,
  startedAt: 0,
  phase: 'other',
  calls: 0,
  edits: 0,
  commands: 0,
  errors: 0,
}

// Shape tags: bump one when that value's fields change. A hot reload keeps the
// old value, and the new tag makes the new code start from the initial.
export const SHAPE = { turn: 'turn-1', summary: 'summary-1', log: 'log-1', files: 'files-1' } as const

/** The main loop's tool call in flight, for the spinner's words. Module state: shared by the hooks. */
export const live = { tool: '', label: '' }

export const OVERVIEW = 'polish-overview'
export const SCRATCH = 'polish-scratch'

// ---------- tools ----------

const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const EDIT = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const RUN = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'Monitor'])

export function phaseOf(tool: string): Phase {
  if (READ.has(tool)) return 'read'
  if (EDIT.has(tool)) return 'edit'
  if (RUN.has(tool)) return 'run'
  return 'other'
}

export const PHASE_COLOR: Record<Phase, string> = {
  read: '#38bdf8',
  edit: '#ffb020',
  run: '#2cf58a',
  other: '#c77dff',
}

/** Mixes two #rrggbb colours, t from 0 (a) to 1 (b). */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [p(a), p(b)]
  const k = Math.min(1, Math.max(0, t))
  return `#${x.map((v, i) => Math.round(v + ((y[i] ?? v) - v) * k).toString(16).padStart(2, '0')).join('')}`
}

export const PHASE_LABEL: Record<Phase, string> = {
  read: 'reading',
  edit: 'editing',
  run: 'running',
  other: 'working',
}

export function iconOf(tool: string): string {
  if (tool === 'Read' || tool === 'NotebookRead') return '📖'
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS' || tool === 'ToolSearch') return '🔍'
  if (EDIT.has(tool)) return '📝'
  if (RUN.has(tool)) return '⚡'
  if (tool === 'WebFetch' || tool === 'WebSearch') return '🌐'
  if (tool === 'Agent' || tool === 'Task' || tool === 'SendMessage') return '🤖'
  if (tool === 'TodoWrite' || tool.includes('work_state')) return '📋'
  if (tool === 'Skill') return '🎯'
  if (tool.startsWith('mcp__')) return '🧩'
  return '🔧'
}

type Loose = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** A few words naming what the call worked on, for the timeline. */
export function labelOf(tool: string, input: unknown): string {
  const i = (input ?? {}) as Loose
  const file = str(i.file_path) || str(i.notebook_path) || str(i.path)
  if (file && (READ.has(tool) || EDIT.has(tool))) return baseName(file)
  if (RUN.has(tool)) return str(i.command).split('\n')[0] ?? ''
  if (tool === 'Grep' || tool === 'Glob') return str(i.pattern)
  if (tool === 'WebFetch') {
    const url = str(i.url)
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }
  if (tool === 'WebSearch') return str(i.query)
  if (tool === 'Agent' || tool === 'Task') return str(i.description)
  if (tool === 'Skill') return str(i.skill)
  if (tool.startsWith('mcp__')) return tool.split('__').slice(1).join(' ')
  return str(i.description)
}

const lines = (v: unknown): string[] => (typeof v === 'string' && v.length > 0 ? v.split('\n') : [])

/** Lines added and removed, as a multiset difference of the two texts' lines. */
export function lineDiff(before: string[], after: string[]): { added: number; removed: number } {
  const counts = new Map<string, number>()
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)
  let common = 0
  for (const line of after) {
    const left = counts.get(line) ?? 0
    if (left > 0) {
      counts.set(line, left - 1)
      common += 1
    }
  }
  return { added: after.length - common, removed: before.length - common }
}

/** +N/−M for an edit-like call, or null for any other tool. */
export function diffStat(tool: string, input: unknown): { added: number; removed: number } | null {
  const i = (input ?? {}) as Loose
  if (tool === 'Write') return { added: lines(i.content).length, removed: 0 }
  if (tool === 'Edit') return lineDiff(lines(i.old_string), lines(i.new_string))
  if (tool === 'MultiEdit' && Array.isArray(i.edits)) {
    const sum = { added: 0, removed: 0 }
    for (const edit of i.edits as Loose[]) {
      const one = lineDiff(lines(edit.old_string), lines(edit.new_string))
      sum.added += one.added
      sum.removed += one.removed
    }
    return sum
  }
  return null
}

/** The exit code in a failed command's output, if it names one. */
export function exitOf(output: unknown): number | null {
  const text =
    typeof output === 'string'
      ? output
      : output && typeof output === 'object' && typeof (output as Loose).text === 'string'
        ? ((output as Loose).text as string)
        : ''
  const match = /exit code (\d+)/i.exec(text)
  return match ? Number(match[1]) : null
}

export function fmtDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

/** dim under 10 s, amber to a minute, red past it. */
export function durationTone(ms: number): 'dim' | 'warning' | 'error' {
  if (ms < 10_000) return 'dim'
  if (ms < 60_000) return 'warning'
  return 'error'
}

export const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? '' : /(s|x|ch|sh)$/.test(word) ? 'es' : 's'}`

/** The tip the band shows for a prompt draft, or null. */
export function hintFor(text: string): string | null {
  if (text.length === 0) return null
  if (text.startsWith('/')) return 'Tab completes the command · ↑↓ to pick one'
  if (text.startsWith('!')) return '! runs this line in your shell; the output lands in the chat'
  if (/(^|\s)@[^\s]*$/.test(text)) return '@ attaches a file · Tab completes the path'
  if (text.length > 400) return 'Long prompt? Ctrl+G opens it in your editor'
  return null
}

/** Cells before, inside and after the pulse's bright tail, for `width` cells at `frame`. */
export function pulseCells(width: number, frame: number): [number, number, number] {
  const tail = Math.min(10, Math.max(3, Math.floor(width / 6)))
  const span = width + tail
  const head = frame % span
  const start = Math.max(0, head - tail)
  const end = Math.min(width, head)
  return [start, Math.max(0, end - start), Math.max(0, width - Math.max(end, start))]
}
