// Tool call rows: a mark before the row, chips after it (duration, +/−, exit code).
// Emoji icons by default; under the cyberpunk skin, neon ops-log tags and [OK]/[FAIL].
import { atom, memberOf, read } from 'claude-code'
import type { On } from 'claude-code'

import type { CallTime } from '../types'
import { CYBER, CYBER_PHASE, skinFor, tagOf } from './skin'
import { diffStat, durationTone, exitOf, fmtDuration, iconOf, phaseOf } from './track'

const timeFamily = atom({ plugin: 'cc-cyberpunk-plugin', key: 'time' } as const, { start: 0, end: null } as CallTime)
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')

export function registerToolRows(on: On): void {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    // ctrl+o (expanded transcript) shows the engine's row untouched
    if (e.props.isExpanded) return row

    const { Box, Text } = $.ui.resolve(e)
    const skin = skinFor(await read($, styleAtom))
    const tool = String(e.props.tool)
    const time = await read($, memberOf(timeFamily, e))
    const stat = diffStat(tool, e.props.input)
    const failed = e.props.isErrored && !e.props.isInterrupted
    const exit = failed ? exitOf(e.props.output) : null

    const ms = !e.props.isRunning && time.start > 0 && time.end !== null ? time.end - time.start : null
    const tone = ms !== null ? durationTone(ms) : 'dim'
    const showStat = stat !== null && !failed && (stat.added > 0 || stat.removed > 0)
    const done = !e.props.isRunning && !failed && !e.props.isInterrupted
    const hasChips = e.props.isRunning || ms !== null || showStat || failed || (skin.cyber && done)
    const added = skin.cyber ? CYBER.green : 'diffAdded'
    const removed = skin.cyber ? CYBER.pink : 'diffRemoved'

    return (
      <Box flexDirection="row">
        {failed ? <Text color={skin.cyber ? CYBER.red : 'error'}>▌</Text> : null}
        {skin.cyber ? (
          <Text color={CYBER_PHASE[phaseOf(tool)]} bold>
            {tagOf(tool).padEnd(6)}
          </Text>
        ) : (
          <Text>{iconOf(tool)} </Text>
        )}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {row}
        </Box>
        {hasChips ? (
          <Box flexDirection="row" flexShrink={0} marginLeft={1} gap={1}>
            {e.props.isRunning ? <Text color={skin.cyber ? CYBER.yellow : undefined} dimColor={!skin.cyber}>{skin.cyber ? '[RUN]' : '…'}</Text> : null}
            {ms !== null ? (
              <Text color={tone === 'dim' ? (skin.cyber ? CYBER.dim : undefined) : tone} dimColor={tone === 'dim' && !skin.cyber}>
                {fmtDuration(ms)}
              </Text>
            ) : null}
            {showStat && stat ? (
              <Text>
                <Text color={added}>+{stat.added}</Text>
                {stat.removed > 0 ? <Text color={removed}> −{stat.removed}</Text> : null}
              </Text>
            ) : null}
            {failed ? (
              <Text color={skin.cyber ? CYBER.red : 'error'} bold>
                {skin.cyber ? `[FAIL]${exit !== null ? ` exit ${exit}` : ''}` : `✗ ${exit !== null ? `exit ${exit}` : 'failed'}`}
              </Text>
            ) : null}
            {skin.cyber && done ? (
              <Text color={CYBER.green} bold>
                [OK]
              </Text>
            ) : null}
          </Box>
        ) : null}
      </Box>
    )
  })
}
