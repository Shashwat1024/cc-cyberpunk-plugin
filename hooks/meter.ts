// Efficiency metering: the slowest-tools leaderboard, context hogs, spend and
// cache, rate-limit pacing, the budget's alerts and the daily activity buckets.
// register.tsx calls these from its existing hooks; stats.tsx draws the result.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BudgetSetting, DayBucket, Hog, LagStat, PaceInfo, Spend } from '../types'
import { addLag, clockTime, commandKey, estTokens, fmtTokens, fmtUsd, mergeLag, paceForecast } from './efficiency'
import { dayKey, skinFor } from './skin'
import { labelOf } from './track'

const lagAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'lag' } as const, {} as Record<string, LagStat>, { shape: 'lag-1' })
const lagAllAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'lagAll' } as const, {} as Record<string, LagStat>, {
  shape: 'lagall-1',
})
const hogsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'hogs' } as const, [] as Hog[], { shape: 'hogs-1' })
const EMPTY_SPEND: Spend = {
  usd: 0,
  turnStartUsd: 0,
  lastTurnUsd: null,
  turns: 0,
  commits: 0,
  lines: 0,
  activeMin: 0,
  cacheRead: {},
  freshInput: 0,
}
const spendAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'spend' } as const, EMPTY_SPEND, { shape: 'spend-1' })
const paceAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'pace' } as const, [] as PaceInfo[], { shape: 'pace-1' })
const daysAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'days' } as const, {} as Record<string, DayBucket>, { shape: 'days-1' })
const budgetAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'budget' } as const, {} as BudgetSetting, { shape: 'budget-1' })
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')

/** A single result this large gets a toast. */
export const HOG_TOAST_TOKENS = 20_000
const HOG_MIN_TOKENS = 500
const KEEP_DAYS = 120
const PACE_WARN_MS = 45 * 60_000

type Alerts = { day: string; usd80: boolean; usd100: boolean; windows: Record<string, number>; pace: Record<string, number> }

// Module state: a hot reload starts these over; the alerts are reloaded from the store.
let lastActiveMinute = -1
let alerts: Alerts = { day: '', usd80: false, usd100: false, windows: {}, pace: {} }
const samples: Record<string, [number, number][]> = {}
const toastedHogs = new Set<string>()

/** What the status line reads from state.json for its efficiency chips. */
export const meterHud: {
  today: { usd: number }
  budget: BudgetSetting
  pace: { kind: string; hitsAt: number; resetsAt: number | null } | null
} = { today: { usd: 0 }, budget: {}, pace: null }

const blankDay = (): DayBucket => ({ active: 0, jobs: 0, usd: 0, calls: 0 })

async function changeToday($: EngineInterface, change: (day: DayBucket) => DayBucket): Promise<void> {
  const key = dayKey(await $.clock.now())
  const days = await update($, daysAtom, all => {
    const next = { ...all, [key]: change(all[key] ?? blankDay()) }
    const keys = Object.keys(next).sort()
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete next[old]
    return next
  })
  meterHud.today = { usd: days[key]?.usd ?? 0 }
  await $.store.set('days', days)
}

async function saveAlerts($: EngineInterface): Promise<void> {
  await $.store.set('alerts', alerts)
}

/** Loads what earlier sessions kept: days, the all-time leaderboard, the budget, fired alerts. */
export async function meterSessionStart($: EngineInterface): Promise<void> {
  const days = (await $.store.get('days')) as Record<string, DayBucket> | undefined
  if (days && typeof days === 'object') await update($, daysAtom, () => days)
  const lagboard = (await $.store.get('lagboard')) as Record<string, LagStat> | undefined
  if (lagboard && typeof lagboard === 'object') await update($, lagAllAtom, () => lagboard)
  const budget = (await $.store.get('budget')) as BudgetSetting | undefined
  if (budget && typeof budget === 'object') {
    await update($, budgetAtom, () => budget)
    meterHud.budget = budget
  }
  const saved = (await $.store.get('alerts')) as Alerts | undefined
  if (saved && typeof saved === 'object') alerts = { ...alerts, ...saved }
  meterHud.today = { usd: (await read($, daysAtom))[dayKey(await $.clock.now())]?.usd ?? 0 }
}

/** One finished main-loop tool call: its time, its context weight, the active minute. */
export async function meterToolCall(
  $: EngineInterface,
  call: { tool: string; input: unknown; start: number; end: number; text: string },
): Promise<void> {
  const key = commandKey(call.tool, call.input)
  const ms = Math.max(0, call.end - call.start)
  await update($, lagAtom, board => addLag(board, key, ms))
  await update($, lagAllAtom, board => addLag(board, key, ms))

  const tokens = estTokens(call.text)
  if (tokens >= HOG_MIN_TOKENS) {
    const label = (labelOf(call.tool, call.input) || call.tool).slice(0, 60)
    await update($, hogsAtom, list => {
      const same = list.find(h => h.tool === call.tool && h.label === label)
      const next = same
        ? list.map(h => (h === same ? { ...h, tokens: Math.max(h.tokens, tokens), reads: h.reads + 1, at: call.end } : h))
        : [...list, { label, tool: call.tool, tokens, reads: 1, at: call.end }]
      return next.sort((a, b) => b.tokens - a.tokens).slice(0, 8)
    })
    const id = `${call.tool}:${label}`
    if (tokens >= HOG_TOAST_TOKENS && !toastedHogs.has(id)) {
      toastedHogs.add(id)
      const skin = skinFor(await read($, styleAtom))
      $.ui.toast(
        skin.cyber
          ? `⚠ MEMORY HOG // ${call.tool} ${label} ate ~${fmtTokens(tokens)} tokens of context`
          : `${call.tool} ${label} used ~${fmtTokens(tokens)} tokens of context`,
        { timeoutMs: 7000 },
      )
    }
  }

  const minute = Math.floor(call.end / 60_000)
  const fresh = minute !== lastActiveMinute
  lastActiveMinute = minute
  if (fresh) await update($, spendAtom, s => ({ ...s, activeMin: s.activeMin + 1 }))
  await changeToday($, d => ({ ...d, calls: d.calls + 1, active: d.active + (fresh ? 1 : 0) }))
}

/** Lines an edit changed, for cost per 100 lines. */
export async function meterLines($: EngineInterface, lines: number): Promise<void> {
  if (lines > 0) await update($, spendAtom, s => ({ ...s, lines: s.lines + lines }))
}

export async function meterTurnStart($: EngineInterface): Promise<void> {
  await update($, spendAtom, s => ({
    ...s,
    lastTurnUsd: s.turns > 0 ? Math.max(0, s.usd - s.turnStartUsd) : s.lastTurnUsd,
    turnStartUsd: s.usd,
  }))
}

type TurnUsageLike = {
  model?: string
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export async function meterTurnComplete(
  $: EngineInterface,
  turn: { isAborted: boolean; commits: number; usage: TurnUsageLike | undefined },
): Promise<void> {
  const u = turn.usage
  await update($, spendAtom, s => {
    const cacheRead = { ...s.cacheRead }
    if (u?.model && (u.cache_read_input_tokens ?? 0) > 0) {
      cacheRead[u.model] = (cacheRead[u.model] ?? 0) + (u.cache_read_input_tokens ?? 0)
    }
    return {
      ...s,
      turns: s.turns + (turn.isAborted ? 0 : 1),
      commits: s.commits + turn.commits,
      cacheRead,
      freshInput: s.freshInput + (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0),
    }
  })
  if (!turn.isAborted) await changeToday($, d => ({ ...d, jobs: d.jobs + 1 }))
  await $.store.set('lagboard', mergeLag({}, await read($, lagAllAtom)))
}

type MeasureLike = {
  cost?: { usd: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
}

/** Each measurement: spend into today's bucket, pacing per window, and the budget's alerts. */
export async function meterMeasure($: EngineInterface, m: MeasureLike): Promise<void> {
  const now = await $.clock.now()
  const today = dayKey(now)
  const skin = skinFor(await read($, styleAtom))
  const budget = await read($, budgetAtom)
  if (alerts.day !== today) alerts = { ...alerts, day: today, usd80: false, usd100: false }
  let alertsChanged = false

  // spend
  if (m.cost && typeof m.cost.usd === 'number') {
    const usd = m.cost.usd
    const prev = (await read($, spendAtom)).usd
    const delta = usd >= prev ? usd - prev : usd
    if (delta > 0) {
      await update($, spendAtom, s => ({ ...s, usd }))
      await changeToday($, d => ({ ...d, usd: d.usd + delta }))
    }
  }

  // the daily $ budget
  const spentToday = meterHud.today.usd
  if (budget.usdPerDay) {
    if (spentToday >= budget.usdPerDay && !alerts.usd100) {
      alerts.usd100 = true
      alerts.usd80 = true
      alertsChanged = true
      const text = skin.cyber
        ? `⚠ CREDIT LIMIT // ≈${fmtUsd(spentToday)} of ${fmtUsd(budget.usdPerDay)} today (est.)`
        : `Daily budget reached: ≈${fmtUsd(spentToday)} of ${fmtUsd(budget.usdPerDay)} today (estimated at API prices)`
      $.ui.toast(text, { timeoutMs: 9000 })
      void $.ui.notify(text, { title: 'Claude Code budget' }).catch(() => undefined)
    } else if (spentToday >= budget.usdPerDay * 0.8 && !alerts.usd80) {
      alerts.usd80 = true
      alertsChanged = true
      $.ui.toast(
        skin.cyber
          ? `CREDITS 80% // ≈${fmtUsd(spentToday)} of ${fmtUsd(budget.usdPerDay)} today (est.)`
          : `80% of today's budget: ≈${fmtUsd(spentToday)} of ${fmtUsd(budget.usdPerDay)} (estimated)`,
        { timeoutMs: 7000 },
      )
    }
  }

  // pacing per window, and the window thresholds
  const paces: PaceInfo[] = []
  for (const rl of m.rateLimits) {
    const list = (samples[rl.kind] ??= [])
    const last = list[list.length - 1]
    if (!last || last[1] !== rl.percentUsed || now - last[0] > 60_000) list.push([now, rl.percentUsed])
    if (list.length > 180) list.splice(0, list.length - 180)
    const parsed = rl.resetsAt ? Date.parse(rl.resetsAt) : NaN
    const resetsAt = Number.isFinite(parsed) ? parsed : null
    const forecast = paceForecast(list, now, resetsAt)
    paces.push({ kind: rl.kind, percent: rl.percentUsed, resetsAt, hitsAt: forecast.hitsAt, lastsToReset: forecast.lastsToReset })

    const name = rl.kind === 'five_hour' ? '5h' : rl.kind === 'seven_day' ? '7d' : rl.kind
    const windowKey = resetsAt ?? 1
    if (forecast.hitsAt !== null && !forecast.lastsToReset && forecast.hitsAt - now < PACE_WARN_MS && alerts.pace[rl.kind] !== windowKey) {
      alerts.pace[rl.kind] = windowKey
      alertsChanged = true
      $.ui.toast(
        skin.cyber
          ? `⚠ ICE CLOSING IN // ${name} limit at ~${clockTime(forecast.hitsAt)} at this pace. Slow down or /model sonnet.`
          : `At this pace you'll hit the ${name} limit at ~${clockTime(forecast.hitsAt)}. Slow down, or /model sonnet for lighter work.`,
        { timeoutMs: 10_000 },
      )
    }
    const threshold = rl.kind === 'five_hour' ? budget.fiveHour : rl.kind === 'seven_day' ? budget.sevenDay : undefined
    if (threshold && rl.percentUsed >= threshold && alerts.windows[rl.kind] !== windowKey) {
      alerts.windows[rl.kind] = windowKey
      alertsChanged = true
      const reset = resetsAt ? ` (resets ${clockTime(resetsAt)})` : ''
      const text = skin.cyber
        ? `⚠ BANDWIDTH ${name} at ${rl.percentUsed}% // threshold ${threshold}%${reset}`
        : `${name} usage at ${rl.percentUsed}%, past your ${threshold}% threshold${reset}`
      $.ui.toast(text, { timeoutMs: 9000 })
      void $.ui.notify(text, { title: 'Claude Code usage' }).catch(() => undefined)
    }
  }
  if (paces.length > 0) await update($, paceAtom, () => paces)
  const worst = paces
    .filter(p => p.hitsAt !== null && !p.lastsToReset)
    .sort((a, b) => (a.hitsAt ?? 0) - (b.hitsAt ?? 0))[0]
  meterHud.pace = worst && worst.hitsAt !== null ? { kind: worst.kind, hitsAt: worst.hitsAt, resetsAt: worst.resetsAt } : null
  meterHud.budget = budget
  if (alertsChanged) await saveAlerts($)
}

/** Sets the budget from /budget's parsed arguments, or clears it. */
export async function meterSetBudget($: EngineInterface, next: BudgetSetting): Promise<void> {
  await update($, budgetAtom, () => next)
  meterHud.budget = next
  alerts = { ...alerts, usd80: false, usd100: false, windows: {} }
  await $.store.set('budget', next)
  await saveAlerts($)
}
