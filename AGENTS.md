# AGENTS.md

## Project

`pi-projects` is a Pi extension: a projects dock plus private per-project
context and notes kept outside the repository.

- `/projects` opens a dock in Pi's editor slot (inline, `overlay: false`).
- Levels: projects → project actions → files → notes. `esc` goes one level up.
- Storage root defaults to `~/.pi/agent/pi-projects` (`storage.root` in
  `config.json`). `config.json` itself always stays in `<agent-dir>/pi-projects`.
- Per project: `CONTEXT.md`, `NOTES.md` (generated index), `notes/*.md`.
  Global: `INDEX.md` (generated index across projects).
- Notes carry frontmatter (`title`, `description`, `created`, `updated`);
  `NOTES.md` and `INDEX.md` are rebuilt by scanning `notes/*.md`.
- Project switching uses `ctx.switchSession()`; a project without history gets a
  header-only session file.
- The extension never creates files on its own: missing entries are marked
  `not created` and are created only after explicit confirmation.
- Projects can be marked `private` (Project actions → Protection). Private
  projects are excluded from `INDEX.md` and `all_project_notes` but keep their
  own notes, context and prompt injection.

## Commands

```bash
node --test test/*.test.ts     # unit tests (no build step)
```

PTY tests (offline, need the stub server):

```bash
node spike/stub-server.mjs &                 # 127.0.0.1:8765
python3 spike/tui_dock.py                    # dock levels, files, notes, esc
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
- Pure logic lives in top-level modules and is unit-tested; TUI behaviour is
  covered by the pty scripts in `spike/`.
- Dock style follows Pi's model picker: `→` cursor, `✓` current project, accent
  for the selection.
- Status is a single footer line (`ctx.ui.setStatus`); never add a persistent
  overlay over the transcript.
- Private data stays under the storage root, mode `0600` (files) / `0700` (dirs).
- `NOTES.md` and `INDEX.md` are generated artifacts: rebuild them from
  `notes/*.md`, never treat them as the source of truth.

## Do not

- Do not create `CONTEXT.md`, `AGENTS.md` or notes automatically.
- Do not write private context or notes into the repository.
- Do not hand-edit `NOTES.md`/`INDEX.md` as storage; changes are discarded.
- Do not reintroduce a left/right overlay panel; the dock belongs in the editor
  slot.
- Do not add model calls to the extension.
