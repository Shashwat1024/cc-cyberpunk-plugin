// The band above the prompt, the working line under the spinner, the mode tag
// on the hint line and the card that closes a turn. All follow the skin.
import { atom, read } from 'claude-code'
import type { On } from 'claude-code'

import type { Job, Rep, Summary } from '../types'
import { CYBER, CYBER_PHASE, levelOf, modeTag, modeVerb, skinFor, verbOf } from './skin'
import { fmtDuration, IDLE_TURN, live, mixHex, PHASE_COLOR, PHASE_LABEL, plural, pulseCells } from './track'

const turnAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'turn' } as const, IDLE_TURN, { shape: 'turn-1' })
const summaryAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'summary' } as const, null as Summary | null, {
  shape: 'summary-1',
})
const frameAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'frame' } as const, 0)
const hintAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'hint' } as const, null as string | null)
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')
const modeAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'mode' } as const, '')
const jobsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'jobs' } as const, [] as Job[], { shape: 'jobs-1' })
const repAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'rep' } as const, { points: 0, streak: 0, lastDay: '' } as Rep, {
  shape: 'rep-1',
})

// The chat column's width, as the band last measured it (its body plus the
// engine's five cells for `[-]`). The spinner's own props don't carry it, and
// beside a docked pane the column is narrower than the terminal.
let chatColumns = 0

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function registerBand(on: On): void {
  // ---------- the band: typing tip, then the recap of the last turn ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    chatColumns = e.props.bodyColumns + 5
    if (e.props.hasSurvey || e.props.isCollapsed) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const skin = skinFor(await read($, styleAtom))

    const hint = await read($, hintAtom)
    if (hint) {
      return (
        <Box>
          <Text color={skin.cyber ? CYBER.yellow : 'suggestion'} bold={skin.cyber}>
            {skin.cyber ? 'SYS › ' : '› '}
          </Text>
          <Text color={skin.cyber ? CYBER.cyan : undefined} dimColor={!skin.cyber} wrap="truncate-end">
            {hint}
          </Text>
        </Box>
      )
    }

    // while Claude works the pulse runs under the spinner, which can't be collapsed
    if (e.props.isWorking) return next(e)

    const summary = await read($, summaryAtom)
    if (summary) {
      const L = skin.labels
      const mark = summary.isAborted ? '⏸' : summary.errors > 0 ? '✗' : '✓'
      const tone = summary.isAborted ? skin.warn : summary.errors > 0 ? skin.bad : skin.good
      return (
        <Box>
          <Text color={tone} bold>
            {skin.cyber ? (summary.isAborted ? '◣ JOB ABORTED ' : '◢ JOB COMPLETE ') : `${mark} `}
          </Text>
          <Text color={skin.cyber ? CYBER.yellow : undefined} bold>
            {skin.cyber ? `// ${fmtDuration(summary.ms)}` : fmtDuration(summary.ms)}
          </Text>
          <Text color={skin.cyber ? skin.muted : undefined} dimColor={!skin.cyber}>
            {skin.cyber ? ' // ' : ' · '}
            {plural(summary.edits, L.edits)}
            {skin.cyber ? ' // ' : ' · '}
            {plural(summary.commands, L.commands)}
            {skin.cyber ? ' // ' : ' · '}
          </Text>
          <Text color={summary.errors > 0 ? skin.bad : skin.cyber ? skin.muted : undefined} dimColor={!skin.cyber && summary.errors === 0}>
            {plural(summary.errors, L.errors)}
          </Text>
          {summary.isAborted && !skin.cyber ? <Text dimColor> · interrupted</Text> : null}
        </Box>
      )
    }

    return next(e)
  })

  // ---------- the working line, under Claude Code's spinner ----------
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)

    const skin = skinFor(await read($, styleAtom))
    const mode = e.props.mode
    const isTool = mode === 'tool-use' || mode === 'tool-input'

    // cyberpunk: the spinner's word says what the job is doing, in hacker terms
    const word = skin.cyber
      ? isTool && live.tool
        ? short(`${verbOf(live.tool)} ${live.label}`.trim(), 48)
        : modeVerb(mode)
      : null
    const spinner = await next(word ? { ...e, props: { ...e.props, word } } : e)

    const { Box, Text } = $.ui.resolve(e)
    const turn = await read($, turnAtom)
    const frame = await read($, frameAtom)
    const phase = isTool ? turn.phase : null
    const color = skin.cyber
      ? phase
        ? CYBER_PHASE[phase]
        : mode === 'thinking'
          ? CYBER.violet
          : CYBER.yellow
      : phase
        ? PHASE_COLOR[phase]
        : mode === 'thinking'
          ? '#e879f9'
          : mode === 'responding'
            ? '#f1f5f9'
            : '#94a3b8'
    const what = phase ? PHASE_LABEL[phase] : mode === 'thinking' ? 'thinking' : mode === 'responding' ? 'writing' : 'waiting'
    const label = skin.cyber
      ? ` ${what.toUpperCase()}${turn.calls ? ` // OPS ${turn.calls}` : ''}`
      : ` ${what}${turn.calls ? ` · ${plural(turn.calls, 'call')}` : ''}`
    // the full chat column, less the 2-cell indent and a cell of slack
    const column = chatColumns > 0 ? Math.min(chatColumns, e.viewport?.columns ?? chatColumns) : (e.viewport?.columns ?? 80)
    const bar = Math.max(6, column - 3 - label.length)
    const [before, lit, after] = pulseCells(bar, frame)
    const track = mixHex(color, '#000000', skin.cyber ? 0.7 : 0.6)
    const head = mixHex(color, '#ffffff', 0.5)

    // a comet (every skin; cyberpunk keeps its neon colours and HUD label): a dark track, a tail that brightens towards a near-white head
    const tail = Array.from({ length: Math.max(0, lit - 1) }, (_, k) => mixHex(track, color, (k + 1) / lit))
    return (
      <Box flexDirection="column">
        {spinner}
        <Box paddingLeft={2}>
          <Text color={track}>{'─'.repeat(before)}</Text>
          {tail.map(c => (
            <Text color={c} bold>
              ━
            </Text>
          ))}
          {lit > 0 ? (
            <Text color={head} bold>
              ━
            </Text>
          ) : null}
          <Text color={track}>{'─'.repeat(after)}</Text>
          <Text color={color} bold>
            {label}
          </Text>
        </Box>
      </Box>
    )
  })

  // ---------- cyberpunk: a mode tag on the hint line under the prompt ----------
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const skin = skinFor(await read($, styleAtom))
    if (!skin.cyber || e.surface !== 'terminal') return next(e)
    const line = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const { tag, subtitle } = modeTag(await read($, modeAtom), e.props.hint)
    return (
      <Box flexDirection="row">
        <Text backgroundColor={CYBER.yellow} color={CYBER.ink} bold>
          {` MODE//${tag} `}
        </Text>
        <Text color={CYBER.pink}>{` ${subtitle} `}</Text>
        <Box flexGrow={1} flexShrink={1}>
          {line}
        </Box>
      </Box>
    )
  })

  // ---------- cyberpunk: the line that closes a turn becomes a job card ----------
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const skin = skinFor(await read($, styleAtom))
    if (!skin.cyber || e.props.isExpanded || e.props.waitingFor) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const jobs = await read($, jobsAtom)
    const rep = await read($, repAtom)
    const job = [...jobs].reverse().find(j => Math.abs(j.ms - e.props.durationMs) < 1500)
    const { level, title } = levelOf(rep.points)
    return (
      <Box flexDirection="row">
        <Text color={CYBER.green} bold>
          ◢ JOB COMPLETE
        </Text>
        <Text color={CYBER.dim}> // </Text>
        <Text color={CYBER.yellow} bold>
          {fmtDuration(e.props.durationMs)}
        </Text>
        {job ? (
          <Text color={CYBER.dim}>
            {` // ${plural(job.edits, 'rewrite')} // ${plural(job.commands, 'exec')} // `}
          </Text>
        ) : null}
        {job ? (
          <Text color={job.errors > 0 ? CYBER.red : CYBER.dim}>{plural(job.errors, 'breach', )}</Text>
        ) : null}
        {job && job.rep > 0 ? (
          <Text color={CYBER.pink} bold>
            {`  +${job.rep} REP`}
          </Text>
        ) : null}
        <Text color={CYBER.dim}>{`  LV${level} ${title.toUpperCase()}`}</Text>
      </Box>
    )
  })
}
