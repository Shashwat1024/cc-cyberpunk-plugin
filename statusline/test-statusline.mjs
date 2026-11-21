// Fixture runner for statusline.mjs: node test-statusline.mjs [--show]
// Renders every style at several widths and times of day, and checks the output.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'statusline.mjs');
const STYLES = ['classic', 'minimal', 'sky', 'aurora', 'cockpit', 'neon', 'cyberpunk'];
const TWO_LINES = new Set(['cockpit', 'cyberpunk']);
const show = process.argv.includes('--show');
const now = Math.floor(Date.now() / 1000);

const fixtures = {
  low: {
    session_id: 'low',
    model: { display_name: 'Opus 5.5' },
    workspace: { current_dir: 'C:\\Users\\dev\\.claude' },
    context_window: { used_percentage: 10, context_window_size: 200000 },
    rate_limits: { five_hour: { used_percentage: 3, resets_at: now + 17100 }, seven_day: { used_percentage: 20 } },
    cost: { total_duration_ms: 4_320_000, total_lines_added: 120, total_lines_removed: 34 },
  },
  mid: {
    session_id: 'mid',
    model: { display_name: 'Opus 5.5 (1M context)' },
    workspace: { current_dir: 'C:\\Users\\dev\\projects\\demo-app' },
    context_window: { used_percentage: 65 },
    rate_limits: { five_hour: { used_percentage: 47, resets_at: now + 3000 }, seven_day: { used_percentage: 71 } },
  },
  highNoUsage: {
    session_id: 'high',
    model: { display_name: 'Sonnet 5.5' },
    workspace: { current_dir: 'C:\\Windows' },
    context_window: { used_percentage: 92 },
  },
  tokensOnly: {
    model: { id: 'claude-haiku-5-5' },
    cwd: 'C:\\Users\\dev',
    context_window: { context_window_size: 200000, current_usage: { input_tokens: 30000, cache_read_input_tokens: 50000 } },
  },
  empty: {},
};

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
// kana and kanji take two cells
const cells = s => [...strip(s)].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
let failures = 0;
const check = (label, ok) => {
  if (!ok) {
    failures++;
    console.log(`  FAIL: ${label}`);
  }
};

function run(fixture, env = {}, stateDir = mkdtempSync(join(tmpdir(), 'polish-'))) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify(fixture),
    env: { ...process.env, POLISH_STATE_DIR: stateDir, POLISH_NO_GIT: '1', ...env },
    encoding: 'utf8',
  });
  return { out: r.stdout, ms: Date.now() - t, err: r.stderr, stateDir };
}

// ---------- every style, every fixture, two widths, four times of day ----------
let slowest = 0;
for (const style of STYLES) {
  for (const [name, f] of Object.entries(fixtures)) {
    for (const columns of [120, 70]) {
      for (const h of [7, 13, 18.5, 1]) {
        const r = run(f, { POLISH_STYLE: style, POLISH_HOUR: String(h), COLUMNS: String(columns) });
        slowest = Math.max(slowest, r.ms);
        const lines = r.out.split('\n').filter(Boolean);
        const label = `${style}/${name}/${columns}c/h${h}`;
        check(`${label} no stderr (${r.err.trim().slice(0, 120)})`, !r.err);
        check(`${label} line count`, lines.length === (TWO_LINES.has(style) ? 2 : 1));
        if (!['classic', 'minimal'].includes(style)) {
          for (const line of lines) check(`${label} fits ${columns} columns (${cells(line)})`, cells(line) <= columns - 6);
        }
        check(`${label} ends with a reset`, lines.every(l => l.endsWith('\x1b[0m')));
        if (show && columns === 120 && name === 'low') console.log(`${label.padEnd(26)}\n${r.out}`);
      }
    }
  }
}

// ---------- content ----------
const at = (style, f, env = {}) => strip(run(f, { POLISH_STYLE: style, COLUMNS: '120', ...env }).out);
const low = at('classic', fixtures.low);
check('classic: model, folder, ctx, reset', low.includes('Opus 5.5') && low.includes('.claude') && low.includes('10%') && /↻ 4h4\dm/.test(low));
check('classic: 7d hidden below 50%', !low.includes('7d'));
check('classic: 7d shown at 71%', at('classic', fixtures.mid).includes('7d 71%'));
check('classic: model suffix stripped', !at('classic', fixtures.mid).includes('context'));
check('classic: tokens fallback = 40%', at('classic', fixtures.tokensOnly).includes('40%'));
check('classic: no usage segment without rate_limits', !at('classic', fixtures.highNoUsage).includes('5h'));
check('sky: model and both meters', /Opus 5\.5.*ctx 10%.*5h 3%/.test(at('sky', fixtures.low, { POLISH_HOUR: '13' })));
check('sky: sun by day', at('sky', fixtures.low, { POLISH_HOUR: '13' }).includes('☀'));
check('sky: moon and stars by night', /☾/.test(at('sky', fixtures.low, { POLISH_HOUR: '1' })) && /[⠁⠂⠄⠈⠐⠠]/.test(at('sky', fixtures.low, { POLISH_HOUR: '1' })));
check('aurora: model and meters', /◆ Opus 5\.5.*ctx .* 10%.*5h .* 3%/.test(at('aurora', fixtures.low)));
const cockpit = at('cockpit', fixtures.low).split('\n');
check('cockpit: top line has clock, lines', cockpit[0]?.includes('T+01:12') && cockpit[0]?.includes('+120') && cockpit[0]?.includes('-34'));
check('cockpit: bottom line has both gauges', cockpit[1]?.includes('CTX') && cockpit[1]?.includes('5H'));
check('neon: idle mark and meters', /■ IDLE OPUS 5\.5.*CTX .* 10%.*5H .* 3%/.test(at('neon', fixtures.low)));
const cyber = at('cyberpunk', fixtures.low).split('\n');
check('cyberpunk: nameplate and both meters', /OPUS·5\.5/.test(cyber[0] ?? '') && /NEURAL .* 10%/.test(cyber[0] ?? '') && /BANDWIDTH .*  3%/.test(cyber[0] ?? ''));
check('cyberpunk: reboot countdown', /REBOOT 4h4\dm/.test(cyber[0] ?? ''));
check('cyberpunk: standby and uptime', cyber[1]?.includes('◣ STANDBY 待機') && cyber[1]?.includes('UPTIME 01:12'));
check('cyberpunk: hot meter turns to a warning', /⚠ NEURAL/.test(at('cyberpunk', fixtures.highNoUsage)));

// ---------- state from the mod ----------
const stateDir = mkdtempSync(join(tmpdir(), 'polish-'));
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ lastToolFailed: true, at: Date.now(), running: true, updated: Date.now(), calls: 42 }));
const withState = (style, env = {}) => strip(run(fixtures.low, { POLISH_STYLE: style, COLUMNS: '140', ...env }, stateDir).out);
check('neon: LIVE while running', withState('neon').includes('▶ LIVE'));
check('cyberpunk: jacked in and breach', withState('cyberpunk').includes('◢ JACKED IN 接続中') && withState('cyberpunk').includes('BREACH'));
{
  const dir = mkdtempSync(join(tmpdir(), 'polish-'));
  const minute = Math.floor(Date.now() / 60000);
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    running: true, updated: Date.now(), calls: 7,
    activity: [[minute - 3, 4, 0, 0, 0, 0], [minute - 1, 0, 2, 1, 0, 0], [minute, 0, 0, 3, 0, 1]],
    daemons: [{ name: 'reviewer', type: 'Explore', started: Date.now() - 90_000 }],
    rep: { points: 340, level: 2, title: 'Code Runner', streak: 4 },
  }));
  const line = strip(run({ ...fixtures.low, cost: { ...fixtures.low.cost, total_cost_usd: 3.41 } }, { POLISH_STYLE: 'cyberpunk', COLUMNS: '220' }, dir).out);
  check('cyberpunk: net traffic strip', line.includes('NET '));
  check('cyberpunk: daemon chip', /DAEMON·reviewer 2m/.test(line));
  check('cyberpunk: rep with streak', line.includes('REP 340 LV2 4d'));
  check('cyberpunk: calm line, no LOC or session ID', !line.includes(' LOC') && !line.includes('ID:'));
  check('cyberpunk: live ticker', /\/\/ (signal stable|uplink secure|packets flowing|daemons humming)/.test(line));
}
check('cockpit: LIVE and call count', withState('cockpit').includes('● LIVE') && withState('cockpit').includes('CALLS 42'));
check('classic: failure segment', withState('classic').includes('last call failed'));
check('minimal: failure alert', withState('minimal').includes('last call failed'));
check('minimal: calm is dim', run(fixtures.low, { POLISH_STYLE: 'minimal' }).out.startsWith('\x1b[2m'));
writeFileSync(join(stateDir, 'state.json'), JSON.stringify({ lastToolFailed: true, at: Date.now() - 11 * 60 * 1000 }));
check('stale failure ignored', !withState('classic').includes('failed'));

// ---------- history: sparkline and forecast ----------
const histDir = mkdtempSync(join(tmpdir(), 'polish-'));
const t0 = Date.now() - 20 * 60000;
writeFileSync(join(histDir, 'cache.json'), JSON.stringify({
  history: { low: { at: Date.now(), s: [0, 5, 10, 15].map((m, i) => [t0 + m * 60000, 10 + i * 8, 3 + i * 6]) } },
}));
const forecastLine = strip(run({ ...fixtures.low, context_window: { used_percentage: 40 }, rate_limits: { five_hour: { used_percentage: 30, resets_at: now + 17100 } } }, { POLISH_STYLE: 'cockpit', COLUMNS: '160' }, histDir).out);
check('cockpit: braille trend line', /[⡀-⣿]/.test(forecastLine));
check('cockpit: context forecast', /full in ~\d/.test(forecastLine));
check('cockpit: usage forecast', /limit ~\d{1,2}:\d\d [AP]M \(|lasts to reset/.test(forecastLine));

// ---------- efficiency chips: cache, budget, pacing ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'polish-'));
  const hitsAt = Date.now() + 40 * 60000;
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    updated: Date.now(),
    today: { usd: 17.5 },
    budget: { usdPerDay: 20 },
    pace: { kind: 'five_hour', hitsAt, resetsAt: Date.now() + 3 * 3600000 },
  }));
  const withCache = { ...fixtures.low, prompt_cache: { hit_ratio: 0.993 } };
  const clock = /\d{1,2}:\d\d [AP]M/;
  for (const style of STYLES) {
    for (const columns of [120, 70]) {
      const out = run(withCache, { POLISH_STYLE: style, COLUMNS: String(columns) }, dir).out;
      const lines = out.split('\n').filter(Boolean);
      if (!['classic', 'minimal'].includes(style)) {
        for (const line of lines) check(`${style}/${columns}c chips fit (${cells(line)})`, cells(line) <= columns - 6);
      }
      const plain = strip(out);
      // the limit warning survives even at 70 columns
      check(`${style}/${columns}c pace warning`, clock.test(plain));
    }
    // the low-priority chips give way on narrow terminals; on a wide one they all show
    if (style !== 'minimal') {
      const wide = strip(run(withCache, { POLISH_STYLE: style, COLUMNS: '180' }, dir).out);
      check(`${style} budget chip`, /17\.50\/\$?20/.test(wide));
      if (style !== 'cyberpunk') check(`${style} cache chip`, /(cache|CACHE) 99%/.test(wide));
    }
  }
  check('cyberpunk: ICE BREACH wording', strip(run(withCache, { POLISH_STYLE: 'cyberpunk', COLUMNS: '160' }, dir).out).includes('ICE BREACH @ '));
  check('cockpit: pace with clock time on line 2', /limit ~\d{1,2}:\d\d [AP]M \(\d+m\)/.test(strip(run(withCache, { POLISH_STYLE: 'cockpit', COLUMNS: '160' }, dir).out).split('\n')[1] ?? ''));

  // a stale or past forecast shows nothing
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ updated: Date.now(), pace: { kind: 'five_hour', hitsAt: Date.now() - 60000 } }));
  check('past forecast hidden', !clock.test(strip(run(fixtures.low, { POLISH_STYLE: 'neon', COLUMNS: '120' }, dir).out).replace(/↻ \S+/, '')));
}

// ---------- effort level ----------
{
  const withEffort = { ...fixtures.low, effort: { level: 'xhigh' }, fast_mode: true };
  const want = { classic: /xhigh .*FAST/, minimal: /opus 5\.5 xhigh fast/, sky: /xhigh .*FAST/, aurora: /xhigh .*FAST/, cockpit: /EFFORT XHIGH .*FAST/, neon: /xhigh .*FAST/, cyberpunk: /OVERCLOCK XHIGH .*FAST/ };
  for (const style of STYLES) {
    const out = run(withEffort, { POLISH_STYLE: style, COLUMNS: '160' });
    check(`${style}: effort shown`, want[style].test(strip(out.out)));
    if (!['classic', 'minimal'].includes(style)) {
      for (const line of out.out.split('\n').filter(Boolean)) check(`${style}: effort fits at 160`, cells(line) <= 154);
    }
  }
  check('no effort field, no effort chip', !/(high|EFFORT|OVERCLOCK)/.test(strip(run(fixtures.low, { POLISH_STYLE: 'cockpit', COLUMNS: '160' }).out)));
}

console.log(`slowest render: ${slowest}ms`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
