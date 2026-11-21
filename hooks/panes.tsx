// Side panes: the session overview (/overview) and a persistent scratchpad
// (/scratch). Both follow the skin of the active /polish style; under the
// cyberpunk skin the overview is a cyberdeck and the notes are data shards.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Ctx, Daemon, LogEntry, Rep } from '../types'
import { CYBER, CYBER_PHASE, hexId, levelOf, SIGIL_ART, skinFor, tagOf } from './skin'
import { durationTone, fmtDuration, iconOf, OVERVIEW, phaseOf, plural, SCRATCH } from './track'

const logAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'log' } as const, [] as LogEntry[], { shape: 'log-1' })
const filesAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'files' } as const, {} as Record<string, number>, {
  shape: 'files-1',
})
const ctxAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'ctx' } as const, null as Ctx | null)
const sinceAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'since' } as const, 0)
const notesAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'notes' } as const, [] as string[])
const draftAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'draft' } as const, '')
const styleAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'style' } as const, 'classic')
const daemonsAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'daemons' } as const, [] as Daemon[], { shape: 'daemons-1' })
const repAtom = atom({ plugin: 'cc-cyberpunk-plugin', key: 'rep' } as const, { points: 0, streak: 0, lastDay: '' } as Rep, {
  shape: 'rep-1',
})

const NOTES_KEY = 'notes'
/** The sigil's colour beside the cyberdeck header: the neon yellow, dulled into the background. */
const SIGIL_DIM = '#4a4512'

async function saveNotes($: EngineInterface, change: (notes: string[]) => string[]): Promise<void> {
  const notes = await update($, notesAtom, change)
  await $.store.set(NOTES_KEY, notes)
}

function elapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

/** A braille skyline: one bar per value, filled from the bottom, two per cell. */
function skyline(values: number[], cells: number): string {
  const v = values.slice(-cells * 2)
  while (v.length < cells * 2) v.unshift(0)
  const hi = Math.max(1, ...v)
  const left = [0x40, 0x04, 0x02, 0x01]
  const right = [0x80, 0x20, 0x10, 0x08]
  let out = ''
  for (let c = 0; c < cells; c++) {
    let bits = 0
    const h = (x: number) => (x <= 0 ? 0 : Math.max(1, Math.round((x / hi) * 4)))
    for (let k = 0; k < h(v[c * 2] ?? 0); k++) bits |= left[k] ?? 0
    for (let k = 0; k < h(v[c * 2 + 1] ?? 0); k++) bits |= right[k] ?? 0
    out += String.fromCodePoint(0x2800 + bits)
  }
  return out
}

export function registerPanes(on: On): void {
  on('command.run', { command: 'overview' }, async $ => {
    await $.ui.open({ id: OVERVIEW, title: 'Session' })
    return { text: 'Session overview opened.' }
  })

  on('command.run', { command: 'scratch' }, async $ => {
    await $.ui.open({ id: SCRATCH, title: 'Scratchpad' })
    return { text: 'Scratchpad opened.' }
  })

  // ---------- Session overview ----------
  on('ui.render', { component: 'Pane', requestId: OVERVIEW }, async ($, e) => {
    const { Box, Text, Progress } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const [model, ctx, log, files, since, now, style, daemons, rep] = await Promise.all([
      $.session.model(),
      read($, ctxAtom),
      read($, logAtom),
      read($, filesAtom),
      read($, sinceAtom),
      $.clock.now(),
      read($, styleAtom),
      read($, daemonsAtom),
      read($, repAtom),
    ])
    const skin = skinFor(style)
    const L = skin.labels
    const cyber = skin.cyber

    const failures = log.filter(c => c.failed).length
    const edits = log.filter(c => !c.failed && phaseOf(c.tool) === 'edit').length
    const commands = log.filter(c => phaseOf(c.tool) === 'run').length
    const room = Math.max(3, (e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 24) - (cyber ? 20 : 14) - daemons.length)
    const recent = log.slice(-room).reverse()
    const topFiles = Object.entries(files)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
    const most = topFiles[0]?.[1] ?? 1
    const nameWidth = Math.max(8, Math.min(28, width - 12))
    const load = (p: number) => (p >= 80 ? skin.bad : p >= 60 ? skin.warn : cyber ? CYBER.pink : skin.good)
    const title = (s: string) =>
      cyber ? (
        <Text color={CYBER.yellow} bold>
          {`▌${s}`}
        </Text>
      ) : (
        <Text color={skin.accent} bold>
          {s}
        </Text>
      )
    const sep = cyber ? ' // ' : ' · '

    // calls per minute, for the cyberdeck's skyline
    const perMinute: number[] = []
    if (log.length > 0) {
      const first = Math.floor((log[0]?.start ?? now) / 60_000)
      for (const c of log) {
        const i = Math.floor(c.start / 60_000) - first
        perMinute[i] = (perMinute[i] ?? 0) + 1
      }
    }
    const { level, title: rank, into, span } = levelOf(rep.points)

    // under cyberpunk the sigil sits dimmed beside the header, not above it
    const sigilWidth = cyber && width >= 44 ? 13 : 0
    const headerWidth = width - sigilWidth
    const header = (
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1}>
        <Box flexDirection="column">
          {cyber ? (
            <Text backgroundColor={CYBER.yellow} color={CYBER.ink} bold wrap="truncate-end">
              {` CYBERDECK // ${model.toUpperCase()} `}
            </Text>
          ) : (
            <Text color={skin.accent} bold wrap="truncate-end">
              {skin.upper ? model.toUpperCase() : model}
            </Text>
          )}
          {cyber ? (
            <Text color={CYBER.pink}>{skyline(Array.from(perMinute, x => x ?? 0), Math.max(8, headerWidth - 2))}</Text>
          ) : null}
          <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>
            {since ? `${cyber ? 'UPTIME ' : ''}${elapsed(now - since)}${cyber ? '' : ' in session'}${sep}` : ''}
            {plural(log.length, L.calls)}
            {sep}
            {plural(edits, L.edits)}
            {sep}
            {plural(commands, L.commands)}
            {failures ? `${sep}${plural(failures, L.errors)}` : ''}
          </Text>
        </Box>

        {ctx ? (
          <Progress label={L.context} value={ctx.percent} max={100} valueText={`${ctx.percent}%`} color={load(ctx.percent)} />
        ) : (
          <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>
            {L.context}: measured after the next reply
          </Text>
        )}

        {cyber ? (
          <Box flexDirection="column">
            <Progress
              label={`REP ${rep.points} // LV${level} ${rank.toUpperCase()}`}
              value={into}
              max={span}
              valueText={`${into}/${span}`}
              color={CYBER.cyan}
            />
            <Text color={CYBER.dim} wrap="truncate-end">
              {rep.streak > 0 ? `STREAK ${rep.streak}d // finish a job every day to keep it` : 'Finish a job to earn rep'}
            </Text>
          </Box>
        ) : null}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {sigilWidth > 0 ? (
          <Box flexDirection="row">
            {header}
            <Box flexDirection="column" flexShrink={0} marginLeft={1}>
              {SIGIL_ART.map(line => (
                <Text color={SIGIL_DIM}>{line}</Text>
              ))}
            </Box>
          </Box>
        ) : (
          header
        )}

        {daemons.length > 0 ? (
          <Box flexDirection="column">
            {title(L.agents)}
            {daemons.map(d => (
              <Box key={d.id} flexDirection="row">
                <Text color={cyber ? CYBER.green : skin.accent}>{cyber ? '◢ ' : '● '}</Text>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    <Text bold>{d.name}</Text>
                    <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>{` ${d.type}`}</Text>
                  </Text>
                </Box>
                <Text color={cyber ? CYBER.yellow : undefined} dimColor={!cyber}>
                  {` ${fmtDuration(now - d.started)}`}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="column">
          {title(L.timeline)}
          {recent.length === 0 ? (
            <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>
              {cyber ? 'No traffic yet.' : 'No tool calls yet.'}
            </Text>
          ) : null}
          {recent.map(call => {
            const ms = call.end !== null ? call.end - call.start : null
            const tone = ms !== null ? durationTone(ms) : 'dim'
            const name = call.tool.startsWith('mcp__') ? 'MCP' : call.tool
            return (
              <Box key={call.id} flexDirection="row">
                {cyber ? (
                  <Text color={CYBER_PHASE[phaseOf(call.tool)]} bold>
                    {tagOf(call.tool).padEnd(6)}
                  </Text>
                ) : (
                  <Text>{iconOf(call.tool)} </Text>
                )}
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-end">
                    {cyber ? null : <Text bold>{name}</Text>}
                    <Text color={cyber ? undefined : undefined} dimColor={!cyber}>
                      {cyber ? call.label || name : ` ${call.label}`}
                    </Text>
                  </Text>
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {ms === null ? (
                    <Text color={cyber ? CYBER.yellow : undefined} dimColor={!cyber}>
                      {cyber ? '[RUN]' : '…'}
                    </Text>
                  ) : (
                    <Text color={tone === 'dim' ? (cyber ? CYBER.dim : undefined) : tone} dimColor={tone === 'dim' && !cyber}>
                      {fmtDuration(ms)}
                    </Text>
                  )}
                  {cyber ? (
                    ms === null ? null : (
                      <Text color={call.failed ? CYBER.red : CYBER.green} bold>
                        {call.failed ? ' [FAIL]' : ' [OK]'}
                      </Text>
                    )
                  ) : (
                    <Text color={call.failed ? skin.bad : skin.good}> {call.failed ? '✗' : ms === null ? ' ' : '✓'}</Text>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          {title(L.files)}
          {topFiles.length === 0 ? (
            <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>
              None yet.
            </Text>
          ) : null}
          {topFiles.map(([path, count]) => {
            const name = path.split(/[\\/]/).pop() ?? path
            const bar = Math.max(1, Math.round((count / most) * 8))
            return (
              <Box key={path} flexDirection="row">
                <Box width={nameWidth} flexShrink={0}>
                  <Text wrap="truncate-start" color={cyber ? CYBER.cyan : undefined}>
                    {cyber ? `0x${hexId(path)} ${name}` : name}
                  </Text>
                </Box>
                <Text color={skin.bar}> {'█'.repeat(bar)}</Text>
                <Text color={cyber ? CYBER.yellow : undefined} dimColor={!cyber}>
                  {` ${count}`}
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })

  // ---------- Scratchpad ----------
  on('ui.render', { component: 'Pane', requestId: SCRATCH }, async ($, e) => {
    const { Box, Text, Input, Button } = $.ui.resolve(e)
    const [notes, draft, style] = await Promise.all([read($, notesAtom), read($, draftAtom), read($, styleAtom)])
    const skin = skinFor(style)
    const cyber = skin.cyber

    return (
      <Box flexDirection="column" gap={1}>
        {cyber ? (
          <Text backgroundColor={CYBER.yellow} color={CYBER.ink} bold>
            {' DATA SHARDS // LOCAL STORE '}
          </Text>
        ) : null}
        <Input
          key="new"
          placeholder={cyber ? 'Write a shard, Enter to store' : 'Jot a note, Enter to save'}
          submitLabel={cyber ? 'store' : 'save'}
          value={draft}
          autoFocus
          onInput={value => {
            void update($, draftAtom, () => value)
          }}
          onSubmit={value => {
            const text = value.trim()
            void update($, draftAtom, () => '')
            if (text) void saveNotes($, list => [text, ...list].slice(0, 100))
          }}
        />
        {notes.length === 0 ? (
          <Text color={cyber ? CYBER.dim : undefined} dimColor={!cyber}>
            {cyber
              ? 'No shards stored. Shards persist across sessions; press one to copy it.'
              : 'Nothing saved yet. Notes stay across sessions; press one to copy it.'}
          </Text>
        ) : null}
        <Box flexDirection="column">
          {notes.map((note, i) => (
            <Box key={`row-${i}`} flexDirection="row">
              {cyber ? <Text color={CYBER.cyan}>{`0x${hexId(note)} `}</Text> : null}
              <Box flexGrow={1} flexShrink={1}>
                <Button
                  key={`copy-${i}`}
                  plain
                  onPress={async press => {
                    const copied = await $.ui.copy({ text: note, surface: press.surface })
                    $.ui.toast(
                      copied.isCopied ? (cyber ? 'Shard copied to clipboard' : 'Copied to clipboard') : 'Could not copy',
                      { timeoutMs: 2000 },
                    )
                  }}
                >
                  {note}
                </Button>
              </Box>
              <Button key={`del-${i}`} plain label="×" onPress={() => saveNotes($, list => list.filter((_, k) => k !== i))} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
