/**
 * Switching projects.
 *
 * pi sessions are bound to the cwd recorded in their header; `ctx.switchSession`
 * recreates the runtime with that cwd, which re-roots tools, AGENTS.md, `.pi`
 * config, skills and MCP servers. A project without history gets a header-only
 * session file (verified in the M0 spike).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SessionManager,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Deps, OpenMode } from "./deps.ts";
import type { Project } from "./types.ts";
import { findByCwd, loadRegistry, saveDraft, takeDraft, touchProject } from "./registry.ts";
import { isCustomSessionDir, newestSessionFile } from "./sessions.ts";
import { fallbackCommand, launchInNewTab } from "./launcher.ts";

export function createEmptySession(cwd: string, sessionDir?: string): string {
  const manager = SessionManager.create(resolve(cwd), sessionDir);
  const dir = manager.getSessionDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: resolve(cwd) })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return file;
}

/** Session dir of the current runtime when the user configured a custom one. */
export function customSessionDir(ctx: ExtensionCommandContext): string | undefined {
  const dir = ctx.sessionManager.getSessionDir();
  return isCustomSessionDir(dir, ctx.cwd) ? dir : undefined;
}

export async function latestSessionFor(
  ctx: ExtensionCommandContext,
  projectPath: string,
): Promise<string | undefined> {
  const custom = customSessionDir(ctx);
  if (custom) {
    try {
      const all = await SessionManager.listAll(custom);
      const key = resolve(projectPath);
      const match = all
        .filter((info) => resolve(info.cwd) === key)
        .sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
      if (match) return match.path;
    } catch {
      // fall through to a fresh session
    }
    return undefined;
  }
  return newestSessionFile(SessionManager.create(projectPath).getSessionDir());
}

async function sessionTargetFor(
  ctx: ExtensionCommandContext,
  project: Project,
  mode: OpenMode,
): Promise<string> {
  if (mode === "new") return createEmptySession(project.path, customSessionDir(ctx));
  return (await latestSessionFor(ctx, project.path)) ?? createEmptySession(project.path, customSessionDir(ctx));
}

const BUSY_CHOICES = [
  "Open in a new terminal tab (keeps this run)",
  "Wait for the agent, then switch",
  "Interrupt and switch",
  "Cancel",
] as const;

export type OpenResult = "switched" | "queued" | "launched" | "cancelled";

export async function openProject(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
  mode: OpenMode = "last",
): Promise<OpenResult> {
  if (!existsSync(project.path)) {
    ctx.ui.notify(`Project directory is missing: ${project.path}`, "error");
    return "cancelled";
  }
  try {
    if (!statSync(project.path).isDirectory()) throw new Error("not a directory");
  } catch {
    ctx.ui.notify(`Not a directory: ${project.path}`, "error");
    return "cancelled";
  }

  if (!ctx.isIdle()) {
    if (!ctx.hasUI) {
      ctx.ui.notify("Another run is active; try again when the agent settles.", "warning");
      return "cancelled";
    }
    const choice = await ctx.ui.select(`Agent is working. Switch to ${project.name}?`, [...BUSY_CHOICES]);
    if (!choice || choice === "Cancel") return "cancelled";
    if (choice === "Open in a new terminal tab (keeps this run)") {
      const result = await launchInNewTab(deps.pi, project);
      ctx.ui.notify(result.message, result.ok ? "info" : "warning");
      if (!result.ok && result.command) ctx.ui.setEditorText(result.command);
      return "launched";
    }
    if (choice === "Wait for the agent, then switch") {
      deps.pending = { projectId: project.id, mode };
      deps.status.setQueued(project.name);
      ctx.ui.setStatus("pi-projects", `waiting to switch to ${project.name}`);
      return "queued";
    }
  }

  const registry = loadRegistry(deps.paths);
  const current = findByCwd(registry, ctx.cwd);
  if (current) {
    try {
      saveDraft(deps.paths, current.id, ctx.ui.getEditorText());
    } catch {
      // drafts are best effort
    }
  }

  let target: string;
  try {
    target = await sessionTargetFor(ctx, project, mode);
  } catch (error) {
    ctx.ui.notify(
      `Could not prepare a session: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return "cancelled";
  }

  const result = await ctx.switchSession(target, {
    withSession: async (next) => {
      touchProject(deps.paths, project.id);
      try {
        const draft = takeDraft(deps.paths, project.id);
        if (draft) next.ui.setEditorText(draft);
      } catch {
        // ignore draft restore failures
      }
      // Only use the replacement-session ctx here: the captured `pi`/ctx are stale
      // after a session replacement (pi throws on use).
      if (!next.sessionManager.getSessionName()) {
        next.sessionManager.appendSessionInfo(
          `${project.name} · ${new Date().toISOString().slice(0, 10)}`,
        );
      }
      next.ui.setStatus("pi-projects", `project: ${project.name}`);
    },
  });
  return result.cancelled ? "cancelled" : "switched";
}

/** Switch to a specific session file of a project (session picker). */
export async function switchToSession(
  ctx: ExtensionCommandContext,
  deps: Deps,
  project: Project,
  sessionPath: string,
): Promise<boolean> {
  const current = findByCwd(loadRegistry(deps.paths), ctx.cwd);
  if (current) {
    try {
      saveDraft(deps.paths, current.id, ctx.ui.getEditorText());
    } catch {
      // best effort
    }
  }
  const result = await ctx.switchSession(sessionPath, {
    withSession: async (next) => {
      touchProject(deps.paths, project.id);
      next.ui.setStatus("pi-projects", `project: ${project.name}`);
    },
  });
  return !result.cancelled;
}

/** Run the queued switch from a command context (see `agent_settled` wiring). */
export async function applyPending(ctx: ExtensionCommandContext, deps: Deps): Promise<boolean> {
  const pending = deps.pending;
  if (!pending) return false;
  deps.pending = undefined;
  const registry = loadRegistry(deps.paths);
  const project = registry.projects.find((entry) => entry.id === pending.projectId);
  if (!project) {
    deps.status.setQueued(undefined);
    ctx.ui.notify("Queued project no longer exists", "warning");
    return false;
  }
  await openProject(ctx, deps, project, pending.mode);
  return true;
}

export function manualCommand(project: Project): string {
  return fallbackCommand(project);
}
