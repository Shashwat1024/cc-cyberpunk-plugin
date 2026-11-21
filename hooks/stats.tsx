// The Efficiency pane (/stats) and /budget: pacing, spend and cost per result,
// cache savings, context hogs, the slowest tools and the activity heatmap.
// Every section follows the active /polish skin.
import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { BudgetSetting, Ctx, DayBucket, Hog, LagStat, PaceInfo, Spend, StatsView } from '../types'
import {
  cacheSavings,
  clockTime,
  costMetrics,
  fmtTokens,
  fmtUsd,
  HEAT_WEEKS,
  heatCells,
  heatGrid,
  heatLevel,
  monthRow,
  parseBudget,
  topLag,
} from './efficiency'
import { meterHud, meterSetBudget } from './meter'
import { CYBER, dayKey, heatLevels, skinFor } from './skin'
import { fmtDuration } from './track'

export const STATS = 'polish-stats'

const lagAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'lag' } as const, {} as Record<string, LagStat>, { shape: 'lag-1' })
const lagAllAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'lagAll' } as const, {} as Record<string, LagStat>, {
  shape: 'lagall-1',
})
const hogsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'hogs' } as const, [] as Hog[], { shape: 'hogs-1' })
const spendAtom = atom(
  { plugin: 'cc-cyberpunk-plugin', key: 'spend' } as const,
  {
    usd: 0,
    turnStartUsd: 0,
    lastTurnUsd: null,
    turns: 0,
    commits: 0,
    lines: 0,
    activeMin: 0,
    cacheRead: {},
    freshInput: 0,
  } as Spend,
  { shape: 'spend-1' },
)
const paceAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'pace' } as const, [] as PaceInfo[], { shape: 'pace-1' })
const daysAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'days' } as const, {} as Record<string, DayBucket>, { shape: 'days-1' })
const budgetAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'budget' } as const, {} as BudgetSetting, { shape: 'budget-1' })
const viewAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'statsView' } as const, { lag: 'session', heat: 'time' } as StatsView, {
  shape: 'statsview-1',
})
const ctxAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'ctx' } as const, null as Ctx | null)
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')

const windowName = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind)
const money = (n: number | null) => (n === null ? '—' : `≈${fmtUsd(n)}`)

function describeBudget(b: BudgetSetting): string {
  const parts: string[] = []
  if (b.usdPerDay) parts.push(`${fmtUsd(b.usdPerDay)}/day (est.)`)
  if (b.fiveHour) parts.push(`5h at ${b.fiveHour}%`)
  if (b.sevenDay) parts.push(`7d at ${b.sevenDay}%`)
  return parts.length ? parts.join(' · ') : 'none set'
}

export function registerStats(on: On): void {
  on('command.run', { command: 'efficiency' }, async $ => {
    const skin = skinFor(await read($, styleAtom))
    await $.ui.open({ id: STATS, title: skin.labels.efficiency })
    return { text: `${skin.labels.efficiency} opened.` }
  })

  on('command.run', { command: 'budget' }, async ($, e) => {
    const current = await read($, budgetAtom)
    const args = e.args.trim()
    if (!args) {
      return {
        text:
          `Budget: ${describeBudget(current)}. Today so far: ≈${fmtUsd(meterHud.today.usd)} (estimated at API prices).\n` +
          'Set with /budget $20 (daily estimate), /budget 5h 80% or /budget 7d 90% (usage windows), or /budget off.',
      }
    }
    const next = parseBudget(args, current)
    if (next === null) return { text: 'Try /budget $20, /budget 5h 80%, /budget 7d 90% or /budget off.' }
    await meterSetBudget($, next === 'off' ? {} : next)
    return { text: next === 'off' ? 'Budget cleared.' : `Budget: ${describeBudget(next)}. You'll get a toast at 80% and at the limit.` }
  })

  on('ui.render', { component: 'Pane', requestId: STATS }, async ($, e) => {
    const { Box, Text, Progress, Button } = $.ui.resolve(e)
    const [pace, spend, hogs, lag, lagAll, days, budget, view, ctx, style, now] = await Promise.all([
      read($, paceAtom),
      read($, spendAtom),
      read($, hogsAtom),
      read($, lagAtom),
      read($, lagAllAtom),
      read($, daysAtom),
      read($, budgetAtom),
      read($, viewAtom),
      read($, ctxAtom),
      read($, styleAtom),
      $.clock.now(),
    ])
    const skin = skinFor(style)
    const L = skin.labels
    const cyber = skin.cyber
    const dim = cyber ? CYBER.dim : skin.muted
    const title = (s: string) => (
      <Text color={cyber ? CYBER.yellow : skin.accent} bold>
        {cyber ? `▌${s}` : s}
      </Text>
    )
    const muted = (s: string) => <Text color={dim}>{s}</Text>

    // ---- pacing ----
    const pacing = (
      <Box flexDirection="column">
        {title(L.pacing)}
        {pace.length === 0 ? muted('Measured after the next reply.') : null}
        {pace.map(p => {
          const tone = p.percent >= 90 ? skin.bad : p.percent >= 70 ? skin.warn : skin.good
          const reset = p.resetsAt ? `resets ${clockTime(p.resetsAt)}` : ''
          const verdict = p.hitsAt === null ? 'steady' : p.lastsToReset ? 'lasts to reset ✓' : `limit at ~${clockTime(p.hitsAt)}`
          return (
            <Box key={`pace-${p.kind}`} flexDirection="column">
              <Box flexDirection="row">
                <Text color={tone} bold>{`${windowName(p.kind).padEnd(3)} ${String(Math.round(p.percent)).padStart(3)}%  `}</Text>
                <Text color={p.hitsAt !== null && !p.lastsToReset ? skin.bad : skin.good}>{verdict}</Text>
                <Text color={dim}>{reset ? `  ${reset}` : ''}</Text>
              </Box>
              {p.hitsAt !== null && !p.lastsToReset
                ? muted(cyber ? '  // throttle down, or /model sonnet for light jobs' : '  Slow down, or /model sonnet for lighter work.')
                : null}
            </Box>
          )
        })}
      </Box>
    )

    // ---- spend ----
    const today = days[dayKey(now)]?.usd ?? 0
    const metrics = costMetrics({
      usd: spend.usd,
      activeMin: spend.activeMin,
      turns: spend.turns,
      commits: spend.commits,
      linesChanged: spend.lines,
    })
    const spending = (
      <Box flexDirection="column">
        {title(L.spend)}
        <Text>
          <Text bold>{`session ${money(spend.usd)}`}</Text>
          <Text color={dim}>{`  ·  today ${money(today)}`}</Text>
          <Text color={dim}>{spend.lastTurnUsd !== null ? `  ·  last turn ${money(spend.lastTurnUsd)}` : ''}</Text>
        </Text>
        {budget.usdPerDay ? (
          <Progress
            label={cyber ? 'DAILY LIMIT' : 'Daily budget'}
            value={Math.min(today, budget.usdPerDay)}
            max={budget.usdPerDay}
            valueText={`≈${fmtUsd(today)} / ${fmtUsd(budget.usdPerDay)}`}
            color={today >= budget.usdPerDay ? skin.bad : today >= budget.usdPerDay * 0.8 ? skin.warn : skin.good}
          />
        ) : (
          muted('No budget set: /budget $20, /budget 5h 80%')
        )}
        <Text color={dim}>
          {`per turn ${money(metrics.perTurn)} · per active hour ${money(metrics.perHour)} · per commit ${money(metrics.perCommit)} · per 100 lines ${money(metrics.per100Lines)}`}
        </Text>
        {muted('Estimated at API prices; on a subscription this is not a bill.')}
      </Box>
    )

    // ---- cache ----
    const reads = Object.values(spend.cacheRead).reduce((a, b) => a + b, 0)
    const hitRate = reads + spend.freshInput > 0 ? reads / (reads + spend.freshInput) : null
    const saved = cacheSavings(spend.cacheRead)
    const caching = (
      <Box flexDirection="column">
        {title(L.cache)}
        {hitRate === null ? (
          muted('Measured after the next reply.')
        ) : (
          <Text>
            <Text color={hitRate >= 0.8 ? skin.good : hitRate >= 0.5 ? skin.warn : skin.bad} bold>
              {`${Math.round(hitRate * 100)}% hit`}
            </Text>
            <Text color={dim}>{`  ·  ${fmtTokens(reads)} tokens read from cache`}</Text>
            <Text color={skin.good}>{saved.usd !== null ? `  ·  saved ${money(saved.usd)}` : ''}</Text>
          </Text>
        )}
      </Box>
    )

    // ---- context hogs ----
    const window = ctx?.window ?? 0
    const hogging = (
      <Box flexDirection="column">
        {title(L.hogs)}
        {hogs.length === 0 ? muted('No large tool results yet.') : null}
        {hogs.map(hog => (
          <Box key={`hog-${hog.tool}-${hog.label}`} flexDirection="row">
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">
                <Text bold>{`${hog.tool} `}</Text>
                <Text color={dim}>{hog.label}</Text>
                <Text color={skin.warn}>{hog.reads > 1 ? `  +${hog.reads - 1} reread${hog.reads > 2 ? 's' : ''}` : ''}</Text>
              </Text>
            </Box>
            <Text color={hog.tokens >= 20_000 ? skin.bad : hog.tokens >= 8_000 ? skin.warn : undefined} bold>
              {` ~${fmtTokens(hog.tokens)}`}
            </Text>
            <Text color={dim}>{window > 0 ? ` ${((hog.tokens / window) * 100).toFixed(1)}%` : ''}</Text>
          </Box>
        ))}
      </Box>
    )

    // ---- slowest tools ----
    const board = view.lag === 'all' ? lagAll : lag
    const rows = topLag(board, 8)
    const lagging = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {title(L.lag)}
          <Button
            key="lag-session"
            plain
            label={view.lag === 'session' ? '[session]' : 'session'}
            onPress={() => update($, viewAtom, v => ({ ...v, lag: 'session' as const }))}
          />
          <Button
            key="lag-all"
            plain
            label={view.lag === 'all' ? '[all-time]' : 'all-time'}
            onPress={() => update($, viewAtom, v => ({ ...v, lag: 'all' as const }))}
          />
        </Box>
        {rows.length === 0 ? muted('No tool calls yet.') : null}
        {rows.map(([key, s]) => {
          const avg = s.total / Math.max(1, s.n)
          const slow = avg >= 60_000
          return (
            <Box key={`lag-${key}`} flexDirection="row">
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="truncate-end" color={slow ? skin.bad : undefined} bold={slow}>
                  {key}
                </Text>
              </Box>
              <Text color={dim}>{` ${s.n}× · avg `}</Text>
              <Text color={slow ? skin.bad : avg >= 10_000 ? skin.warn : undefined}>{fmtDuration(avg)}</Text>
              <Text color={dim}>{' · '}</Text>
              <Text bold>{fmtDuration(s.total)}</Text>
              <Text color={dim}>{` · max ${fmtDuration(s.max)}`}</Text>
            </Box>
          )
        })}
      </Box>
    )

    // ---- activity heatmap ----
    const heat = heatGrid(days, view.heat, now)
    const levels = heatLevels(skin)
    const metricButton = (m: StatsView['heat'], label: string) => (
      <Button
        key={`heat-${m}`}
        plain
        label={view.heat === m ? `[${label}]` : label}
        onPress={() => update($, viewAtom, v => ({ ...v, heat: m }))}
      />
    )
    const activeDays = Object.values(days).filter(d => d.active > 0).length
    let heatBody
    if (e.surface === 'terminal') {
      // one Raster: a grid of coloured cells, never a Box per cell
      const { Raster } = $.ui.resolve({ ...e, surface: 'terminal' as const })
      const raster = heatCells(heat, levels)
      heatBody = <Raster key="heat" columns={raster.columns} rows={raster.rows} cells={raster.cells} />
    } else {
      heatBody = (
        <Box flexDirection="column">
          {Array.from({ length: 7 }, (_, r) => (
            <Box key={`heat-row-${r}`} flexDirection="row">
              {heat.grid.map((week, w) => {
                const v = week[r]
                return (
                  <Text backgroundColor={v === null || v === undefined ? undefined : levels[heatLevel(v, heat.max)]}>
                    {w < HEAT_WEEKS - 1 ? '   ' : '  '}
                  </Text>
                )
              })}
            </Box>
          ))}
        </Box>
      )
    }
    const activity = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {title(L.activity)}
          {metricButton('time', 'time')}
          {metricButton('jobs', 'jobs')}
          {metricButton('cost', 'cost')}
        </Box>
        <Text color={dim}>{`  ${monthRow(heat.dates, 3)}`}</Text>
        <Box flexDirection="row">
          <Box flexDirection="column" width={2}>
            {['M', ' ', 'W', ' ', 'F', ' ', ' '].map(l => (
              <Text color={dim}>{l}</Text>
            ))}
          </Box>
          {heatBody}
        </Box>
        <Box flexDirection="row">
          <Text color={dim}>{'  less '}</Text>
          {levels.map(c => (
            <Text backgroundColor={c}>{'  '}</Text>
          ))}
          <Text color={dim}>{` more   ${activeDays} active day${activeDays === 1 ? '' : 's'} in ${HEAT_WEEKS} weeks`}</Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {cyber ? (
          <Text backgroundColor={CYBER.yellow} color={CYBER.ink} bold>
            {` ${L.efficiency} // ${fmtDuration(spend.activeMin * 60_000)} ACTIVE `}
          </Text>
        ) : null}
        {pacing}
        {spending}
        {caching}
        {hogging}
        {lagging}
        {activity}
      </Box>
    )
  })
}
