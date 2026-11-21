import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { diffStat, durationTone, exitOf, fmtDuration, hintFor, lineDiff, pulseCells } from '../hooks/track'

const SURFACES = ['terminal', 'desktop'] as const

/** Everything beneath the plugin, answered from memory. */
function world(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/test' })
  const toasts: string[] = []
  const writes: Record<string, string> = {}
  const stored: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', () => ({ value: { isSent: false, reason: 'no-channel' } }))
  on('fs.write', (_, e) => {
    writes[e.path] = e.text
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.UserPromptSubmit', () => ({}) as never)
  // `false` fails with exit 1; a Read of a "big" file returns ~25k tokens; every other call succeeds.
  on('tool.call', (_, e) => {
    const input = e as unknown as { command?: string; file_path?: string }
    if (String(e.tool) === 'Bash' && String(input.command).includes('false')) {
      return { result: 'Exit code 1', isError: true, text: 'Exit code 1' } as never
    }
    if (String(e.tool) === 'Read' && String(input.file_path).includes('big')) {
      return { result: {}, text: 'x'.repeat(100_000) } as never
    }
    return { result: {}, text: 'ok' } as never
  })
  on('ui.blit', () => ({ value: {} }) as never)
  return { clock, toasts, writes, stored }
}

const band = (isWorking: boolean) =>
  ({
    plugin: 'cc-cyberpunk-plugin',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking,
      maxRows: 3,
      bodyColumns: 80,
      scroll: { offset: 0, bodyRows: 3 },
      view: {},
    },
  }) as const

const row = (id: string, tool: string, input: unknown, extra: Record<string, unknown> = {}) =>
  ({
    plugin: 'cc-cyberpunk-plugin',
    component: 'ToolUse',
    requestId: id,
    props: {
      tool_use_id: id,
      tool,
      input,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      ...extra,
    },
  })

test('helpers: diff stats, durations, hints, pulse', () => {
  expect(lineDiff(['a', 'b', 'c'], ['a', 'x', 'c', 'y'])).toEqual({ added: 2, removed: 1 })
  expect(diffStat('Write', { content: 'one\ntwo\nthree' })).toEqual({ added: 3, removed: 0 })
  expect(diffStat('Edit', { old_string: 'a', new_string: 'a\nb' })).toEqual({ added: 1, removed: 0 })
  expect(
    diffStat('MultiEdit', {
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c\nd', new_string: 'c' },
      ],
    }),
  ).toEqual({ added: 1, removed: 2 })
  expect(diffStat('Read', { file_path: 'x' })).toBe(null)

  expect(durationTone(9_999)).toBe('dim')
  expect(durationTone(10_000)).toBe('warning')
  expect(durationTone(60_000)).toBe('error')
  expect(fmtDuration(1234)).toBe('1.2s')
  expect(fmtDuration(42_000)).toBe('42s')
  expect(fmtDuration(134_000)).toBe('2m14s')

  expect(exitOf('Error: Exit code 127\nnot found')).toBe(127)
  expect(exitOf({ text: 'exit code 2' })).toBe(2)
  expect(exitOf('boom')).toBe(null)

  expect(hintFor('')).toBe(null)
  expect(hintFor('/com')).toContain('Tab')
  expect(hintFor('!ls')).toContain('shell')
  expect(hintFor('look at @src/ma')).toContain('@')
  expect(hintFor('look at @src/main.rs please')).toBe(null)
  expect(hintFor('x'.repeat(401))).toContain('Ctrl+G')

  const [before, lit, after] = pulseCells(40, 20)
  expect(before + lit + after).toBe(40)
  expect(lit).toBeGreaterThan(0)
})

test('a turn: pulse while working, recap after, toast for a long turn', async ($, on) => {
  const { clock, toasts, writes } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/a.rs', old_string: 'a', new_string: 'a\nb' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'false' } as never)

  // the engine hands the path on in the platform's own separators
  const written = Object.entries(writes).map(([path, text]) => [path.replace(/\\/g, '/'), text])
  expect(written.length).toBe(1)
  expect(written[0]?.[0]).toBe('C:/Users/test/.claude/cc-cyberpunk/state.json')
  expect(written[0]?.[1]).toContain('"lastToolFailed":true')

  // the pulse runs under the engine's spinner on the terminal, where it can't be collapsed
  const spinner = (mode: string) =>
    ({
      plugin: 'cc-cyberpunk-plugin',
      surface: 'terminal',
      component: 'Spinner',
      props: { word: 'Sauteing', message: null, suffix: '…', mode },
    }) as never
  const running = await $.ui.mount(spinner('tool-use'))
  expect((await running.find({ type: 'Text', text: /running · 2 calls/ }))?.text).toBe(' running · 2 calls')
  await running.unmount()
  const thinking = await $.ui.mount(spinner('thinking'))
  expect((await thinking.find({ type: 'Text', text: /thinking/ }))?.text).toBe(' thinking · 2 calls')
  await thinking.unmount()

  // while the turn runs, the band leaves its row to the engine
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(true), surface })
    expect(await ui.find({ type: 'Text', text: /running/ })).toBeUndefined()
    await ui.unmount()
  }

  await clock.advance(45_000)
  await $.turn.complete({ answer: '', durationMs: 45_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(toasts).toEqual(['✓ Done in 45s · 1 edit · 1 command · 1 error'])

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...band(false), surface })
    expect((await ui.find({ type: 'Text', text: /^45s$/ }))?.text).toBe('45s')
    expect((await ui.find({ type: 'Text', text: /1 error/ }))?.text).toBe('1 error')
    await ui.unmount()
  }

  await clock.advance(8_000)
  const ui = await $.ui.mount({ ...band(false), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^45s$/ })).toBeUndefined()
  await ui.unmount()
})

test('tool rows: icon, duration, edit size and exit code chips', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/a.rs', old_string: 'a', new_string: 'a\nb' } as never)

  for (const surface of SURFACES) {
    const edit = await $.ui.mount({ ...row('e1', 'Edit', { file_path: '/w/a.rs', old_string: 'a', new_string: 'a\nb' }), surface } as never)
    expect((await edit.find({ type: 'Text', text: /📝/ }))?.text).toBeDefined()
    expect((await edit.find({ type: 'Text', text: /^0\.0s$/ }))?.text).toBe('0.0s')
    expect((await edit.find({ type: 'Text', text: /^\+1$/ }))?.text).toBe('+1')
    await edit.unmount()

    const bash = await $.ui.mount({
      ...row('b9', 'Bash', { command: 'false' }, { isErrored: true, output: 'Exit code 1' }),
      surface,
    } as never)
    expect((await bash.find({ type: 'Text', text: /exit 1/ }))?.text).toBe('✗ exit 1')
    await bash.unmount()
  }
})

test('scratchpad: notes are added, kept in the store, and removed', async ($, on) => {
  const { stored } = world(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'cc-cyberpunk-plugin',
      surface,
      component: 'Pane',
      requestId: 'polish-scratch',
      props: {
        title: 'Scratchpad',
        isFocused: true,
        bodyColumns: 40,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
      },
    } as never)
    await ui.input({ key: 'new', text: 'milk' })
    expect(await ui.find({ key: 'copy-0' })).toBeDefined()
    expect(stored.notes).toEqual(['milk'])
    await ui.press({ key: 'del-0' })
    expect(await ui.find({ key: 'copy-0' })).toBeUndefined()
    expect(stored.notes).toEqual([])
    await ui.unmount()
  }
})

test('/polish switches and cycles status line styles, keeping the rest of the config', async ($, on) => {
  const { writes } = world(on)
  let config = JSON.stringify({ mode: 'powerline', separator: 'powerline', previousStatusLine: { type: 'command' } })
  on('fs.read', () => ({ value: config }))
  const run = async (args: string) => {
    const result = (await $.command.run({ command: 'polish', args } as never)) as { text?: string }
    const written = Object.values(writes).at(-1)
    if (written) config = written
    return String(result.text)
  }

  expect(await run('')).toContain('[classic]')
  expect(await run('next')).toContain('minimal')
  expect(JSON.parse(config).style).toBe('minimal')
  expect(JSON.parse(config).mode).toBeUndefined()
  expect(JSON.parse(config).previousStatusLine).toEqual({ type: 'command' })
  expect(await run('aurora')).toContain('aurora')
  expect(await run('next')).toContain('cockpit')
  expect(await run('next')).toContain('neon')
  expect(await run('next')).toContain('cyberpunk')
  expect(await run('next')).toContain('classic')
  expect(await run('cyber')).toContain('cyberpunk')
  expect(await run('powerline')).toContain('classic')
  expect(await run('blocks')).toContain('separators')
  expect(JSON.parse(config)).toMatchObject({ style: 'classic', separator: 'plain' })
  expect(await run('rainbow')).toContain('Use /polish')
})

test('the cyberpunk skin: tags, data rain, mode tag, job card, cyberdeck, shards and rep', async ($, on) => {
  const { stored, toasts, clock } = world(on)
  on('fs.read', () => ({ value: JSON.stringify({ style: 'classic' }) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'polish', args: 'cyberpunk' } as never)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/w/a.rs', old_string: 'a', new_string: 'a\nb' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'git commit -m x' } as never)

  // tool rows: neon tag and [OK]
  const edit = await $.ui.mount({ ...row('e1', 'Edit', { file_path: '/w/a.rs', old_string: 'a', new_string: 'a\nb' }), surface: 'terminal' } as never)
  expect((await edit.find({ type: 'Text', text: /^WR\/ +$/ }))?.text).toBeDefined()
  expect((await edit.find({ type: 'Text', text: /^\[OK\]$/ }))?.text).toBe('[OK]')
  await edit.unmount()

  // the working line: data rain with an ops count
  const spin = await $.ui.mount({
    plugin: 'cc-cyberpunk-plugin',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' },
  } as never)
  expect((await spin.find({ type: 'Text', text: /RUNNING \/\/ OPS 2/ }))?.text).toBe(' RUNNING // OPS 2')
  expect(await spin.find({ type: 'Text', text: /[─━]/ })).toBeDefined()
  await spin.unmount()

  // the mode tag on the hint line
  const hint = await $.ui.mount({
    plugin: 'cc-cyberpunk-plugin',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '⏵⏵ auto mode on (shift+tab to cycle)' },
  } as never)
  expect((await hint.find({ type: 'Text', text: /MODE\/\/AUTO/ }))?.text).toBe(' MODE//AUTO ')
  await hint.unmount()

  // the mode Claude Code reports wins over the hint line's words
  await ($ as unknown as { classic: { UserPromptSubmit: (e: object) => Promise<unknown> } }).classic.UserPromptSubmit({
    prompt: 'plan it',
    permission_mode: 'plan',
  })
  const planned = await $.ui.mount({
    plugin: 'cc-cyberpunk-plugin',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '' },
  } as never)
  expect((await planned.find({ type: 'Text', text: /MODE\/\// }))?.text).toBe(' MODE//RECON ')
  await planned.unmount()

  // the job: rep, a transmission toast and a job card
  await clock.advance(45_000)
  await $.turn.complete({ answer: '', durationMs: 45_000, isAborted: false, turnId: 't1', reason: 'answer' })
  // 10 for the job, 1 per edit, 2 per command, 25 per commit
  expect((stored.rep as { points: number }).points).toBe(10 + 1 + 2 + 25)
  expect(toasts.at(-1)).toContain('INCOMING TRANSMISSION')
  expect(toasts.at(-1)).toContain('+38 REP')
  const card = await $.ui.mount({
    plugin: 'cc-cyberpunk-plugin',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 45_000 },
  } as never)
  expect((await card.find({ type: 'Text', text: /JOB COMPLETE/ }))?.text).toBe('◢ JOB COMPLETE')
  expect((await card.find({ type: 'Text', text: /REP/ }))?.text).toBe('  +38 REP')
  await card.unmount()

  // the panes
  const pane = (requestId: string, title: string) =>
    ({
      plugin: 'cc-cyberpunk-plugin',
      surface: 'terminal',
      component: 'Pane',
      requestId,
      props: { title, isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    }) as never
  const deck = await $.ui.mount(pane('polish-overview', 'Session'))
  expect((await deck.find({ type: 'Text', text: /CYBERDECK/ }))?.text).toBe(' CYBERDECK // CLAUDE-OPUS-5-5 ')
  expect((await deck.find({ type: 'Text', text: /NET LOG/ }))?.text).toBe('▌NET LOG')
  expect((await deck.find({ type: 'Text', text: /SHARDS/ }))?.text).toBe('▌SHARDS')
  await deck.unmount()
  const shards = await $.ui.mount(pane('polish-scratch', 'Scratchpad'))
  await shards.input({ key: 'new', text: 'jack in at midnight' })
  expect((await shards.find({ type: 'Text', text: /^0x[0-9A-F]{4} $/ }))?.text).toBeDefined()
  await shards.unmount()
})

test('efficiency: leaderboard, hogs, spend, budget, pacing and the pane', async ($, on) => {
  const { stored, toasts, clock } = world(on)
  on('fs.read', () => ({ value: JSON.stringify({ style: 'classic' }) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const measure = (percentUsed: number, usd: number) =>
    $.session.measure({
      context: { percent: 20, window: 200_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: new Date(clock.now() + 3 * 3_600_000).toISOString() }],
      cost: { usd },
      changed: ['context', 'rateLimits', 'cost'],
    } as never)

  await $.command.run({ command: 'budget', args: '$2' } as never)
  await $.command.run({ command: 'budget', args: '5h 60%' } as never)
  expect(stored.budget).toEqual({ usdPerDay: 2, fiveHour: 60 })

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c1', command: 'cd x && cargo build --release' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'c2', command: 'cargo build' } as never)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/w/big.log' } as never)
  expect(toasts.some(t => t.includes('big.log used ~25k tokens'))).toBe(true)

  // spend: 85% of the $2 budget, then past it; the 5h window climbs fast
  await measure(50, 1.7)
  expect(toasts.some(t => t.startsWith("80% of today's budget"))).toBe(true)
  await clock.advance(10 * 60_000)
  await measure(70, 2.5)
  expect(toasts.some(t => t.startsWith('Daily budget reached'))).toBe(true)
  expect(toasts.some(t => t.includes('5h usage at 70%, past your 60% threshold'))).toBe(true)
  expect(toasts.some(t => t.includes("you'll hit the 5h limit at ~"))).toBe(true)
  const days = stored.days as Record<string, { usd: number; calls: number }>
  const today = Object.values(days)[0]
  expect(today?.usd).toBe(2.5)
  expect(today?.calls).toBe(3)

  // each alert fires once
  const count = toasts.length
  await measure(72, 2.6)
  expect(toasts.length).toBe(count)

  await $.turn.complete({
    answer: '',
    durationMs: 600_000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 },
  } as never)
  expect((stored.lagboard as Record<string, { n: number }>)['cargo build']?.n).toBe(2)

  for (const skin of ['classic', 'cyberpunk']) {
    await $.command.run({ command: 'polish', args: skin } as never)
    const pane = await $.ui.mount({
      plugin: 'cc-cyberpunk-plugin',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'polish-stats',
      props: { title: 'Efficiency', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    } as never)
    const missing: string[] = []
    for (const re of [
      skin === 'cyberpunk' ? /BURN RATE/ : /^Pacing$/,
      /limit at ~/,
      /session ≈\$2\.60/,
      /90% hit/,
      /saved ≈\$0\.034/,
      /big\.log/,
      /^cargo build$/,
    ]) {
      if (!(await pane.find({ type: 'Text', text: re }))) missing.push(`${skin}: ${re}`)
    }
    expect(missing).toEqual([])
    expect(await pane.find({ type: 'Raster' })).toBeDefined()
    await pane.press({ key: 'lag-all' })
    expect((await pane.find({ key: 'lag-all' }))?.props.label).toBe('[all-time]')
    await pane.press({ key: 'heat-jobs' })
    expect((await pane.find({ key: 'heat-jobs' }))?.props.label).toBe('[jobs]')
    await pane.unmount()
  }
})

test('context warning fires once past 80% and re-arms under 50%', async ($, on) => {
  const { toasts } = world(on)
  const measure = (percent: number) =>
    $.session.measure({ context: { percent, window: 200_000 }, rateLimits: [], changed: ['context'] })

  await measure(85)
  await measure(90)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toContain('Context 85% full')
  await measure(40)
  await measure(82)
  expect(toasts.length).toBe(2)
})
