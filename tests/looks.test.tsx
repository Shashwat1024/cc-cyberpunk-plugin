import { expect, mock, test } from 'claude-code/testing'
import type { On, ThemeSetArgs } from 'claude-code'

function world(on: On, options: { refuseExtras?: boolean } = {}) {
  const stored: Record<string, unknown> = {}
  const sets: ThemeSetArgs[] = []
  let cleared = 0
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  // the plugin's whole session start runs here, so the rest of what it reads is answered too
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/test' })
  on('fs.read', () => ({ value: '{}' }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.log', () => ({ value: undefined }))
  on('theme.set', (_, e) => {
    if (options.refuseExtras && (e.sound || e.style)) throw new Error('sound is not known to this build')
    sets.push(e)
    return { value: { isDrawn: true } } as never
  })
  on('theme.clear', () => {
    cleared += 1
    return { value: { isDrawn: false, reason: 'cleared' } } as never
  })
  return { stored, sets, cleared: () => cleared }
}

test('a new session gets the default look, Nord, with its waves', async ($, on) => {
  const { sets } = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(1)
  expect(sets[0]?.backdrop).toEqual({ scene: 'waves' })
  expect(sets[0]?.sound).toBeDefined()
  expect(sets[0]?.style).toBeDefined()
})

test('/look saves the choice and applies it; off clears it', async ($, on) => {
  const { stored, sets, cleared } = world(on)
  const midnight = await $.command.run({ command: 'look', args: 'midnight' } as never)
  expect(stored.look).toBe('midnight')
  expect(sets.at(-1)?.backdrop).toEqual({ scene: 'aurora' })
  expect(sets.at(-1)?.overrideColorScheme).toBe('dark')
  expect(String((midnight as { text?: string }).text)).toContain('midnight')

  const bad = await $.command.run({ command: 'look', args: 'neon' } as never)
  expect(String((bad as { text?: string }).text)).toContain('No look called')
  expect(stored.look).toBe('midnight')

  await $.command.run({ command: 'look', args: 'off' } as never)
  expect(stored.look).toBe('off')
  expect(cleared()).toBe(1)

  // a saved "off" stays off in the next session
  const before = sets.length
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(sets.length).toBe(before)
})

test('a build that refuses sound and style still gets the colors and backdrop', async ($, on) => {
  const { sets } = world(on, { refuseExtras: true })
  await $.command.run({ command: 'look', args: 'paper' } as never)
  expect(sets.length).toBe(1)
  expect(sets[0]?.sound).toBeUndefined()
  expect(sets[0]?.style).toBeUndefined()
  expect(sets[0]?.colors).toBeDefined()
  expect(sets[0]?.backdrop).toBeDefined()
})

test('the backdrop draws its scene on desktop and leaves the terminal alone', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const props = { scene: 'aurora', plugin: 'cc-cyberpunk-plugin', glass: {} }
  const desk = await $.ui.mount({ plugin: 'cc-cyberpunk-plugin', surface: 'desktop', component: 'Backdrop', props } as never)
  const svg = await desk.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(JSON.stringify(svg)).toContain('aurora')
  await desk.unmount()

  const term = await $.ui.mount({ plugin: 'cc-cyberpunk-plugin', surface: 'terminal', component: 'Backdrop', props } as never)
  expect(await term.find({ type: 'Svg' })).toBeUndefined()
  await term.unmount()
})
