/** Slash commands for projects, private files and the dock. */

import { join, resolve } from "node:path";
import type { ExtensionCommandContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deps } from "./deps.ts";
import type { Project } from "./types.ts";
import {
  addProject,
  findByCwd,
  loadRegistry,
  projectDir,
  removeProject,
  renameProject,
  touchProject,
} from "./registry.ts";
import {
  createProjectFile,
  detectSecret,
  loadNotes,
  notesStats,
  parseNotes,
  projectFileExists,
  projectFilePath,
  readContext,
  readNotesText,
  writeContext,
  writeNotes,
  type ProjectFile,
} from "./store.ts";
import { applyPending, openProject, switchToSession } from "./switch.ts";
import { shortPath } from "./format.ts";
import { launchInNewTab } from "./launcher.ts";
import {
  runProjectDock,
  runSessionDock,
  type DockAction,
  type DockOpenOptions,
} from "./picker.ts";
import { loadSessionIndex } from "./sessions.ts";

const USAGE =
  "/projects [dock | add <path> | remove <name> | new <name> | status]  ·  /project [notes|context|agents|status|show]";

async function requireProject(
  ctx: ExtensionCommandContext,
  deps: Deps,
): Promise<Project | undefined> {
  const project = findByCwd(loadRegistry(deps.paths), ctx.cwd);
  if (!project) {
    ctx.ui.notify(
      `Current directory is not a project: ${ctx.cwd}\nRun /projects add to register it.`,
      "warning",
    );
    return undefined;
  }
  return project;
}

async function addProjectFlow(
  ctx: ExtensionCommandContext,
  deps: Deps,
  initialPath?: string,
): Promise<boolean> {
  const input = initialPath?.trim() || (await ctx.ui.input("Path to project", ctx.cwd));
  if (!input?.trim()) return false;
  const result = addProject(deps.paths, deps.agentDir, { path: input });
  if (!result.project) {
    ctx.ui.notify(result.error ?? "Could not add project", "error");
    return false;
  }
  const project = result.project;
  touchProject(deps.paths, project.id);
  deps.status.refresh(ctx);
  ctx.ui.notify(
    `Added ${project.name}\nPrivate files: ${projectDir(deps.paths, project)}`,
    "info",
  );
  if (ctx.hasUI && (await ctx.ui.confirm("Open project?", `Switch to ${project.name} now?`))) {
    await openProject(ctx, deps, project, "last");
    return true;
  }
  return false;
}

async function removeProjectFlow(
  ctx: ExtensionCommandContext,
  deps: Deps,
  needle?: string,
): Promise<void> {
  const registry = loadRegistry(deps.paths);
  if (registry.projects.length === 0) {
    ctx.ui.notify("No projects registered", "info");
    return;
  }
  let target: Project | undefined;
  if (needle?.trim()) {
    const lookup = needle.trim().toLowerCase();
    target = registry.projects.find(
      (project) =>
        project.id === needle.trim() ||
        project.name.toLowerCase() === lookup ||
        project.path === needle.trim(),
    );
  } else if (ctx.hasUI) {
    const choice = await ctx.ui.select(
      "Remove project",
      registry.projects.map((project) => `${project.name} — ${shortPath(project.path)}`),
    );
    if (!choice) return;
    const index = registry.projects.findIndex(
      (project) => `${project.name} — ${shortPath(project.path)}` === choice,
    );
    target = index >= 0 ? registry.projects[index] : undefined;
  }
  if (!target) {
    ctx.ui.notify(`Project not found: ${needle ?? ""}`, "error");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Remove project?",
    `${target.name} will be removed from the list.\nFiles on disk and private notes are kept.`,
  );
  if (!confirmed) return;
  removeProject(deps.paths, target.id);
  deps.status.refresh(ctx);
  ctx.ui.notify(
    `Removed ${target.name}. Private files kept in ${projectDir(deps.paths, target)}`,
    "info",
  );
}

async function status(ctx: ExtensionCommandContext, deps: Deps): Promise<void> {
  const registry = loadRegistry(deps.paths);
  const active = findByCwd(registry, ctx.cwd);
  if (!active) {
    ctx.ui.notify(
      `No active project for ${ctx.cwd}\nRegistered: ${registry.projects.length}\nRun /projects add`,
      "info",
    );
    return;
  }
  const stats = notesStats(deps.paths, active);
  const context = readContext(deps.paths, active).trim().length;
  const sessions = await loadSessionIndex([active], ctx.sessionManager.getSessionDir(), ctx.cwd);
  const summary = sessions.byPath.get(resolve(active.path));
  const lines = [
    `Project:  ${active.name}`,
    `Path:     ${active.path}`,
    `Private:  ${projectDir(deps.paths, active)}`,
    `Context:  ${context} chars`,
    `Notes:    ${stats.lines} lines (${stats.bytes} bytes)`,
    `Sessions: ${summary?.count ?? 0}`,
    `Pending:  ${deps.pending ? "queued switch" : "none"}`,
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

const FILE_LABELS: Record<ProjectFile, string> = {
  notes: "notes.md",
  context: "CONTEXT.md",
  agents: "AGENTS.md",
};

/** Files are never prepared in the background: ask before creating one. */
async function ensureFileForEdit(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
  file: ProjectFile,
): Promise<boolean> {
  if (projectFileExists(deps.paths, project, file)) return true;
  const path = projectFilePath(deps.paths, project, file);
  const confirmed = await ctx.ui.confirm(
    `Create ${FILE_LABELS[file]}?`,
    `${FILE_LABELS[file]} does not exist yet:\n${path}`,
  );
  if (!confirmed) return false;
  createProjectFile(deps.paths, project, file);
  return true;
}

export async function editNotes(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
): Promise<void> {
  if (!(await ensureFileForEdit(ctx, deps, project, "notes"))) return;
  const current = readNotesText(deps.paths, project);
  const edited = await ctx.ui.editor(`notes.md — ${project.name}`, current);
  if (edited === undefined) return;
  const parsed = parseNotes(edited);
  const written = writeNotes(deps.paths, project, parsed, deps.config.notes.maxLines);
  const secret = detectSecret(written.text);
  if (secret) {
    ctx.ui.notify(
      `Possible secret saved in notes.md: ${secret}\nIt will reach the model and the session transcript.`,
      "warning",
    );
  }
  const rotated = written.archived.length > 0 ? `, rotated ${written.archived.length} block(s)` : "";
  ctx.ui.notify(
    `Saved notes: ${written.map.length} sections, ${written.text.split("\n").length} lines${rotated}`,
    "info",
  );
  deps.status.refresh(ctx);
}

export async function editContext(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
): Promise<void> {
  if (!(await ensureFileForEdit(ctx, deps, project, "context"))) return;
  const current = readContext(deps.paths, project);
  const edited = await ctx.ui.editor(`CONTEXT.md — ${project.name}`, current);
  if (edited === undefined) return;
  if (edited.length > deps.config.context.maxChars) {
    const ok = await ctx.ui.confirm(
      "Context is large",
      `${edited.length} chars will be injected into every request (hard limit ${deps.config.context.maxChars}). Save anyway?`,
    );
    if (!ok) return;
  }
  writeContext(deps.paths, project, edited);
  const secret = detectSecret(edited);
  if (secret) {
    ctx.ui.notify(
      `Possible secret saved in CONTEXT.md: ${secret}\nIt will reach the model, the session transcript and /export or /share.`,
      "warning",
    );
  }
  ctx.ui.notify(`Saved CONTEXT.md (${edited.trim().length} chars)`, "info");
}

export async function editAgents(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
): Promise<void> {
  if (!(await ensureFileForEdit(ctx, deps, project, "agents"))) return;
  const file = join(project.path, "AGENTS.md");
  const { readFileSync, writeFileSync } = await import("node:fs");
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = "";
  }
  const edited = await ctx.ui.editor(`AGENTS.md — ${project.name}`, current);
  if (edited === undefined) return;
  writeFileSync(file, edited.endsWith("\n") ? edited : `${edited}\n`, { mode: 0o644 });
  ctx.ui.notify(`Saved ${file}`, "info");
}

async function applyEdit(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
  what: "notes" | "context" | "agents",
): Promise<void> {
  if (what === "notes") return editNotes(ctx, deps, project);
  if (what === "context") return editContext(ctx, deps, project);
  return editAgents(ctx, deps, project);
}

/**
 * One dock session: keep reopening the dock until an action replaces the
 * session (open/new) or the user closes it. Editors and the session list return
 * to the dock instead of dumping the user back into the editor.
 */
async function projectFilesFlow(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    const action = await runProjectDock(ctx, deps, {
      stage: "edit",
      project,
      filesOnly: true,
    });
    if (!action) return;
    if (action.kind === "edit") {
      await applyEdit(ctx, deps, action.project, action.what);
      continue;
    }
    return;
  }
}

async function projectDockFlow(ctx: ExtensionCommandContext, deps: Deps): Promise<void> {
  let options: DockOpenOptions | undefined;
  for (let guard = 0; guard < 30; guard += 1) {
    const action = await runProjectDock(ctx, deps, options);
    options = undefined;
    if (!action) return;

    if (action.kind === "open") {
      await openProject(ctx, deps, action.project, action.mode);
      return;
    }
    if (action.kind === "edit") {
      await applyEdit(ctx, deps, action.project, action.what);
      options = { stage: "edit", project: action.project };
      continue;
    }
    if (action.kind === "sessions") {
      const choice = await runSessionDock(ctx, deps, action.project);
      if (choice?.createNew) {
        await openProject(ctx, deps, action.project, "new");
        return;
      }
      if (choice?.path) {
        await switchToSession(ctx, deps, action.project, choice.path);
        return;
      }
      options = { stage: "project", project: action.project };
      continue;
    }
    if (action.kind === "tab") {
      const result = await launchInNewTab(deps.pi, action.project);
      ctx.ui.notify(result.message, result.ok ? "info" : "warning");
      if (!result.ok && result.command) ctx.ui.setEditorText(result.command);
      options = { stage: "project", project: action.project };
      continue;
    }
    if (action.kind === "add") {
      const opened = await addProjectFlow(ctx, deps);
      if (opened) return;
      options = {};
      continue;
    }
    if (action.kind === "rename") {
      const name = await ctx.ui.input("Rename project", action.project.name);
      if (name?.trim()) {
        renameProject(deps.paths, action.project.id, name);
        deps.status.refresh(ctx);
      }
      options = { stage: "project", project: action.project };
      continue;
    }
    if (action.kind === "remove") {
      await removeProjectFlow(ctx, deps, action.project.name);
      options = {};
      continue;
    }
  }
}

export function registerCommands(pi: ExtensionAPI, deps: Deps): void {
  pi.registerCommand("projects", {
    description: "Projects: dock, add, remove, new session, status",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const [sub, ...rest] = trimmed.split(/\s+/);
      const value = rest.join(" ").trim();

      if (!sub) {
        if (ctx.mode === "tui") {
          await projectDockFlow(ctx, deps);
          return;
        }
        const registry = loadRegistry(deps.paths);
        if (!ctx.hasUI) {
          const active = findByCwd(registry, ctx.cwd);
          const lines = registry.projects.map(
            (project) => `${active?.id === project.id ? "*" : " "} ${project.name} — ${project.path}`,
          );
          ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No projects registered", "info");
          return;
        }
        const active = findByCwd(registry, ctx.cwd);
        const options: string[] = [];
        const byOption = new Map<string, Project>();
        for (const project of registry.projects) {
          const label = `${active?.id === project.id ? "●" : "○"} ${project.name} — ${shortPath(project.path)}`;
          options.push(label);
          byOption.set(label, project);
        }
        options.push("＋ Add project…", "Remove project…", "Status");
        const choice = await ctx.ui.select("Projects", options);
        if (!choice) return;
        const project = byOption.get(choice);
        if (project) return openProject(ctx, deps, project, "last");
        if (choice === "＋ Add project…") return addProjectFlow(ctx, deps);
        if (choice === "Remove project…") return removeProjectFlow(ctx, deps);
        if (choice === "Status") return status(ctx, deps);
        return;
      }

      if (sub === "dock" || sub === "panel") {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("The projects dock needs an interactive terminal", "warning");
          return;
        }
        await projectDockFlow(ctx, deps);
        return;
      }
      if (sub === "add") return addProjectFlow(ctx, deps, value);
      if (sub === "remove") return removeProjectFlow(ctx, deps, value);
      if (sub === "status") return status(ctx, deps);
      if (sub === "new" || sub === "open") {
        const registry = loadRegistry(deps.paths);
        const lookup = value.toLowerCase();
        const project = registry.projects.find(
          (entry) =>
            entry.id === value ||
            entry.name.toLowerCase() === lookup ||
            entry.path === value,
        );
        if (!project) {
          ctx.ui.notify(`Project not found: ${value || "(empty)"}`, "error");
          return;
        }
        await openProject(ctx, deps, project, sub === "new" ? "new" : "last");
        return;
      }
      ctx.ui.notify(USAGE, "warning");
    },
  });

  pi.registerCommand("project", {
    description: "Project files menu: notes, context, agents",
    handler: async (args, ctx) => {
      const project = await requireProject(ctx, deps);
      if (!project) return;
      const what = args.trim();
      if (!what) {
        if (ctx.mode === "tui") return projectFilesFlow(ctx, deps, project);
        const choice = await ctx.ui.select("Project files", [
          "notes.md",
          "CONTEXT.md",
          "AGENTS.md",
        ]);
        if (choice === "notes.md") return editNotes(ctx, deps, project);
        if (choice === "CONTEXT.md") return editContext(ctx, deps, project);
        if (choice === "AGENTS.md") return editAgents(ctx, deps, project);
        return;
      }
      if (what === "notes") return editNotes(ctx, deps, project);
      if (what === "context") return editContext(ctx, deps, project);
      if (what === "agents") return editAgents(ctx, deps, project);
      if (what === "status") return status(ctx, deps);
      if (what === "show") {
        const notes = loadNotes(deps.paths, project);
        ctx.ui.notify(
          notes.map.map((entry) => `${entry.section}: L${entry.start} (${entry.lines} lines)`).join("\n") ||
            "notes.md is empty",
          "info",
        );
        return;
      }
      ctx.ui.notify(
        "Usage: /project (files menu) | /project notes|context|agents|status|show",
        "warning",
      );
    },
  });

  pi.registerCommand("projects-apply-pending", {
    description: "Internal: apply a queued project switch",
    handler: async (_args, ctx) => {
      await applyPending(ctx, deps);
    },
  });
}
