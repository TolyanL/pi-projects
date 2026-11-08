/**
 * Footer status line: one line, always visible, never covers anything.
 *
 * The projects UI itself is the dock (`picker.ts`); the status line only tells
 * you which project the current session belongs to and what the agent is doing.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Deps, StatusApi } from "./deps.ts";
import type { SessionSummary } from "./types.ts";
import { findByCwd, loadRegistry } from "./registry.ts";
import { loadSessionIndex } from "./sessions.ts";
import { projectMeta } from "./format.ts";
import { resolve } from "node:path";

const STATUS_KEY = "pi-projects";

export function createStatus(pi: ExtensionAPI, deps: Deps): StatusApi {
  let currentCtx: ExtensionContext | undefined;
  let working = false;
  let subagents = 0;
  let queued: string | undefined;
  let failed = false;
  let summary: SessionSummary | undefined;
  let projectName: string | undefined;
  let projectCount = 0;
  let refreshing = false;

  const render = (): void => {
    if (!currentCtx?.hasUI) return;
    const parts: string[] = [];
    if (projectName) parts.push(`▸ ${projectName}`);
    else if (projectCount > 0) parts.push("no project here");
    else parts.push("/projects add");

    if (projectName) {
      const meta = projectMeta(summary);
      if (meta !== "no sessions") parts.push(meta);
    }
    if (working) parts.push("●");
    if (subagents > 0) parts.push(`⚙${subagents}`);
    if (queued) parts.push(`→ ${queued}`);
    if (failed) parts.push("!");
    currentCtx.ui.setStatus(STATUS_KEY, parts.join(" · "));
  };

  async function refresh(ctx: ExtensionContext | undefined = currentCtx): Promise<void> {
    if (!ctx || refreshing) return;
    currentCtx = ctx;
    refreshing = true;
    try {
      const registry = loadRegistry(deps.paths);
      projectCount = registry.projects.length;
      const active = findByCwd(registry, ctx.cwd);
      projectName = active?.name;
      summary = undefined;
      if (active) {
        const index = await loadSessionIndex([active], ctx.sessionManager.getSessionDir(), ctx.cwd);
        summary = index.byPath.get(resolve(active.path));
      }
    } catch {
      // status is cosmetic
    } finally {
      refreshing = false;
      render();
    }
  }

  return {
    refresh,
    setWorking(next, ctx) {
      working = next;
      if (ctx) currentCtx = ctx;
      if (next) failed = false;
      else if (!next) subagents = 0;
      render();
    },
    bumpSubagents(delta) {
      subagents = Math.max(0, subagents + delta);
      render();
    },
    setQueued(name) {
      queued = name;
      render();
    },
    setError(hasError) {
      failed = hasError;
      render();
    },
  };
}

export { STATUS_KEY };
