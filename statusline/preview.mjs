// Shows every status line style in colour, with sample data, at the current
// time of day (or at the hour given: node preview.mjs 21).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'statusline.mjs');
const hour = process.argv[2];
const columns = String(process.stdout.columns || 110);
const now = Math.floor(Date.now() / 1000);

// sample session: a little history so trend lines and forecasts show
const dir = mkdtempSync(join(tmpdir(), 'polish-preview-'));
const t0 = Date.now() - 24 * 60000;
writeFileSync(join(dir, 'cache.json'), JSON.stringify({
  history: { preview: { at: Date.now(), s: [0, 4, 8, 12, 16, 20].map((m, i) => [t0 + m * 60000, 12 + i * 5, 10 + i * 5]) } },
}));
writeFileSync(join(dir, 'state.json'), JSON.stringify({ running: true, updated: Date.now(), calls: 42, lastToolFailed: false, at: Date.now() }));

const input = JSON.stringify({
  session_id: 'preview',
  model: { display_name: 'Opus 5.5' },
  workspace: { current_dir: process.cwd() },
  context_window: { used_percentage: 37 },
  rate_limits: { five_hour: { used_percentage: 37, resets_at: now + 3 * 3600 + 53 * 60 } },
  cost: { total_duration_ms: 72 * 60000, total_lines_added: 120, total_lines_removed: 34 },
});

const only = process.argv[3];
for (const style of ['classic', 'minimal', 'sky', 'aurora', 'cockpit', 'neon', 'cyberpunk'].filter(s => !only || s === only)) {
  const r = spawnSync(process.execPath, [script], {
    input,
    encoding: 'utf8',
    env: { ...process.env, POLISH_STYLE: style, POLISH_STATE_DIR: dir, COLUMNS: columns, ...(hour ? { POLISH_HOUR: hour } : {}) },
  });
  console.log(`\x1b[2m/polish ${style}\x1b[0m`);
  process.stdout.write(`${r.stdout}\n`);
}
