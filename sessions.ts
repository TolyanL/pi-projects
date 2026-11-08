/** Session summaries per project, honouring a custom sessionDir when configured. */

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import type { SessionSummary } from "./types.ts";

/** Same layout pi uses for the default per-cwd session directory. */
export function defaultSessionDir(agentDir: string, cwd: string): string {
  const safe = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(agentDir, "sessions", safe);
}

export function isCustomSessionDir(sessionDir: string, cwd: string): boolean {
  return resolve(sessionDir) !== resolve(defaultSessionDir(getAgentDir(), cwd));
}

/** Newest session file for a directory (pi sorts file names descending). */
export function newestSessionFile(dir: string): string | undefined {
  try {
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a));
    return files.length > 0 ? join(dir, files[0]) : undefined;
  } catch {
    return undefined;
  }
}

export interface SessionIndex {
  customDir: boolean;
  byPath: Map<string, SessionSummary>;
}

/**
 * Build per-project summaries.
 *
 * Default sessionDir: one cheap directory listing per project. Custom
 * sessionDir: one recursive `listAll` and grouping by the header cwd, because
 * all projects share the same directory.
 */
export async function loadSessionIndex(
  projects: Array<{ path: string }>,
  currentSessionDir: string,
  currentCwd: string,
): Promise<SessionIndex> {
  const byPath = new Map<string, SessionSummary>();
  const customDir = isCustomSessionDir(currentSessionDir, currentCwd);

  if (!customDir) {
    await Promise.all(
      projects.map(async (project) => {
        try {
          const sessions = await SessionManager.list(project.path);
          const lastModified = sessions.reduce(
            (max, info) => Math.max(max, info.modified.getTime()),
            0,
          );
          byPath.set(resolve(project.path), {
            count: sessions.length,
            lastModified: lastModified || undefined,
          });
        } catch {
          byPath.set(resolve(project.path), { count: 0 });
        }
      }),
    );
    return { customDir, byPath };
  }

  try {
    const all = await SessionManager.listAll(currentSessionDir);
    for (const project of projects) {
      const key = resolve(project.path);
      const sessions = all.filter((info) => resolve(info.cwd) === key);
      const lastModified = sessions.reduce(
        (max, info) => Math.max(max, info.modified.getTime()),
        0,
      );
      byPath.set(key, { count: sessions.length, lastModified: lastModified || undefined });
    }
  } catch {
    for (const project of projects) byPath.set(resolve(project.path), { count: 0 });
  }
  return { customDir, byPath };
}

/** Full session list for one project, honouring a custom sessionDir. */
export async function listSessionsFor(
  ctx: { sessionManager: { getSessionDir(): string }; cwd: string },
  projectPath: string,
): Promise<SessionInfo[]> {
  const sessionDir = ctx.sessionManager.getSessionDir();
  if (isCustomSessionDir(sessionDir, ctx.cwd)) {
    const all = await SessionManager.listAll(sessionDir);
    const key = resolve(projectPath);
    return all.filter((info) => resolve(info.cwd) === key);
  }
  return SessionManager.list(projectPath);
}

export function summarize(summary: SessionSummary | undefined): SessionSummary {
  return summary ?? { count: 0 };
}
