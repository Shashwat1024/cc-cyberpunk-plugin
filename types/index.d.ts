// State contract for cc-cyberpunk-plugin: every $.state value the mod keeps.

export type Phase = 'read' | 'edit' | 'run' | 'other'

/** The main loop's current (or last) turn. */
export type TurnInfo = {
  running: boolean
  startedAt: number
  phase: Phase
  calls: number
  edits: number
  commands: number
  errors: number
}

/** The recap shown in the band for a few seconds after a turn. */
export type Summary = {
  ms: number
  calls: number
  edits: number
  commands: number
  errors: number
  isAborted: boolean
  at: number
}

/** When one tool call started and ended, keyed by its tool_use_id. */
export type CallTime = { start: number; end: number | null }

/** One main-loop tool call, for the overview pane's timeline. */
export type LogEntry = {
  id: string
  tool: string
  label: string
  start: number
  end: number | null
  failed: boolean
}

export type Ctx = { percent: number; window: number }

/** A background agent while it runs. */
export type Daemon = { id: string; name: string; type: string; started: number }

/** One finished turn, for the job card under it. */
export type Job = { ms: number; edits: number; commands: number; errors: number; rep: number; at: number }

/** Street rep, kept across sessions. */
export type Rep = { points: number; streak: number; lastDay: string }

/** One leaderboard row: how many calls, their total and longest time in ms. */
export type LagStat = { n: number; total: number; max: number }

/** One day of work, kept across sessions for the heatmap and the daily budget. */
export type DayBucket = { active: number; jobs: number; usd: number; calls: number }

/** A tool result that took a lot of context. */
export type Hog = { label: string; tool: string; tokens: number; reads: number; at: number }

/** This session's spending and output, for cost per result. */
export type Spend = {
  /** the session's cost as last measured, estimated at API prices */
  usd: number
  /** the cost when the current turn started, and the last finished turn's cost */
  turnStartUsd: number
  lastTurnUsd: number | null
  turns: number
  commits: number
  lines: number
  activeMin: number
  /** cache reads by model, and other input tokens, for the hit rate and savings */
  cacheRead: Record<string, number>
  freshInput: number
}

/** A usage window's pace: its fill, and when the recent pace would fill it. */
export type PaceInfo = {
  kind: string
  percent: number
  resetsAt: number | null
  hitsAt: number | null
  lastsToReset: boolean
}

export type BudgetSetting = { usdPerDay?: number; fiveHour?: number; sevenDay?: number }

export type StatsView = { lag: 'session' | 'all'; heat: 'time' | 'jobs' | 'cost' }

declare module 'claude-code' {
  interface PluginState {
    'cc-cyberpunk-plugin': {
      turn: Shaped<TurnInfo>
      summary: Shaped<Summary | null>
      frame: number
      hint: string | null
      time: StateFamily<CallTime>
      log: Shaped<LogEntry[]>
      files: Shaped<Record<string, number>>
      ctx: Ctx | null
      warned: boolean
      since: number
      autoOpened: boolean
      notes: string[]
      draft: string
      style: string
      mode: string
      lag: Shaped<Record<string, LagStat>>
      lagAll: Shaped<Record<string, LagStat>>
      hogs: Shaped<Hog[]>
      spend: Shaped<Spend>
      pace: Shaped<PaceInfo[]>
      days: Shaped<Record<string, DayBucket>>
      budget: Shaped<BudgetSetting>
      statsView: Shaped<StatsView>
      daemons: Shaped<Daemon[]>
      jobs: Shaped<Job[]>
      rep: Shaped<Rep>
    }
  }
}
