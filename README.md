# cc-cyberpunk-plugin

A cyberpunk HUD for Claude Code. It restyles the status line, adds a live activity line under Claude's spinner, turns tool calls into a neon ops log, and adds side panes for your session, notes and efficiency, all switchable between seven looks.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install cc-cyberpunk-plugin --marketplace Shashwat1024/cc-cyberpunk-plugin
```

Answer `y` to add the marketplace, then pick a scope (user is the usual choice).

From a shell instead:

```
claude plugin install cc-cyberpunk-plugin --marketplace Shashwat1024/cc-cyberpunk-plugin
```

Then turn on the status line (a plugin can't set it by itself):

```
/polish install
```

This copies the status line script to `~/.claude/cc-cyberpunk/` and points `statusLine` in your `~/.claude/settings.json` at it. Your previous status line is saved, and `/polish uninstall` puts it back. The script needs Node.js on your `PATH`.

## Commands

| Command | What it does |
| --- | --- |
| `/polish <style>` | Status line style: `classic`, `minimal`, `sky`, `aurora`, `cockpit`, `neon`, `cyberpunk`. `/polish next` cycles; the panes, spinner and tool rows follow the style. |
| `/overview` | Session pane (the cyberdeck under the cyberpunk style): context, rep, agents, a timeline of tool calls, most-edited files. |
| `/scratch` | A notes pane kept across sessions; press a note to copy it. |
| `/efficiency` | Pacing to your usage limits, spend per turn/hour/commit, cache hit rate and savings, context hogs, slowest tools, a 12-week activity heatmap. |
| `/budget` | `/budget $20` (daily, estimated at API prices), `/budget 5h 80%`, `/budget 7d 90%`, `/budget off`. |
| `/look <name>` | Desktop and mobile app theme: `paper`, `midnight`, `nord`, `cyberpunk`, `off`. |

## What you get

- **Status line:** model and effort level, folder, git, context and usage meters, braille trend lines, burn-rate forecasts ("limit at ~3:40 PM"), cache and budget chips. The cyberpunk style adds a NET traffic strip, daemon chips for background agents, street rep and a status ticker.
- **Working line:** a comet under Claude's spinner, coloured by what Claude is doing.
- **Tool rows:** icons or neon `RD/` `WR/` `EX/` tags, duration, `+N −M` and exit-code chips.
- **Around the prompt:** typing tips, a recap after each turn, a `MODE//AUTO` tag and a job-complete card under the cyberpunk style.
- **Toasts:** a done toast for long turns, a context warning at 80%, budget and pacing alerts.
- **Street rep:** points for finished jobs, edits, commands and commits, with levels and a daily streak.

Cost figures are estimates at Anthropic's API prices; on a subscription they are not a bill.

## Development

```
claude plugin validate .
claude plugin test .
node statusline/test-statusline.mjs
node statusline/preview.mjs        # every style in colour
```

## License

MIT
