// cc-cyberpunk-plugin: wires Claude Code's events to the band, spinner, tool rows, toasts
// and panes, and tells the status line script what the session is doing.
import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CallTime, Ctx, Daemon, Job, LogEntry, Rep, Summary } from '../types'
import { registerBand } from './band'
import { looksSessionStart, registerLooks } from './looks/looks'
import { meterHud, meterLines, meterMeasure, meterSessionStart, meterToolCall, meterTurnComplete, meterTurnStart } from './meter'
import { registerPanes } from './panes'
import { registerStats } from './stats'
import { dayKey, isYesterday, levelOf, repFor, skinFor } from './skin'
import { registerToolRows } from './toolrow'
import { diffStat, fmtDuration, hintFor, IDLE_TURN, labelOf, live, OVERVIEW, phaseOf, plural } from './track'

const turnAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'turn' } as const, IDLE_TURN, { shape: 'turn-1' })
const summaryAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'summary' } as const, null as Summary | null, {
  shape: 'summary-1',
})
const frameAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'frame' } as const, 0)
const hintAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'hint' } as const, null as string | null)
const timeFamily = atom({ plugin: 'cc-cyberpunk-plugin', key: 'time' } as const, { start: 0, end: null } as CallTime)
const logAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'log' } as const, [] as LogEntry[], { shape: 'log-1' })
const filesAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'files' } as const, {} as Record<string, number>, {
  shape: 'files-1',
})
const ctxAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'ctx' } as const, null as Ctx | null)
const warnedAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'warned' } as const, false)
const sinceAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'since' } as const, 0)
const autoOpenedAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'autoOpened' } as const, false)
const notesAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'notes' } as const, [] as string[])
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')
const daemonsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'daemons' } as const, [] as Daemon[], { shape: 'daemons-1' })
const jobsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'jobs' } as const, [] as Job[], { shape: 'jobs-1' })
const repAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'rep' } as const, { points: 0, streak: 0, lastDay: '' } as Rep, {
  shape: 'rep-1',
})
const modeAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'mode' } as const, '')

const DONE_TOAST_MS = 30_000
const DONE_NOTIFY_MS = 60_000
const SUMMARY_MS = 8_000
const FRAME_MS = 140
const STYLES = ['classic', 'minimal', 'sky', 'aurora', 'cockpit', 'neon', 'cyberpunk']
const ALIASES: Record<string, string> = { powerline: 'classic', cyber: 'cyberpunk' }
const PHASE_SLOT = { read: 1, edit: 2, run: 3, other: 4 } as const

// Module state: a hot reload starts these over (and stops the old timer).
let ticker: Timer | null = null
let polishDir: string | null = null
let turnCommits = 0

/** What the status line script reads from polish/state.json. */
type Hud = {
  lastToolFailed: boolean
  at: number
  running: boolean
  updated: number
  calls: number
  /** per minute: [minute, reads, edits, runs, other, failures], newest last */
  activity: number[][]
  daemons: { name: string; type: string; started: number }[]
  rep: { points: number; level: number; title: string; streak: number } | null
  /** the permission mode, as Claude Code last reported it */
  mode: string
  /** efficiency chips: today's estimated spend, the budget, the nearest limit at this pace */
  today?: typeof meterHud.today
  budget?: typeof meterHud.budget
  pace?: typeof meterHud.pace
}
const hud: Hud = {
  lastToolFailed: false,
  at: 0,
  running: false,
  updated: 0,
  calls: 0,
  activity: [],
  daemons: [],
  rep: null,
  mode: '',
}

function startTicker($: EngineInterface): void {
  if (ticker) return
  ticker = $.clock.every(FRAME_MS, () => {
    void update($, frameAtom, n => (n + 1) % 1_000_000)
  })
}

function stopTicker(): void {
  ticker?.cancel()
  ticker = null
}

async function dirOf($: EngineInterface): Promise<string | null> {
  if (polishDir) return polishDir
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const base = config ?? (home ? `${home}/.claude` : null)
  polishDir = base ? `${base.replace(/[\\/]+$/, '')}/cc-cyberpunk` : null
  return polishDir
}

async function readConfig($: EngineInterface): Promise<Record<string, unknown>> {
  const dir = await dirOf($)
  if (!dir) return {}
  try {
    return JSON.parse(await $.fs.read(`${dir}/config.json`)) as Record<string, unknown>
  } catch {
    return {}
  }
}

type Json = Record<string, unknown>

async function readJsonFile($: EngineInterface, path: string): Promise<Json> {
  try {
    return JSON.parse(await $.fs.read(path)) as Json
  } catch {
    return {}
  }
}

/**
 * /polish install: copies the bundled status line script into the config
 * folder and points Claude Code's status line at it, keeping the previous
 * status line in config.json so /polish uninstall can put it back.
 */
async function installStatusLine($: EngineInterface, dir: string): Promise<string> {
  const script = await $.fs.read(`${$.plugin.root}/statusline/statusline.mjs`)
  await $.fs.write(`${dir}/statusline.mjs`, script)
  const settingsPath = `${dir.replace(/[\\/]cc-cyberpunk$/, '')}/settings.json`
  const settings = await readJsonFile($, settingsPath)
  const config = await readJsonFile($, `${dir}/config.json`)
  const command = `node "${dir.replace(/\\/g, '/')}/statusline.mjs"`
  const current = settings.statusLine as Json | undefined
  if (current?.command !== command && !('previousStatusLine' in config)) config.previousStatusLine = current ?? null
  settings.statusLine = { type: 'command', command, refreshInterval: 30 }
  await $.fs.write(`${dir}/config.json`, `${JSON.stringify({ style: 'cyberpunk', ...config }, null, 2)}\n`)
  await $.fs.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  return 'Status line installed. It appears within a few seconds; pick a style with /polish <style>. /polish uninstall puts your old one back.'
}

async function uninstallStatusLine($: EngineInterface, dir: string): Promise<string> {
  const settingsPath = `${dir.replace(/[\\/]cc-cyberpunk$/, '')}/settings.json`
  const settings = await readJsonFile($, settingsPath)
  const config = await readJsonFile($, `${dir}/config.json`)
  if (config.previousStatusLine) settings.statusLine = config.previousStatusLine
  else delete settings.statusLine
  delete config.previousStatusLine
  await $.fs.write(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  await $.fs.write(`${dir}/config.json`, `${JSON.stringify(config, null, 2)}\n`)
  return 'Status line restored to what you had before.'
}

function styleOf(config: Record<string, unknown>): string {
  if (typeof config.style === 'string' && STYLES.includes(config.style)) return config.style
  return config.mode === 'minimal' ? 'minimal' : 'classic'
}

async function writeHud($: EngineInterface, patch: Partial<Hud>): Promise<void> {
  Object.assign(hud, patch, {
    updated: await $.clock.now(),
    today: meterHud.today,
    budget: meterHud.budget,
    pace: meterHud.pace,
  })
  const dir = await dirOf($)
  if (!dir) return
  await $.fs.write(`${dir}/state.json`, JSON.stringify(hud))
}

/** Counts a finished tool call into its minute, for the NET TRAFFIC strip. */
function bumpActivity(now: number, slot: number, failed: boolean): void {
  const minute = Math.floor(now / 60_000)
  let last = hud.activity[hud.activity.length - 1]
  if (!last || last[0] !== minute) {
    last = [minute, 0, 0, 0, 0, 0]
    hud.activity.push(last)
  }
  last[slot] = (last[slot] ?? 0) + 1
  if (failed) last[5] = (last[5] ?? 0) + 1
  if (hud.activity.length > 120) hud.activity.splice(0, hud.activity.length - 120)
}

function repSummary(rep: Rep): Hud['rep'] {
  const { level, title } = levelOf(rep.points)
  return { points: rep.points, level, title, streak: rep.streak }
}

/**
 * Records the permission mode. No event says the mode changed, but every classic
 * hook event carries `permission_mode`: a prompt, a tool call, a stop.
 */
async function noteMode($: EngineInterface, mode: unknown): Promise<void> {
  if (typeof mode !== 'string' || mode === '') return
  if (mode === (await read($, modeAtom))) return
  await update($, modeAtom, () => mode)
  await writeHud($, { mode })
}

async function syncDaemons($: EngineInterface, change: (list: Daemon[]) => Daemon[]): Promise<void> {
  const now = await $.clock.now()
  // drop any that never reported back within two hours
  const list = await update($, daemonsAtom, l => change(l).filter(d => now - d.started < 2 * 3_600_000))
  await writeHud($, { daemons: list.map(d => ({ name: d.name, type: d.type, started: d.started })) })
}

export const register: Register = on => {
  registerBand(on)
  registerToolRows(on)
  registerPanes(on)
  registerStats(on)
  registerLooks(on)

  // ---------- session ----------
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'overview', description: 'Polish: open the session overview pane' })
    await $.command.register({ name: 'scratch', description: 'Polish: open your scratchpad (saved across sessions)' })
    await $.command.register({
      name: 'efficiency',
      description: 'Polish: efficiency pane (pacing, spend, cache, hogs, slowest tools, activity)',
    })
    await $.command.register({
      name: 'budget',
      description: 'Polish: daily estimated-$ budget and usage-window alerts',
      argumentHint: '$20 | 5h 80% | 7d 90% | off',
    })
    await $.command.register({
      name: 'polish',
      description: 'Polish: status line style',
      argumentHint: 'install | classic | minimal | sky | aurora | cockpit | neon | cyberpunk | next | uninstall',
    })

    const dir = await dirOf($)
    if ((await read($, sinceAtom)) === 0) {
      // a new session
      const now = await $.clock.now()
      await update($, sinceAtom, () => now)
    } else if (dir) {
      // a reload: carry on from what the last load wrote
      try {
        const saved = JSON.parse(await $.fs.read(`${dir}/state.json`)) as Partial<Hud>
        if (typeof saved.calls === 'number') hud.calls = saved.calls
        if (Array.isArray(saved.activity)) hud.activity = saved.activity
      } catch {
        /* nothing saved yet */
      }
    }

    const stored = await $.store.get('notes')
    if (Array.isArray(stored)) {
      await update($, notesAtom, () => stored.filter((n): n is string => typeof n === 'string'))
    }

    const savedRep = (await $.store.get('rep')) as Rep | undefined
    if (savedRep && typeof savedRep.points === 'number') {
      await update($, repAtom, () => savedRep)
      hud.rep = repSummary(savedRep)
    }

    const style = styleOf(await readConfig($))
    await update($, styleAtom, () => style)
    await meterSessionStart($).catch(() => undefined)
    await looksSessionStart($).catch(() => undefined)

    // Open the overview once per session; the engine docks it only on a wide terminal.
    if (!(await read($, autoOpenedAtom))) {
      await update($, autoOpenedAtom, () => true)
      void $.ui.open({ id: OVERVIEW, title: 'Session' }).catch(() => undefined)
    }

    await writeHud($, {}).catch(() => undefined)
    return next(e)
  })

  // ---------- turns ----------
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      const now = await $.clock.now()
      turnCommits = 0
      await update($, turnAtom, () => ({ ...IDLE_TURN, running: true, startedAt: now }))
      await update($, summaryAtom, () => null)
      await update($, hintAtom, () => null)
      startTicker($)
      await meterTurnStart($).catch(() => undefined)
      await writeHud($, { running: true }).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      stopTicker()
      live.tool = ''
      live.label = ''
      await writeHud($, { running: false }).catch(() => undefined)
      const at = await $.clock.now()
      const turn = await update($, turnAtom, t => ({ ...t, running: false }))
      const skin = skinFor(await read($, styleAtom))

      // street rep for a finished job
      let gained = 0
      if (!e.isAborted) {
        gained = repFor({ edits: turn.edits, commands: turn.commands, commits: turnCommits, errors: turn.errors })
        const today = dayKey(at)
        const rep = await update($, repAtom, r => ({
          points: r.points + gained,
          streak: r.lastDay === today ? r.streak : isYesterday(r.lastDay, today) ? r.streak + 1 : 1,
          lastDay: today,
        }))
        await $.store.set('rep', rep)
        await writeHud($, { rep: repSummary(rep) }).catch(() => undefined)
      }
      await meterTurnComplete($, { isAborted: e.isAborted, commits: turnCommits, usage: e.usage }).catch(() => undefined)
      await update($, jobsAtom, list =>
        [...list, { ms: e.durationMs, edits: turn.edits, commands: turn.commands, errors: turn.errors, rep: gained, at }].slice(-100),
      )

      await update($, summaryAtom, () => ({
        ms: e.durationMs,
        calls: turn.calls,
        edits: turn.edits,
        commands: turn.commands,
        errors: turn.errors,
        isAborted: e.isAborted,
        at,
      }))
      $.clock.after(SUMMARY_MS, () => {
        void update($, summaryAtom, current => (current && current.at === at ? null : current))
      })

      if (!e.isAborted && e.durationMs >= DONE_TOAST_MS) {
        const L = skin.labels
        const work =
          `${plural(turn.edits, L.edits)} · ${plural(turn.commands, L.commands)}` +
          `${turn.errors ? ` · ${plural(turn.errors, L.errors)}` : ''}`
        const text = skin.cyber
          ? `▌INCOMING TRANSMISSION▐ job done in ${fmtDuration(e.durationMs)} · ${work} · +${gained} REP`
          : `✓ Done in ${fmtDuration(e.durationMs)} · ${work}`
        $.ui.toast(text, { timeoutMs: 6000 })
        if (e.durationMs >= DONE_NOTIFY_MS) {
          void $.ui.notify(text, { title: 'Claude Code' }).catch(() => undefined)
        }
      }
    }
    return next(e)
  })

  // ---------- tool calls ----------
  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const tool = String(e.tool)
    const isMain = !e.agentId
    const start = await $.clock.now()

    if (id) {
      await update($, memberOf(timeFamily, { requestId: id }), () => ({ start, end: null }))
      if (isMain) {
        const entry = { id, tool, label: labelOf(tool, e), start, end: null, failed: false }
        await update($, logAtom, list => [...list, entry].slice(-200))
      }
    }
    if (isMain) {
      live.tool = tool
      live.label = labelOf(tool, e)
      await update($, turnAtom, t => ({
        ...t,
        running: true,
        startedAt: t.startedAt || start,
        phase: phaseOf(tool),
      }))
      startTicker($)
    }

    const ran = await next(e)

    const end = await $.clock.now()
    const failed = ran.deny !== undefined || ran.isError === true
    if (id) {
      await update($, memberOf(timeFamily, { requestId: id }), v => ({ start: v?.start || start, end }))
      if (isMain) await update($, logAtom, list => list.map(c => (c.id === id ? { ...c, end, failed } : c)))
    }
    if (isMain) {
      const phase = phaseOf(tool)
      const input = e as unknown as Record<string, unknown>
      const edited = phase === 'edit' && !failed && diffStat(tool, e) !== null
      if (phase === 'run' && !failed && typeof input.command === 'string' && /\bgit\s+commit\b/.test(input.command)) {
        turnCommits += 1
      }
      await update($, turnAtom, t => ({
        ...t,
        calls: t.calls + 1,
        edits: t.edits + (edited ? 1 : 0),
        commands: t.commands + (phase === 'run' ? 1 : 0),
        errors: t.errors + (failed ? 1 : 0),
      }))
      if (edited) {
        const path = typeof input.file_path === 'string' ? input.file_path : ''
        if (path) await update($, filesAtom, f => ({ ...f, [path]: (f[path] ?? 0) + 1 }))
        const stat = diffStat(tool, e)
        if (stat) await meterLines($, stat.added + stat.removed).catch(() => undefined)
      }
      await meterToolCall($, { tool, input: e, start, end, text: typeof ran.text === 'string' ? ran.text : '' }).catch(
        () => undefined,
      )
      bumpActivity(end, PHASE_SLOT[phase], failed)
      await writeHud($, { lastToolFailed: failed, at: end, calls: hud.calls + 1 }).catch(() => undefined)
    }
    return ran
  })

  // ---------- daemons: background agents while they run ----------
  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      const started = await $.clock.now()
      const daemon = {
        id: spawned.agentId,
        name: (e.description || e.subagentType || 'agent').slice(0, 40),
        type: e.subagentType,
        started,
      }
      await syncDaemons($, list => [...list.filter(d => d.id !== daemon.id), daemon]).catch(() => undefined)
    }
    return spawned
  })

  on('agent.report', async ($, e, next) => {
    await syncDaemons($, list => list.filter(d => d.id !== e.agentId)).catch(() => undefined)
    return next(e)
  })

  // ---------- the permission mode, from every classic event that carries it ----------
  on('classic.SessionStart', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })
  on('classic.PostToolUse', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })
  on('classic.PostToolUseFailure', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })
  on('classic.PermissionRequest', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })
  on('classic.Stop', async ($, e, next) => {
    await noteMode($, e.permission_mode).catch(() => undefined)
    return next(e)
  })

  // ---------- context ----------
  on('session.measure', async ($, e, next) => {
    await meterMeasure($, e).catch(() => undefined)
    await writeHud($, {}).catch(() => undefined)
    const percent = e.context.percent
    if (typeof percent === 'number') {
      await update($, ctxAtom, () => ({ percent, window: e.context.window }))
      const warned = await read($, warnedAtom)
      if (percent >= 80 && !warned) {
        await update($, warnedAtom, () => true)
        const skin = skinFor(await read($, styleAtom))
        $.ui.toast(
          skin.cyber
            ? `⚠ NEURAL OVERLOAD ${percent}% // compaction imminent. /compact to choose when.`
            : `Context ${percent}% full · compaction soon. Run /compact now to choose when.`,
          { timeoutMs: 8000 },
        )
      } else if (percent < 50 && warned) {
        await update($, warnedAtom, () => false)
      }
    }
    return next(e)
  })

  // ---------- typing hints ----------
  on('prompt.change', async ($, e, next) => {
    const hint = hintFor(e.text)
    if (hint !== (await read($, hintAtom))) await update($, hintAtom, () => hint)
    return next(e)
  })

  // ---------- /polish: status line style ----------
  on('command.run', { command: 'polish' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const dir = await dirOf($)
    if (!dir) return { text: 'Polish: could not find your Claude config folder.' }
    if (arg === 'install') return { text: await installStatusLine($, dir) }
    if (arg === 'uninstall') return { text: await uninstallStatusLine($, dir) }
    const config = await readConfig($)
    const current = styleOf(config)
    const style = arg === 'next' ? STYLES[(STYLES.indexOf(current) + 1) % STYLES.length] : (ALIASES[arg] ?? arg)
    const change: Record<string, string> | null = STYLES.includes(style ?? '')
      ? { style: style ?? 'classic' }
      : arg === 'arrows'
        ? { separator: 'powerline' }
        : arg === 'blocks'
          ? { separator: 'plain' }
          : null
    if (!change) {
      const list = STYLES.map(s => (s === current ? `[${s}]` : s)).join(' · ')
      return {
        text:
          `Status line style: ${list}\n` +
          'Use /polish <style> to switch, /polish next to cycle, or /polish arrows | blocks for classic separators.',
      }
    }
    const { mode: _mode, ...rest } = config
    await $.fs.write(`${dir}/config.json`, `${JSON.stringify({ ...rest, ...change }, null, 2)}\n`)
    if (change.style) await update($, styleAtom, () => change.style ?? 'classic')
    return {
      text: change.style
        ? `Status line style: ${change.style}. It appears within 30 seconds, or right after your next message; the panes, spinner and tool rows follow it now.`
        : `Classic separators set to ${arg}. They appear within 30 seconds, or right after your next message.`,
    }
  })
}
