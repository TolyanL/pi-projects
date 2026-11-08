/**
 * Private per-project files: CONTEXT.md and AGENTS.md.
 *
 * Notes are a separate subsystem (see notes.ts): `NOTES.md` is a generated
 * index, `notes/*.md` are the note files.
 *
 * Nothing here is created automatically: `createProjectFile` is only called
 * after an explicit confirmation in the UI.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project, ProjectPaths } from "./types.ts";
import { atomicWrite, projectDir } from "./registry.ts";

export type ProjectFile = "context" | "agents";

export function contextPath(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), "CONTEXT.md");
}

export function projectFilePath(paths: ProjectPaths, project: Project, file: ProjectFile): string {
  if (file === "context") return contextPath(paths, project);
  return join(project.path, "AGENTS.md");
}

export function projectFileExists(paths: ProjectPaths, project: Project, file: ProjectFile): boolean {
  return existsSync(projectFilePath(paths, project, file));
}

export function ensureProjectDir(paths: ProjectPaths, project: Project): string {
  const dir = projectDir(paths, project);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best effort
  }
  return dir;
}

export function contextTemplate(project: Project): string {
  return `# ${project.name}

## What this is
(One or two sentences about the project.)

## How we work here
(Conventions, build/test commands, things not to do.)

## Environment
(Local paths, services, containers. Secrets: write only variable names.)

## Links
(Tickets, docs, designs.)
`;
}

export function agentsTemplate(project: Project): string {
  return `# AGENTS.md

## Project
(What ${project.name} is.)

## Commands
(Build, test, lint.)

## Conventions
(How code is written here.)

## Do not
(Things the agent must avoid.)
`;
}

/** Explicit creation only. */
export function createProjectFile(paths: ProjectPaths, project: Project, file: ProjectFile): void {
  const target = projectFilePath(paths, project, file);
  if (existsSync(target)) return;
  if (file === "context") {
    ensureProjectDir(paths, project);
    atomicWrite(target, contextTemplate(project));
    return;
  }
  // AGENTS.md lives in the repository: normal file mode, not 0600.
  writeFileSync(target, agentsTemplate(project), { mode: 0o644 });
}

export function readContext(paths: ProjectPaths, project: Project): string {
  try {
    return readFileSync(contextPath(paths, project), "utf8");
  } catch {
    return "";
  }
}

export function writeContext(paths: ProjectPaths, project: Project, text: string): void {
  ensureProjectDir(paths, project);
  atomicWrite(contextPath(paths, project), text.endsWith("\n") ? text : `${text}\n`);
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|ghp|gho|ghu|ghs|glpat|xox[abprs])[-_][A-Za-z0-9_-]{12,}/,
  /\b(api[_-]?key|secret|token|password|passwd|authorization)\b\s*[:=]\s*\S{6,}/i,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
];

/** Returns the suspicious line (trimmed) or undefined. */
export function detectSecret(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("<!--")) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(trimmed)) return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
    }
  }
  return undefined;
}
