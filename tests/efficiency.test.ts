import { expect, test } from 'claude-code/testing'

import {
  addLag,
  cacheSavings,
  clockTime,
  commandKey,
  costMetrics,
  estTokens,
  heatCells,
  heatGrid,
  heatLevel,
  mergeLag,
  paceForecast,
  parseBudget,
  priceOf,
  toBase64,
  topLag,
} from '../hooks/efficiency'

test('commandKey names what a call did', () => {
  const bash = (command: string) => commandKey('Bash', { command })
  expect(bash('cd x && cargo build --release')).toBe('cargo build')
  expect(bash('FOO=1 npm test')).toBe('npm test')
  expect(bash('cd ~/.claude/polish && node test-statusline.mjs 2>&1 | tail -6')).toBe('node test-statusline.mjs')
  expect(bash('git -C C:/repo status --short')).toBe('git status')
  expect(bash('claude plugin test cc-polish')).toBe('claude plugin')
  expect(bash('sudo ls -la')).toBe('ls')
  expect(commandKey('Read', { file_path: '/a/b.rs' })).toBe('Read')
  expect(commandKey('mcp__github__search_issues', {})).toBe('mcp:github')
})

test('leaderboards add, merge and rank by total time', () => {
  let board = addLag({}, 'cargo build', 100_000)
  board = addLag(board, 'cargo build', 20_000)
  board = addLag(board, 'Read', 500)
  expect(board['cargo build']).toEqual({ n: 2, total: 120_000, max: 100_000 })
  const merged = mergeLag(board, { Read: { n: 3, total: 900, max: 400 }, 'npm test': { n: 1, total: 5_000, max: 5_000 } }, 2)
  expect(Object.keys(merged)).toEqual(['cargo build', 'npm test'])
  expect(topLag(board, 1)[0]?.[0]).toBe('cargo build')
})

test('token estimate and cost metrics', () => {
  expect(estTokens('x'.repeat(4000))).toBe(1000)
  expect(costMetrics({ usd: 0, activeMin: 0, turns: 0, commits: 0, linesChanged: 0 })).toEqual({
    perTurn: null,
    perHour: null,
    perCommit: null,
    per100Lines: null,
  })
  const m = costMetrics({ usd: 6, activeMin: 30, turns: 3, commits: 2, linesChanged: 300 })
  expect(m.perTurn).toBe(2)
  expect(m.perHour).toBe(12)
  expect(m.perCommit).toBe(3)
  expect(m.per100Lines).toBe(2)
})

test('pacing: rising, flat and after a reset', () => {
  const t0 = 1_000_000_000
  const min = 60_000
  const rising: [number, number][] = [[t0, 50], [t0 + 10 * min, 60]]
  const p = paceForecast(rising, t0 + 10 * min, t0 + 300 * min)
  expect(Math.round(((p.hitsAt ?? 0) - (t0 + 10 * min)) / min)).toBe(40)
  expect(p.lastsToReset).toBe(false)
  expect(paceForecast(rising, t0 + 10 * min, t0 + 20 * min).lastsToReset).toBe(true)
  expect(paceForecast([[t0, 50], [t0 + 10 * min, 50]], t0 + 10 * min, null).hitsAt).toBe(null)
  const reset: [number, number][] = [[t0, 90], [t0 + 5 * min, 2], [t0 + 15 * min, 12]]
  expect(Math.round(((paceForecast(reset, t0 + 15 * min, null).hitsAt ?? 0) - (t0 + 15 * min)) / min)).toBe(88)
})

test('clock time reads like a wall clock', () => {
  expect(clockTime(new Date(2026, 10, 21, 15, 40).getTime())).toBe('3:40 PM')
  expect(clockTime(new Date(2026, 10, 21, 0, 5).getTime())).toBe('12:05 AM')
})

test('cache savings use the input minus cache-read price', () => {
  expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, cacheRead: 0.2 })
  expect(priceOf('claude-opus-5-5[1m]')).toEqual({ input: 4, cacheRead: 0.2 })
  expect(priceOf('claude-haiku-5-5')).toBe(null)
  const saved = cacheSavings({ 'claude-opus-5-5': 1_000_000, 'claude-sonnet-5-5': 2_000_000 })
  expect(saved.usd?.toFixed(2)).toBe((3.8 + 3.8).toFixed(2))
  expect(cacheSavings({ 'claude-haiku-5-5': 5 }).usd).toBe(null)
})

test('heatmap grid, levels and raster cells', () => {
  const now = new Date(2026, 10, 21, 12).getTime() // a Saturday
  const heat = heatGrid(
    { '2026-11-21': { active: 30, jobs: 4, usd: 2, calls: 50 }, '2026-11-20': { active: 10, jobs: 1, usd: 1, calls: 9 } },
    'time',
    now,
  )
  expect(heat.grid.length).toBe(12)
  expect(heat.grid[11]?.[5]).toBe(30) // Saturday of this week
  expect(heat.grid[11]?.[6]).toBe(null) // Sunday is still to come
  expect(heat.max).toBe(30)
  expect(heatLevel(0, 30)).toBe(0)
  expect(heatLevel(30, 30)).toBe(4)
  expect(heatLevel(1, 30)).toBe(1)
  const cells = heatCells(heat, ['#111111', '#222222', '#333333', '#444444', '#555555'])
  expect(cells.columns).toBe(35)
  expect(cells.rows).toBe(7)
  expect(cells.cells.length).toBe(Math.ceil((35 * 7 * 12) / 3) * 4)
  expect(toBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu')
  expect(toBase64(new Uint8Array([77]))).toBe('TQ==')
})

test('budget arguments', () => {
  expect(parseBudget('$20', {})).toEqual({ usdPerDay: 20 })
  expect(parseBudget('5h 80%', { usdPerDay: 20 })).toEqual({ usdPerDay: 20, fiveHour: 80 })
  expect(parseBudget('7d 90', {})).toEqual({ sevenDay: 90 })
  expect(parseBudget('off', { usdPerDay: 5 })).toBe('off')
  expect(parseBudget('5h 180%', {})).toBe(null)
  expect(parseBudget('lots', {})).toBe(null)
})
