// cc-cyberpunk-plugin themes: three desktop/mobile themes (Paper, Midnight, Nord), switched with /look.
// The terminal and editors draw no theme; there `$.theme.set` answers isDrawn: false.
import type { EngineInterface, On, ThemeSetArgs, ThemeSound, ThemeStyle } from 'claude-code'

import { makeColors } from './make-colors.js'
import { CYBERPUNK, MIDNIGHT, NORD, PAPER } from './palettes'
import { SCENES } from './scenes'

type LookName = 'paper' | 'midnight' | 'nord' | 'cyberpunk'
const NAMES: readonly LookName[] = ['paper', 'midnight', 'nord', 'cyberpunk']
const DEFAULT_LOOK: LookName = 'nord'
const STORE_KEY = 'look'

// ---------- sound: quiet, sparse, never a system chime ----------

const SOFT_CUES: ThemeSound['cues'] = {
  send: { layers: [{ wave: 'triangle', notes: ['C5'], gain: 0.18, attack: 0.005, release: 0.18 }] },
  done: { layers: [{ wave: 'bell', notes: ['E5', 'G5', 'C6'], step: 0.11, gain: 0.22, release: 1.1 }] },
  error: { layers: [{ wave: 'triangle', notes: ['A3', 'F3'], step: 0.14, gain: 0.22, release: 0.35 }] },
}

const PAPER_SOUND: ThemeSound = {
  ambience: {
    layers: [
      { wave: 'brown', drone: true, gain: 0.1, filter: { type: 'lowpass', hz: 420 } },
      { wave: 'crackle', scatter: 1.2, gain: 0.05, release: 0.06 },
    ],
  },
  cues: SOFT_CUES,
}

const MIDNIGHT_SOUND: ThemeSound = {
  ambience: {
    layers: [
      { wave: 'sine', notes: ['A2', 'E3'], drone: true, gain: 0.08, tremolo: { hz: 0.08, depth: 0.4 } },
      { wave: 'bell', notes: ['E6', 'B6', 'F#6', 'C#7'], scatter: 0.06, gain: 0.05, release: 2.2 },
    ],
    reverb: 0.35,
  },
  cues: {
    ...SOFT_CUES,
    done: { layers: [{ wave: 'bell', notes: ['B5', 'E6'], step: 0.14, gain: 0.2, release: 1.6 }], reverb: 0.3 },
  },
}

const NORD_SOUND: ThemeSound = {
  ambience: {
    layers: [
      {
        wave: 'pink',
        drone: true,
        gain: 0.1,
        filter: { type: 'lowpass', hz: 500, to: 1100 },
        tremolo: { hz: 0.07, depth: 0.55 },
      },
    ],
  },
  cues: SOFT_CUES,
}

// ---------- message styling ----------

const shadow = { x: 0, y: 2, blur: 10, color: '#0000001f' } as const

const PAPER_STYLE: ThemeStyle = {
  Text: { fontFamily: ['serif'], fontSize: 16, lineHeight: 25 },
  Heading: { fontFamily: ['serif'], fontWeight: 'semibold' },
  UserMessage: { backgroundColor: 'surface-2', radius: 14, paddingX: 16, paddingY: 12, shadow },
  AssistantMessage: { paddingX: 4 },
  ToolUse: { backgroundColor: 'surface-1', radius: 8, paddingX: 10, paddingY: 4 },
}

const MIDNIGHT_STYLE: ThemeStyle = {
  Text: { fontFamily: ['sans'], fontSize: 15, lineHeight: 24 },
  UserMessage: {
    backgroundColor: '#241f4a',
    borderColor: '#4c44a0',
    borderWidth: 1,
    radius: 16,
    paddingX: 16,
    paddingY: 12,
    shadow: { x: 0, y: 0, blur: 18, color: '#7c6cf633' },
  },
  AssistantMessage: { backgroundColor: '#14122bf2', radius: 16, paddingX: 16, paddingY: 12 },
  ToolUse: { backgroundColor: '#1b1838f5', radius: 10, paddingX: 10, paddingY: 4 },
}

const NORD_STYLE: ThemeStyle = {
  Text: { fontFamily: ['sans'], fontSize: 15, lineHeight: 24 },
  UserMessage: { backgroundColor: 'surface-2', radius: 12, paddingX: 14, paddingY: 10, shadow },
  AssistantMessage: { backgroundColor: 'surface-1', radius: 12, paddingX: 14, paddingY: 10 },
  ToolUse: { backgroundColor: 'surface-2', radius: 8, paddingX: 10, paddingY: 4 },
}

// ---------- the looks ----------

const LOOKS: Record<LookName, ThemeSetArgs> = {
  paper: {
    colors: makeColors(PAPER).theme,
    backdrop: { gradient: { stops: ['surface-0', 'surface-1'], angle: 180 } },
    style: PAPER_STYLE,
    sound: PAPER_SOUND,
  },
  midnight: {
    colors: makeColors(MIDNIGHT).theme,
    overrideColorScheme: 'dark',
    backdrop: { scene: 'aurora' },
    style: MIDNIGHT_STYLE,
    sound: MIDNIGHT_SOUND,
  },
  cyberpunk: {
    colors: makeColors(CYBERPUNK).theme,
    overrideColorScheme: 'dark',
    backdrop: { scene: 'neon-city', glass: { blur: 6, tint: '#0b0a14', opacity: 0.35 } },
    style: {
      Text: { fontFamily: ['mono'], fontSize: 14, lineHeight: 22 },
      Heading: { fontFamily: ['mono'], fontWeight: 'bold', letterSpacing: 1 },
      UserMessage: {
        backgroundColor: '#1a1030',
        borderColor: '#ff2a6d',
        borderWidth: 1,
        radius: 2,
        paddingX: 14,
        paddingY: 10,
        shadow: { x: 0, y: 0, blur: 16, color: '#ff2a6d40' },
      },
      AssistantMessage: {
        backgroundColor: '#0f0d1cf2',
        borderColor: '#00f0ff55',
        borderWidth: 1,
        radius: 2,
        paddingX: 14,
        paddingY: 10,
      },
      ToolUse: { color: '#00f0ff', fontFamily: ['mono'], backgroundColor: '#14102af5', radius: 2, paddingX: 10, paddingY: 4 },
    },
    sound: {
      ambience: {
        layers: [
          { wave: 'saw', notes: ['A1', 'E2'], drone: true, gain: 0.05, filter: { type: 'lowpass', hz: 280, to: 620 } },
          { wave: 'crackle', scatter: 3, gain: 0.035, release: 0.03 },
        ],
      },
      cues: {
        send: { layers: [{ wave: 'square', notes: ['C6'], gain: 0.12, release: 0.08, glide: -5, filter: { type: 'lowpass', hz: 2400 } }] },
        done: {
          layers: [{ wave: 'saw', notes: ['A4', 'C5', 'E5', 'A5'], step: 0.06, gain: 0.14, release: 0.25, filter: { type: 'lowpass', hz: 2200 } }],
        },
        error: { layers: [{ wave: 'square', notes: ['C3', 'B2'], step: 0.1, gain: 0.16, release: 0.3, glide: -2 }] },
      },
    },
  },
  nord: {
    colors: makeColors(NORD).theme,
    backdrop: { scene: 'waves' },
    style: NORD_STYLE,
    sound: NORD_SOUND,
  },
}

const isLook = (value: unknown): value is LookName => NAMES.includes(value as LookName)

/** Sets a look, falling back without sound and style for a build that refuses them. */
async function applyLook($: EngineInterface, name: LookName): Promise<{ isDrawn: boolean; reason?: string }> {
  const look = LOOKS[name]
  try {
    return await $.theme.set(look)
  } catch (error) {
    $.ui.log(`cc-cyberpunk-plugin: ${name} with sound and style was refused (${String(error)}); setting it without them`)
    const { sound: _sound, style: _style, ...plain } = look
    try {
      return await $.theme.set(plain)
    } catch (again) {
      $.ui.log(`cc-cyberpunk-plugin: ${name} was refused again (${String(again)}); setting its colors alone`)
      return await $.theme.set({ colors: look.colors })
    }
  }
}

/** Registers /look and applies the saved look; the plugin's one session.start hook calls it. */
export async function looksSessionStart($: EngineInterface): Promise<void> {
  await $.command.register({
    name: 'look',
    description: 'Theme for the desktop and mobile apps',
    argumentHint: 'paper | midnight | nord | cyberpunk | off',
  })
  const saved = await $.store.get(STORE_KEY)
  if (saved !== 'off') await applyLook($, isLook(saved) ? saved : DEFAULT_LOOK).catch(() => undefined)
}

export function registerLooks(on: On): void {

  on('command.run', { command: 'look' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const saved = await $.store.get(STORE_KEY)
    const current = saved === 'off' ? 'off' : isLook(saved) ? saved : DEFAULT_LOOK

    if (arg === '') {
      return { text: `Look: ${current}. Choose one with /look paper | midnight | nord | cyberpunk | off.` }
    }
    if (arg === 'off') {
      await $.theme.clear()
      await $.store.set(STORE_KEY, 'off')
      return { text: 'Look off: the app’s own theme is back.' }
    }
    if (!isLook(arg)) {
      return { text: `No look called “${arg}”. Choose paper, midnight, nord, cyberpunk or off.` }
    }

    await $.store.set(STORE_KEY, arg)
    const result = await applyLook($, arg)
    return {
      text: result.isDrawn
        ? `Look set to ${arg}. Turn on its sound with the speaker button in the title bar.`
        : `Look set to ${arg}. It shows in the Claude desktop and mobile apps; this terminal draws no themes.`,
    }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const scene = SCENES[e.props.scene]
    if (!scene) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={scene.source} alt={scene.alt} />
  })
}
