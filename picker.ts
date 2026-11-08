/**
 * Docked project panel.
 *
 * Mounted in pi's editor slot (`ctx.ui.custom(..., { overlay: false })`), the
 * same idiom rpiv-ask-user-question uses: the transcript stays above and
 * scrollable, the dock takes the bottom rows while it is open, and closing it
 * (esc) gives the editor back. Nothing is drawn when the dock is closed.
 *
 * Levels: projects → project actions → files → notes. Selection styling mirrors
 * pi's model picker: `→` cursor, `✓` for the current project, accent selection.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionCommandContext, SessionInfo, Theme } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Deps } from "./deps.ts";
import type { NoteMeta, Project, SessionSummary } from "./types.ts";
import { findByCwd, loadRegistry, setProjectPrivate } from "./registry.ts";
import { loadSessionIndex, listSessionsFor } from "./sessions.ts";
import { countNotes, listNotes, notesIndexPath, rebuildIndexes } from "./notes.ts";
import { projectFileExists } from "./store.ts";
import { fit, formatAge, projectMeta, shortPath } from "./format.ts";

export type EditWhat = "context" | "index" | "agents";

export type DockAction =
  | { kind: "open"; project: Project; mode: "last" | "new" }
  | { kind: "tab"; project: Project }
  | { kind: "sessions"; project: Project }
  | { kind: "edit"; project: Project; what: EditWhat }
  | { kind: "note-open"; project: Project; file: string }
  | { kind: "note-new"; project: Project }
  | { kind: "add" }
  | { kind: "remove"; project: Project }
  | { kind: "rename"; project: Project };

export type PickerAction = DockAction;

export interface DockOpenOptions {
  stage?: "projects" | "project" | "edit" | "notes";
  project?: Project;
  /** Files-only mount: esc from the files level closes the dock. */
  filesOnly?: boolean;
  /** Highlight this note when the dock opens on the notes level. */
  noteFile?: string;
}

export interface FileStatus {
  context: boolean;
  index: boolean;
  agents: boolean;
  count: number;
}

export interface DockState {
  projects: Project[];
  activeId?: string;
  sessions: Map<string, SessionSummary>;
  query: string;
  /** Index in the project list, including the trailing Add row. */
  selected: number;
  stage: "projects" | "project" | "edit" | "notes";
  project?: Project;
  actionSelected: number;
  fileSelected: number;
  noteSelected: number;
  files?: FileStatus;
  noteList?: NoteMeta[];
}

interface ActionSpec {
  id: "open" | "new" | "tab" | "sessions" | "files" | "rename" | "remove" | "privacy";
  label: string;
}

const ACTIONS: ActionSpec[] = [
  { id: "open", label: "Open project (last session)" },
  { id: "new", label: "New session" },
  { id: "tab", label: "Open in a new terminal tab" },
  { id: "sessions", label: "Sessions…" },
  { id: "files", label: "Files…" },
  { id: "rename", label: "Rename project…" },
  { id: "remove", label: "Remove from list…" },
  { id: "privacy", label: "Protection" },
];

const FILE_ROWS: Array<{ what: EditWhat | "notes" | "privacy"; label: string }> = [
  { what: "context", label: "CONTEXT.md" },
  { what: "index", label: "NOTES.md" },
  { what: "agents", label: "AGENTS.md" },
  { what: "privacy", label: "Protection" },
  { what: "notes", label: "Notes…" },
];

const NOTES_FILE_ROW = FILE_ROWS.findIndex((row) => row.what === "notes");

/** Rows the dock may use: about 60% of the terminal, capped and floored. */
export function dockBudget(tui: unknown): number {
  const terminal = (tui as { terminal?: { rows?: number }; rows?: number } | undefined) ?? {};
  const rows = terminal.terminal?.rows ?? terminal.rows ?? process.stdout.rows ?? 24;
  return Math.max(8, Math.min(24, Math.floor(rows * 0.6)));
}

function printableText(data: string): string | undefined {
  if (!data) return undefined;
  const text = decodeKittyPrintable(data) ?? data;
  if (text.startsWith("\x1b")) return undefined;
  if (/[\x00-\x1f\x7f]/.test(text)) return undefined;
  return text;
}

export function filteredProjects(state: DockState): Project[] {
  const query = state.query.trim();
  if (!query) return state.projects;
  return fuzzyFilter(state.projects, query, (project) => `${project.name} ${project.path}`);
}

/** Projects plus the trailing "Add project…" row. */
export function projectRowCount(state: DockState): number {
  return filteredProjects(state).length + 1;
}

export function selectedProject(state: DockState): Project | undefined {
  return filteredProjects(state)[state.selected];
}

export function fileStatusFor(paths: Deps["paths"], project: Project): FileStatus {
  return {
    context: projectFileExists(paths, project, "context"),
    index: existsSync(notesIndexPath(paths, project)),
    agents: projectFileExists(paths, project, "agents"),
    count: countNotes(paths, project),
  };
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function innerWidth(width: number): number {
  return Math.max(10, width - 4);
}

function boxLine(content: string, width: number): string {
  return `│ ${fit(content, innerWidth(width))} │`;
}

function topBorder(title: string, width: number, right = ""): string {
  const label = ` ${title} `;
  const suffix = right ? ` ${right} ` : "";
  const fill = Math.max(0, width - 2 - visibleWidth(label) - visibleWidth(suffix));
  return `┌${label}${"─".repeat(fill)}${suffix}┐`;
}

function separator(width: number): string {
  return `├${"─".repeat(Math.max(0, width - 2))}┤`;
}

function bottom(width: number): string {
  return `└${"─".repeat(Math.max(0, width - 2))}┘`;
}

/** pi's model picker idiom: `→` cursor + `✓` current, accent for the selection. */
function cursor(selected: boolean, theme: Theme): string {
  return selected ? theme.fg("accent", "→ ") : "  ";
}

function currentMark(current: boolean, theme: Theme): string {
  return current ? theme.fg("accent", "✓ ") : "  ";
}

function projectLine(state: DockState, project: Project, selected: boolean, theme: Theme, inner: number): string {
  const active = project.id === state.activeId;
  const lock = project.private ? ` ${theme.fg("warning", "🔒")}` : "";
  const name = `${selected ? theme.fg("accent", project.name) : project.name}${lock}`;
  const path = theme.fg("muted", shortPath(project.path));
  const meta = theme.fg("muted", projectMeta(state.sessions.get(resolve(project.path))));
  const left = `${cursor(selected, theme)}${currentMark(active, theme)}${name} ${path}`;
  const leftWidth = Math.max(1, inner - visibleWidth(meta) - 1);
  const clipped = truncateToWidth(left, leftWidth, "…");
  const gap = Math.max(1, inner - visibleWidth(clipped) - visibleWidth(meta));
  return `${clipped}${" ".repeat(gap)}${meta}`;
}

function labeledRow(label: string, hint: string, selected: boolean, theme: Theme, inner: number): string {
  const left = `${cursor(selected, theme)}${selected ? theme.fg("accent", label) : label}`;
  const leftWidth = Math.max(1, inner - visibleWidth(hint) - 1);
  const clipped = truncateToWidth(left, leftWidth, "…");
  const gap = Math.max(1, inner - visibleWidth(clipped) - visibleWidth(hint));
  return `${clipped}${" ".repeat(gap)}${hint}`;
}

function windowStart(count: number, selected: number, visible: number): number {
  if (count <= visible) return 0;
  return Math.max(0, Math.min(selected - Math.floor(visible / 2), count - visible));
}

function fileHint(state: DockState, what: EditWhat | "notes" | "privacy"): string {
  const files = state.files;
  if (what === "privacy") {
    return state.project?.private
      ? "hidden from INDEX.md and all_project_notes"
      : "included in INDEX.md and all_project_notes";
  }
  if (what === "context") {
    return files?.context ? "private context, injected into every request" : "not created";
  }
  if (what === "agents") {
    return files?.agents ? "repository instructions (shared, in git)" : "not created";
  }
  if (what === "index") {
    if (!files || files.count === 0) return files?.index ? "empty index" : "no notes yet";
    return `${files.count} note${files.count === 1 ? "" : "s"} · generated index`;
  }
  return files && files.count > 0
    ? `${files.count} note${files.count === 1 ? "" : "s"} · browse, open, create`
    : "browse, create notes";
}

export function renderDock(state: DockState, width: number, budget: number, theme: Theme): string[] {
  if (width < 30) return [truncateToWidth("Projects", width)];
  const lines: string[] = [];
  const inner = innerWidth(width);

  if (state.stage === "edit" && state.project) {
    lines.push(topBorder("Project files", width, state.project.name));
    FILE_ROWS.forEach((row, index) => {
      const selected = index === state.fileSelected;
      const label =
        row.what === "privacy"
          ? `Protection: ${state.project?.private ? "private" : "shared"}`
          : row.label;
      lines.push(
        boxLine(labeledRow(label, theme.fg("muted", fileHint(state, row.what)), selected, theme, inner), width),
      );
    });
    lines.push(separator(width));
    lines.push(boxLine(theme.fg("muted", "↑↓ move · enter open · esc back to project"), width));
    lines.push(bottom(width));
    return lines;
  }

  if (state.stage === "notes" && state.project) {
    const notes = state.noteList ?? [];
    const rows = 1 + notes.length;
    lines.push(topBorder("Notes", width, `${state.project.name} · ${notes.length}`));
    const itemRows = Math.max(1, budget - 6);
    const start = windowStart(rows, state.noteSelected, itemRows);
    const end = Math.min(rows, start + itemRows);
    for (let index = start; index < end; index += 1) {
      if (index === 0) {
        const selected = state.noteSelected === 0;
        const label = selected ? theme.fg("accent", "＋ New note…") : "＋ New note…";
        lines.push(boxLine(`${cursor(selected, theme)}${label}`, width));
        continue;
      }
      const note = notes[index - 1];
      const selected = index === state.noteSelected;
      const title = selected ? theme.fg("accent", note.title) : note.title;
      const description = theme.fg("muted", note.description);
      const gap = theme.fg("muted", " · ");
      const meta = theme.fg("muted", `notes/${note.file}${note.updated ? ` · ${note.updated}` : ""}`);
      const left = `${cursor(selected, theme)}${title}${note.description ? `${gap}${description}` : ""}`;
      const leftWidth = Math.max(1, inner - visibleWidth(meta) - 1);
      const clipped = truncateToWidth(left, leftWidth, "…");
      const spaces = Math.max(1, inner - visibleWidth(clipped) - visibleWidth(meta));
      lines.push(boxLine(`${clipped}${" ".repeat(spaces)}${meta}`, width));
    }
    if (notes.length === 0) {
      lines.push(boxLine(theme.fg("muted", "No notes yet — create the first one"), width));
    }
    lines.push(separator(width));
    lines.push(boxLine(theme.fg("muted", "↑↓ move · enter open · esc back to files"), width));
    lines.push(bottom(width));
    return lines;
  }

  if (state.stage === "project" && state.project) {
    lines.push(
      topBorder(
        "Project actions",
        width,
        `${state.project.name}${state.project.private ? " 🔒" : ""}`,
      ),
    );
    const itemRows = Math.max(1, budget - 5);
    const start = windowStart(ACTIONS.length, state.actionSelected, itemRows);
    ACTIONS.slice(start, start + itemRows).forEach((action, offset) => {
      const selected = start + offset === state.actionSelected;
      const text =
        action.id === "privacy"
          ? `Protection: ${state.project?.private ? "private (hidden from global index)" : "shared"}`
          : action.label;
      const label = selected ? theme.fg("accent", text) : text;
      lines.push(boxLine(`${cursor(selected, theme)}${label}`, width));
    });
    lines.push(separator(width));
    lines.push(boxLine(theme.fg("muted", "↑↓ move · enter select · esc back to projects"), width));
    lines.push(bottom(width));
    return lines;
  }

  const projects = filteredProjects(state);
  lines.push(
    topBorder("Projects", width, projects.length > 0 ? `${Math.min(state.selected + 1, projects.length)}/${projects.length}` : ""),
  );
  lines.push(boxLine(`${theme.fg("accent", "/")} ${state.query}${state.query ? "▏" : ""}`, width));
  lines.push(separator(width));

  const rows = projects.length + 1;
  const itemRows = Math.max(1, budget - 6);
  const start = windowStart(rows, state.selected, itemRows);
  const end = Math.min(rows, start + itemRows);
  if (projects.length === 0) {
    lines.push(
      boxLine(
        theme.fg("muted", state.projects.length === 0 ? "No projects yet" : "No matching projects"),
        width,
      ),
    );
  }
  for (let index = start; index < end; index += 1) {
    if (index < projects.length) {
      const project = projects[index];
      lines.push(boxLine(projectLine(state, project, index === state.selected, theme, inner), width));
    } else {
      const selected = index === state.selected;
      const label = selected ? theme.fg("accent", "+ Add project…") : "+ Add project…";
      lines.push(boxLine(`${cursor(selected, theme)}${label}`, width));
    }
  }
  lines.push(separator(width));
  lines.push(boxLine(theme.fg("muted", "↑↓ move · enter select · esc close"), width));
  lines.push(bottom(width));
  return lines;
}

// ---------------------------------------------------------------------------
// mount helper
// ---------------------------------------------------------------------------

interface DockComponent {
  render: (width: number) => string[];
  handleInput: (data: string) => void;
  invalidate: () => void;
}

function mountDock<T>(
  ctx: ExtensionCommandContext,
  factory: (tui: unknown, theme: Theme, done: (value: T | undefined) => void) => DockComponent,
): Promise<T | undefined> {
  // Inline (editor slot) like rpiv-ask-user-question: the transcript keeps its
  // space and scrolling; nothing is painted over it while the dock is closed.
  return ctx.ui.custom<T | undefined>(
    (tui, theme, _keybindings, done) => factory(tui, theme, (value) => done(value)),
    { overlay: false },
  );
}

// ---------------------------------------------------------------------------
// project dock
// ---------------------------------------------------------------------------

export async function runProjectDock(
  ctx: ExtensionCommandContext,
  deps: Deps,
  options: DockOpenOptions = {},
): Promise<DockAction | undefined> {
  const registry = loadRegistry(deps.paths);
  const active = findByCwd(registry, ctx.cwd);
  const projects = [...registry.projects].sort((a, b) => {
    if (a.id === active?.id) return -1;
    if (b.id === active?.id) return 1;
    return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
  });
  const sessions = await loadSessionIndex(projects, ctx.sessionManager.getSessionDir(), ctx.cwd);
  const target =
    projects.find((project) => project.id === options.project?.id) ??
    projects.find((project) => project.id === active?.id) ??
    projects[0];
  const stage = options.stage ?? "projects";
  const state: DockState = {
    projects,
    activeId: active?.id,
    sessions: sessions.byPath,
    query: "",
    selected: 0,
    stage: stage === "projects" ? "projects" : stage,
    project: stage === "projects" ? undefined : target,
    actionSelected: 0,
    fileSelected: 0,
    noteSelected: 0,
  };
  if (state.stage === "projects" && target) {
    const index = projects.findIndex((project) => project.id === target.id);
    state.selected = index >= 0 ? index : 0;
  }
  if (target) {
    state.files = fileStatusFor(deps.paths, target);
    if (state.stage === "notes") {
      state.noteList = listNotes(deps.paths, target);
      const index = options.noteFile
        ? state.noteList.findIndex((note) => note.file === options.noteFile)
        : -1;
      state.noteSelected = index >= 0 ? index + 1 : 0;
    }
  }

  const filesOnly = options.filesOnly === true;
  return mountDock<DockAction>(ctx, (tui, theme, done) => {
    const budget = dockBudget(tui);
    const rerender = () => (tui as { requestRender: () => void }).requestRender();

    const refreshNotes = () => {
      if (!state.project) return;
      state.files = fileStatusFor(deps.paths, state.project);
      state.noteList = listNotes(deps.paths, state.project);
    };

    const togglePrivacy = () => {
      const project = state.project;
      if (!project) return;
      const next = !project.private;
      setProjectPrivate(deps.paths, project.id, next);
      project.private = next;
      const listed = state.projects.find((entry) => entry.id === project.id);
      if (listed) listed.private = next;
      rebuildIndexes(deps.paths);
      state.files = fileStatusFor(deps.paths, project);
      rerender();
    };

    const runAction = (action: ActionSpec) => {
      const project = state.project;
      if (!project) return;
      if (action.id === "files") {
        state.stage = "edit";
        state.fileSelected = 0;
        state.files = fileStatusFor(deps.paths, project);
        rerender();
        return;
      }
      if (action.id === "privacy") {
        togglePrivacy();
        return;
      }
      if (action.id === "open") done({ kind: "open", project, mode: "last" });
      else if (action.id === "new") done({ kind: "open", project, mode: "new" });
      else if (action.id === "tab") done({ kind: "tab", project });
      else if (action.id === "sessions") done({ kind: "sessions", project });
      else if (action.id === "rename") done({ kind: "rename", project });
      else if (action.id === "remove") done({ kind: "remove", project });
    };

    const activateFileRow = () => {
      const row = FILE_ROWS[state.fileSelected];
      if (!row || !state.project) return;
      if (row.what === "notes") {
        state.stage = "notes";
        state.noteSelected = 0;
        refreshNotes();
        rerender();
        return;
      }
      if (row.what === "privacy") {
        togglePrivacy();
        return;
      }
      done({ kind: "edit", project: state.project, what: row.what });
    };

    const activateNote = () => {
      if (!state.project) return;
      if (state.noteSelected === 0) {
        done({ kind: "note-new", project: state.project });
        return;
      }
      const note = state.noteList?.[state.noteSelected - 1];
      if (note) done({ kind: "note-open", project: state.project, file: note.file });
    };

    return {
      render: (width: number) => renderDock(state, width, budget, theme),
      invalidate: () => {},
      handleInput: (data: string) => {
        if (matchesKey(data, "ctrl+c")) {
          done(undefined);
          return;
        }
        if (matchesKey(data, "escape")) {
          if (state.stage === "notes") {
            state.stage = "edit";
            state.fileSelected = NOTES_FILE_ROW;
            refreshNotes();
            rerender();
            return;
          }
          if (state.stage === "edit") {
            if (filesOnly) {
              done(undefined);
              return;
            }
            state.stage = "project";
            state.actionSelected = ACTIONS.findIndex((action) => action.id === "files");
            rerender();
            return;
          }
          if (state.stage === "project") {
            state.stage = "projects";
            const index = filteredProjects(state).findIndex(
              (project) => project.id === state.project?.id,
            );
            state.selected = index >= 0 ? index : 0;
            rerender();
            return;
          }
          done(undefined);
          return;
        }

        if (state.stage === "notes") {
          const count = (state.noteList?.length ?? 0) + 1;
          if (matchesKey(data, "up")) {
            state.noteSelected = (state.noteSelected - 1 + count) % count;
            rerender();
          } else if (matchesKey(data, "down")) {
            state.noteSelected = (state.noteSelected + 1) % count;
            rerender();
          } else if (matchesKey(data, "return")) {
            activateNote();
          }
          return;
        }

        if (state.stage === "edit") {
          if (matchesKey(data, "up")) {
            state.fileSelected = (state.fileSelected - 1 + FILE_ROWS.length) % FILE_ROWS.length;
            rerender();
          } else if (matchesKey(data, "down")) {
            state.fileSelected = (state.fileSelected + 1) % FILE_ROWS.length;
            rerender();
          } else if (matchesKey(data, "return")) {
            activateFileRow();
          }
          return;
        }

        if (state.stage === "project") {
          if (matchesKey(data, "up")) {
            state.actionSelected = (state.actionSelected - 1 + ACTIONS.length) % ACTIONS.length;
            rerender();
          } else if (matchesKey(data, "down")) {
            state.actionSelected = (state.actionSelected + 1) % ACTIONS.length;
            rerender();
          } else if (matchesKey(data, "return")) {
            const action = ACTIONS[state.actionSelected];
            if (action) runAction(action);
          }
          return;
        }

        // stage === "projects"
        if (matchesKey(data, "up")) {
          state.selected = (state.selected - 1 + projectRowCount(state)) % projectRowCount(state);
          rerender();
          return;
        }
        if (matchesKey(data, "down")) {
          state.selected = (state.selected + 1) % projectRowCount(state);
          rerender();
          return;
        }
        if (matchesKey(data, "pageUp")) {
          state.selected = Math.max(0, state.selected - 10);
          rerender();
          return;
        }
        if (matchesKey(data, "pageDown")) {
          state.selected = Math.min(projectRowCount(state) - 1, state.selected + 10);
          rerender();
          return;
        }
        if (matchesKey(data, "return")) {
          const project = selectedProject(state);
          if (project) {
            state.project = project;
            state.stage = "project";
            state.actionSelected = 0;
            state.files = fileStatusFor(deps.paths, project);
            rerender();
          } else {
            done({ kind: "add" });
          }
          return;
        }
        if (matchesKey(data, "backspace")) {
          state.query = state.query.slice(0, -1);
          state.selected = 0;
          rerender();
          return;
        }
        const text = printableText(data);
        if (text) {
          state.query += text;
          state.selected = 0;
          rerender();
        }
      },
    };
  });
}

// ---------------------------------------------------------------------------
// session dock
// ---------------------------------------------------------------------------

export interface SessionChoice {
  path?: string;
  createNew?: boolean;
}

export async function runSessionDock(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
): Promise<SessionChoice | undefined> {
  const sessions = await listSessionsFor(ctx, project.path);
  const currentFile = ctx.sessionManager.getSessionFile();
  const items = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());
  const state = { query: "", selected: items.length > 0 ? 0 : -1 };

  return mountDock<SessionChoice>(ctx, (tui, theme, done) => {
    const budget = dockBudget(tui);
    const filtered = () =>
      state.query.trim()
        ? fuzzyFilter(items, state.query, (info: SessionInfo) => `${info.name ?? ""} ${info.firstMessage}`)
        : items;
    const clampSelection = () => {
      const count = filtered().length;
      state.selected = count === 0 ? -1 : Math.max(0, Math.min(state.selected, count - 1));
    };
    const render = (width: number): string[] => {
      if (width < 30) return [truncateToWidth("Sessions", width)];
      const inner = innerWidth(width);
      const lines: string[] = [];
      lines.push(topBorder(`Sessions — ${project.name}`, width, `${filtered().length}`));
      lines.push(boxLine(`${theme.fg("accent", "/")} ${state.query}${state.query ? "▏" : ""}`, width));
      lines.push(separator(width));
      const itemRows = Math.max(1, budget - 6);
      const start = windowStart(filtered().length, Math.max(0, state.selected), itemRows);
      const list = filtered().slice(start, start + itemRows);
      if (filtered().length === 0) {
        lines.push(boxLine(theme.fg("muted", "  No sessions yet — enter creates one"), width));
      }
      list.forEach((info: SessionInfo, offset: number) => {
        const index = start + offset;
        const selected = index === state.selected;
        const isCurrent = info.path === currentFile;
        const label = info.name?.trim() || info.firstMessage.trim() || "(empty session)";
        const left = `${cursor(selected, theme)}${currentMark(isCurrent, theme)}${
          selected ? theme.fg("accent", label) : label
        }`;
        const right = theme.fg(
          "muted",
          `${formatAge(info.modified.getTime()) ?? "?"} · ${info.messageCount} msg${
            isCurrent ? " · current" : ""
          }`,
        );
        const leftWidth = Math.max(1, inner - visibleWidth(right) - 1);
        const clipped = truncateToWidth(left, leftWidth, "…");
        const gap = Math.max(1, inner - visibleWidth(clipped) - visibleWidth(right));
        lines.push(boxLine(`${clipped}${" ".repeat(gap)}${right}`, width));
      });
      lines.push(separator(width));
      lines.push(boxLine(theme.fg("muted", "↑↓ move · enter open · esc back to project"), width));
      lines.push(bottom(width));
      return lines;
    };
    return {
      render,
      invalidate: () => {},
      handleInput: (data: string) => {
        const rerender = () => {
          clampSelection();
          (tui as { requestRender: () => void }).requestRender();
        };
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return done(undefined);
        if (matchesKey(data, "up")) {
          state.selected = Math.max(0, state.selected - 1);
          return rerender();
        }
        if (matchesKey(data, "down")) {
          state.selected += 1;
          return rerender();
        }
        if (matchesKey(data, "return")) {
          const info = filtered()[state.selected];
          return done(info ? { path: info.path } : { createNew: true });
        }
        if (matchesKey(data, "backspace")) {
          state.query = state.query.slice(0, -1);
          state.selected = 0;
          return rerender();
        }
        const text = printableText(data);
        if (text) {
          state.query += text;
          state.selected = 0;
          rerender();
        }
      },
    };
  });
}

/** Exported for tests. */
export function dockProjectCount(state: DockState): number {
  return filteredProjects(state).length;
}

export type { SessionInfo };
