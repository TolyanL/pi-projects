# AGENTS.md

## Project

`pi-projects` is a Pi extension: a projects dock plus private per-project
context and notes kept outside the repository.

- `/projects` opens a dock in Pi's editor slot (inline, `overlay: false`).
- Levels: projects → actions → files. `esc` goes one level up.
- `CONTEXT.md` and `notes.md` live in `~/.pi/agent/pi-projects/<slug>-<id8>/`.
- Project switching uses `ctx.switchSession()`; a project without history gets a
  header-only session file.
- The extension never creates files on its own: missing files are marked
  `not created` and are created only after an explicit confirmation.

## Commands

```bash
node --test test/*.test.ts     # unit tests (no build step)
node --check <file>.ts         # syntax sanity where node supports it
```

PTY tests (offline, need the stub server):

```bash
node spike/stub-server.mjs &                 # 127.0.0.1:8765
python3 spike/tui_dock.py                    # dock lifecycle, files, esc levels
python3 spike/tui_picker.py                  # filter, actions, sessions
python3 spike/tui_m1.py                      # add/switch/AGENTS, no auto-create
python3 spike/tui_installed.py               # loads the installed package
```

`node spike/harness.mjs` and `node spike/render.mjs` cover the M0 mechanics.

## Conventions

- TypeScript ESM, executed directly by Pi (jiti) and by Node's type stripping.
  No build step, no `dist/`.
- Relative imports use explicit `.ts` extensions; types are imported with
  `import type`.
- Pure logic goes in top-level modules and is unit-tested; TUI behaviour is
  covered by the pty scripts in `spike/`.
- Follow Pi's model picker style in the dock: `→` cursor, `✓` current project,
  accent for the selection.
- Status is a single footer line (`ctx.ui.setStatus`); never add a persistent
  overlay over the transcript.
- Private data stays under the agent dir, mode `0600` (files) / `0700` (dirs).

## Do not

- Do not create `CONTEXT.md`, `notes.md` or `AGENTS.md` automatically.
- Do not write private context or notes into the repository.
- Do not reintroduce a left/right overlay panel; the dock belongs in the editor
  slot.
- Do not add model calls to the extension.
