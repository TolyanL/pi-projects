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
│   Protection: shared                              │
├───────────────────────────────────────────────────┤
│ ↑↓ move · enter select · esc back to projects     │
└───────────────────────────────────────────────────┘
```

Selection copies pi's `/model` picker: `→` marks the cursor row, `✓` marks the
current project, the selected label is accent-colored. `Files…` opens
`CONTEXT.md` / `NOTES.md` / `Notes…` / `AGENTS.md`; after saving or
cancelling the editor you land back in the files menu. `esc` goes one level up (files → actions →
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
| `/project notes` | Notes browser: open, edit, create notes |
| `/project context` | Edit `CONTEXT.md` |
| `/project agents` | Edit the repository's `AGENTS.md` |
| `/project index` | View the generated `NOTES.md` |
| `/project show` | List notes with descriptions and paths |
| `ctrl+shift+p` | Open the dock (falls back to `ctrl+shift+o`) |

### Dock keys

| Key | Action |
|---|---|
| type | fuzzy filter over project name and path (projects level) |
| `↑`/`↓`, `pgUp`/`pgDn` | move |
| `enter` | open the project's actions / run the highlighted action / open the file |
| `esc` | one level up: notes → files → actions → projects → close |

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

## Storage layout

Default root is `~/.pi/agent/pi-projects`; change it with `storage.root` in the
config (absolute, `~/...`, or relative to `<agent-dir>/pi-projects`).

```
<root>/
  registry.json              project list
  drafts.json                unsent editor text per project
  INDEX.md                   generated index across every project
  <slug>-<id8>/
    CONTEXT.md               private context, injected into every request
    NOTES.md                 generated index of this project's notes
    notes/
      how-auth-works.md      one note per file
      header-only-sessions.md
```

- Files are `0600`, directories `0700`, writes are atomic (tmp + rename).
- `config.json` always stays in `<agent-dir>/pi-projects/`, even when the data
  root is moved.
- `AGENTS.md` stays in the repository (shared with the team); `CONTEXT.md` and
  notes never enter the repo.
- **Nothing is created automatically.** Adding a project or switching to it
  writes no files. In the dock's `Files…` screen missing entries are marked
  `not created`; pressing enter asks for confirmation, creates the template and
  opens the editor.

### Notes

Each note is a markdown file in `notes/` with frontmatter:

```md
---
title: How auth works
description: Token refresh and middleware order
created: 2026-02-14
updated: 2026-02-14
---

# How auth works

Details live here.
```

Both indexes are **generated** by scanning `notes/*.md`, so hand-written files
show up too:

`NOTES.md` (per project):

```md
- **How auth works** — Token refresh and middleware order — `notes/how-auth-works.md`
```

`INDEX.md` (all shared projects, one heading per project; projects marked
private are skipped):

```md
## pi-extensions
- **How auth works** — Token refresh and middleware order — `pi-extensions-18a5b3ed/notes/how-auth-works.md`
```

The system prompt receives `CONTEXT.md` plus the first `notes.promptEntries`
index entries (title, description, path). Full notes are one tool call away.

### Tools

| Tool | What it does |
|---|---|
| `project_notes` | `list` (current project index), `read` (by file or title), `write` (title + description + content; replaces a note with the same title), `append`, `search` |
| `all_project_notes` | The generated cross-project `INDEX.md`: titles, descriptions and paths of every note in every shared project |

```
/project              files menu: CONTEXT.md / NOTES.md / Notes… / AGENTS.md
/project notes        notes browser: open, edit, create
/project context      edit CONTEXT.md
/project agents       edit the repository's AGENTS.md
/project index        view the generated NOTES.md (edits are discarded)
/project status       paths, counts, storage root
/project show         note list with paths
```

The old strict-schema `notes.md` (Focus/Decisions/Log) is deleted on startup;
it is replaced by `notes/` and the generated indexes.

### Project protection

In a project's actions, `Protection: shared` toggles to `Protection: private`.
A private project:

- is marked `🔒` in the project list;
- is excluded from the global `INDEX.md` and from `all_project_notes`;
- keeps its own `NOTES.md`, `notes/`, `CONTEXT.md` and prompt injection intact.

Files are not encrypted and stay readable on disk; this hides the project from
cross-project lists only.

## Configuration

`~/.pi/agent/pi-projects/config.json` (created on first write):

```json
{
  "storage": { "root": "" },
  "context": { "maxChars": 32768, "warnChars": 8192 },
  "notes": { "promptEntries": 12, "promptChars": 4096, "maxNoteChars": 200000 },
  "pickerShortcut": "ctrl+shift+p"
}
```

`storage.root`: empty means `~/.pi/agent/pi-projects`; accepts `~/...` and
relative paths (resolved from `<agent-dir>/pi-projects`). Change it, then
`/reload`: existing projects are not moved automatically.


The old `panel` block from earlier versions is ignored and can be deleted.

## Privacy and secrets

`CONTEXT.md` and note files are never written into the repository. They are,
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
