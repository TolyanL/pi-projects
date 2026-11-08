# pi-projects

Projects dock, private context and notes for the [pi coding agent](https://pi.dev).

One pi process, many repositories. Each project keeps its own pi session, so
switching projects re-roots tools, `AGENTS.md`, `.pi` config, skills and MCP
servers — without restarting pi. Private context and agent notes live outside
the repository.

```
┌ Projects ─────────────────────────────────────── 1/2 ┐
│ /                                                    │
├──────────────────────────────────────────────────────┤
│ →   beta    ~/Projects/beta          2m · 4 sess     │
│   ✓ alpha   ~/Projects/alpha         3d · 1 sess     │
│   + Add project…                                     │
├──────────────────────────────────────────────────────┤
│ ↑↓ move · enter select · esc close                   │
└──────────────────────────────────────────────────────┘
```

Enter on a project opens its actions — everything is a row in the UI, no
control-key combos:

```
┌ Project actions ──────────────────────────── beta ┐
│ → Open project (last session)                     │
│   New session                                     │
│   Open in a new terminal tab                      │
│   Sessions…                                       │
│   Files…                                          │
│   Rename project…                                 │
│   Remove from list…                               │
├───────────────────────────────────────────────────┤
│ ↑↓ move · enter select · esc back to projects     │
└───────────────────────────────────────────────────┘
```

Selection copies pi's `/model` picker: `→` marks the cursor row, `✓` marks the
current project, the selected label is accent-colored. `Files…` opens
`notes.md` / `CONTEXT.md` / `AGENTS.md`; after saving or cancelling the editor
you land back in the files menu. `esc` goes one level up (files → actions →
projects → editor), never straight out from a submenu.

`/projects` opens a dock in pi's editor slot — the same idiom
[rpiv-ask-user-question](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
uses. The transcript stays above and scrollable, the dock takes the bottom rows
while it is open, and `esc` gives the editor back. **Nothing is drawn when the
dock is closed**, so it can never cover the conversation.

The footer always shows where you are:

```
▸ pi-extensions · 2m · 4 sess
```

- `▸` active project (the cwd of the current session)
- `●` agent is working, `⚙2` async subagents are running
- `!` the last run failed, `→ name` a queued switch

## Install

Local checkout (the extension is a pi package):

```bash
pi install /path/to/pi-projects
# or only for one project:
pi install -l /path/to/pi-projects
```

Reload a running pi with `/reload`.

## Commands

| Command | What it does |
|---|---|
| `/projects` | Open the dock: switch, add, remove, status |
| `/projects add [path]` | Register a directory (defaults to the current cwd) and optionally open it |
| `/projects remove [name]` | Remove from the list; files on disk and notes are kept |
| `/projects new <name>` | Open a project with a fresh session |
| `/projects status` | Active project, paths, sizes, session count |
| `/projects panel` | Alias for `/projects` (opens the dock) |
| `/project` | Open the files menu for the current project (notes / context / AGENTS) |
| `/project notes` | Edit `notes.md` directly |
| `/project context` | Edit `CONTEXT.md` |
| `/project agents` | Edit the repository's `AGENTS.md` |
| `/project show` | Section map of `notes.md` (line numbers) |
| `ctrl+shift+p` | Open the dock (falls back to `ctrl+shift+o`) |

### Dock keys

| Key | Action |
|---|---|
| type | fuzzy filter over project name and path (projects level) |
| `↑`/`↓`, `pgUp`/`pgDn` | move |
| `enter` | open the project's actions / run the highlighted action / open the file |
| `esc` | one level up: files → actions → projects → close |

Every action is a selectable row: open, new session, new terminal tab, sessions,
files, add, rename, remove.

## Switching projects

`switchSession` re-creates pi's runtime with the cwd stored in the target
session's header. Everything project-bound reloads: file tools, bash, `AGENTS.md`
from the new directory and its parents, `.pi/settings.json`, skills, MCP servers,
project trust.

- A project with no history gets a header-only session file, so the first switch
  works immediately.
- The last session of the project is resumed; `/projects new <name>` starts a
  fresh one.
- The editor draft is saved per project and restored on switch.
- While the agent is working, pi must abort the run to switch. The dialog offers:
  **open in a new terminal tab** (keeps the current run), **wait then switch**,
  **interrupt and switch**, or cancel. The new-tab launcher knows tmux, WezTerm,
  kitty, Windows Terminal, iTerm2 and Terminal.app; otherwise it shows a
  `cd <path> && pi` command to run manually.

## Private files

```
~/.pi/agent/pi-projects/
  registry.json              project list
  config.json                context/notes settings
  drafts.json                unsent editor text per project
  <slug>-<id8>/
    CONTEXT.md               private context, injected into every request
    notes.md                 agent notes, compact summary injected
    archive/YYYY-MM.md       rotated old log entries
```

- Files are `0600`, directories `0700`, writes are atomic (tmp + rename).
- `AGENTS.md` stays in the repository (shared with the team); `CONTEXT.md` is the
  personal layer that never enters the repo.
- **Nothing is created automatically.** Adding a project or switching to it writes
  no files. In the dock's `Files…` screen missing entries are marked
  `not created`; pressing enter asks for confirmation, creates the template
  and opens the editor. `notes.md` is also created by the first
  `project_notes` write (log/decide/gotcha/open).
- `CONTEXT.md` is injected as the `pi_projects_private` system-prompt section,
  capped at `context.maxChars` (32k). A one-time warning appears above 8k chars.

### notes.md

A strict, machine-managed schema. The agent writes through the `project_notes`
tool; manual edits are allowed and the table of contents is rebuilt on the next
write.

```md
# Notes — pi-extensions

<!-- toc: managed by pi-projects; do not edit by hand -->
- Focus
- Decisions
- Gotchas
- Open
- Log
<!-- /toc -->

## Focus
- ship the picker

## Decisions
- 2026-02-14 panel is always expanded

## Gotchas
- 2026-02-14 switchSession always aborts the run

## Open
- 2026-02-14 language of the UI

## Log

### 2026-02-14
- verified header-only sessions
```

`project_notes` actions: `read` (CONTEXT.md + notes.md + section map), `log`,
`decide`, `gotcha`, `open`, `set_focus`, `search`. The prompt gets `Focus`,
`Decisions`, `Gotchas`, an open-question count and the last few log entries; the
full file is one tool call away. Old log blocks rotate into `archive/` when the
file exceeds `notes.maxLines`.

## Configuration

`~/.pi/agent/pi-projects/config.json` (created on first write):

```json
{
  "context": { "maxChars": 32768, "warnChars": 8192, "promptNotesChars": 4096 },
  "notes": { "maxLines": 200, "tailEntries": 5, "focusLines": 3 },
  "pickerShortcut": "ctrl+shift+p"
}
```

The old `panel` block from earlier versions is ignored and can be deleted.

## Privacy and secrets

`CONTEXT.md` and `notes.md` are never written into the repository. They are,
however, injected into the model context, so their content reaches:

- the session transcript (`~/.pi/agent/sessions/.../*.jsonl`),
- `/export` and `/share`,
- bug reports that include the transcript.

Secrets are allowed, but saving a line that looks like a token, key or password
triggers a warning. Prefer variable names (`$API_KEY`) over values.

## Limits

- The dock replaces the editor while it is open (about 60% of the terminal rows,
  capped at 24). The transcript above keeps its space and stays scrollable; close
  the dock to type to the agent again.
- Switching aborts an active run unless you use the new-tab option.
- Prompt caches are cold after a switch: another system prompt means another
  cache prefix.
- Sessions opened that do not belong to a registered project resolve to the
  "not a project" row; add the directory to see it in the list.

## Development

```bash
cd pi-projects
node --test test/*.test.ts     # pure logic: notes, registry, panel, switch
node spike/harness.mjs         # headless S1/S3/S4 checks (SDK + offline provider)
python3 spike/tui_smoke.py     # M0: overlay + switch + resize, real TUI in a pty
python3 spike/tui_m1.py        # M1: add -> switch -> private context injection
python3 spike/tui_picker.py    # M3: fuzzy dock, files menu, session dock
python3 spike/tui_dock.py      # dock lifecycle: closed at startup, opens, esc closes
# each pty test needs `node spike/stub-server.mjs &` on port 8765
```

`node_modules/@earendil-works/*` symlinks point at the globally installed pi;
they are development-only and gitignored.

## Roadmap

- Heartbeat files so the panel can show agents running in other terminal tabs.
- Cross-project search over sessions and notes.
- Per-project model, thinking level and skills.
