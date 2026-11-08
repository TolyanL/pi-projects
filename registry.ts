/**
 * Project registry and config storage.
 *
 * Everything lives under `<agent-dir>/pi-projects/`:
 *   registry.json   project list and the last active project
 *   config.json     panel/context/notes settings
 *   drafts.json     editor drafts per project, restored on switch
 *   <slug>-<id8>/   private CONTEXT.md / notes.md per project
 *
 * All writes are atomic (tmp file + rename) and 0600: several pi processes can
 * share the same registry.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Config, Project, ProjectPaths, Registry } from "./types.ts";
import { DEFAULT_CONFIG, slugify } from "./format.ts";

const REGISTRY_VERSION = 1;

// ---------------------------------------------------------------------------
// low level io
// ---------------------------------------------------------------------------

function ensureDir(path: string, mode = 0o700): void {
  mkdirSync(path, { recursive: true, mode });
  try {
    chmodSync(path, mode);
  } catch {
    // best effort: some filesystems ignore chmod
  }
}

export function atomicWrite(file: string, text: string, mode = 0o600): void {
  ensureDir(dirname(file));
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, text, { mode });
    chmodSync(temp, mode);
    renameSync(temp, file);
  } catch (error) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function readJson<T>(file: string): T | undefined {
  const text = readText(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function ensureBaseDir(paths: ProjectPaths): void {
  ensureDir(paths.baseDir);
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function mergeConfig(raw: Partial<Config> | undefined): Config {
  return {
    context: { ...DEFAULT_CONFIG.context, ...(raw?.context ?? {}) },
    notes: { ...DEFAULT_CONFIG.notes, ...(raw?.notes ?? {}) },
    pickerShortcut: raw?.pickerShortcut ?? DEFAULT_CONFIG.pickerShortcut,
  };
}

export function loadConfig(paths: ProjectPaths): Config {
  return mergeConfig(readJson<Partial<Config>>(paths.configFile));
}

export function saveConfig(paths: ProjectPaths, config: Config): void {
  atomicWrite(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

function normalizeProject(raw: Project): Project | undefined {
  if (!raw || typeof raw.id !== "string" || typeof raw.path !== "string") return undefined;
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : basename(raw.path),
    path: raw.path,
    addedAt: raw.addedAt ?? new Date(0).toISOString(),
    lastOpenedAt: raw.lastOpenedAt ?? raw.addedAt ?? new Date(0).toISOString(),
  };
}

export function loadRegistry(paths: ProjectPaths): Registry {
  const raw = readJson<Partial<Registry>>(paths.registryFile);
  const projects = Array.isArray(raw?.projects)
    ? raw!.projects.map((entry) => normalizeProject(entry as Project)).filter((entry): entry is Project => Boolean(entry))
    : [];
  return {
    version: REGISTRY_VERSION,
    activeId: typeof raw?.activeId === "string" ? raw.activeId : undefined,
    projects,
  };
}

export function saveRegistry(paths: ProjectPaths, registry: Registry): void {
  atomicWrite(paths.registryFile, `${JSON.stringify(registry, null, 2)}\n`);
}

/** Read-modify-write helper: reads the current file, applies `mutate`, saves. */
export function updateRegistry<T>(paths: ProjectPaths, mutate: (registry: Registry) => T): T {
  const registry = loadRegistry(paths);
  const result = mutate(registry);
  saveRegistry(paths, registry);
  return result;
}

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(`..${sep}`));
}

export interface PathCheck {
  ok: boolean;
  path?: string;
  error?: string;
}

/** Validate a candidate project directory. `agentDir` is the pi config dir. */
export function validateProjectPath(input: string, agentDir: string): PathCheck {
  const expanded = expandHome(input.trim());
  if (!expanded) return { ok: false, error: "Path is empty" };
  const absolute = resolve(expanded);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return { ok: false, error: `No such directory: ${absolute}` };
  }
  if (!stats.isDirectory()) return { ok: false, error: `Not a directory: ${absolute}` };
  const real = realPath(absolute);
  if (real === resolve("/")) return { ok: false, error: "Refusing to use / as a project" };
  if (isInside(real, resolve(agentDir))) {
    return { ok: false, error: `Refusing to use pi's config directory as a project: ${real}` };
  }
  return { ok: true, path: real };
}

/** Directory that stores a project's private files (deterministic). */
export function projectDir(paths: ProjectPaths, project: Project): string {
  return join(paths.baseDir, `${slugify(project.name)}-${project.id.slice(0, 8)}`);
}

// ---------------------------------------------------------------------------
// project operations (all persist immediately)
// ---------------------------------------------------------------------------

function samePath(a: string, b: string): boolean {
  return realPath(a) === realPath(b);
}

/** Longest matching project for a cwd, exact match wins over prefix. */
export function findByCwd(registry: Registry, cwd: string): Project | undefined {
  const real = realPath(cwd);
  let best: Project | undefined;
  for (const project of registry.projects) {
    const path = realPath(project.path);
    if (path === real) return project;
    if (isInside(real, path) && (!best || path.length > best.path.length)) best = project;
  }
  return best;
}

export function addProject(
  paths: ProjectPaths,
  agentDir: string,
  input: { path: string; name?: string },
): { project?: Project; registry: Registry; error?: string } {
  const check = validateProjectPath(input.path, agentDir);
  if (!check.ok || !check.path) {
    return { registry: loadRegistry(paths), error: check.error ?? "Invalid path" };
  }
  const real = check.path;
  let added: Project | undefined;
  const registry = updateRegistry(paths, (current) => {
    const existing = current.projects.find((project) => samePath(project.path, real));
    const now = new Date().toISOString();
    if (existing) {
      existing.lastOpenedAt = now;
      if (input.name?.trim()) existing.name = input.name.trim();
      current.activeId = existing.id;
      added = existing;
      return current;
    }
    const project: Project = {
      id: randomUUID(),
      name: input.name?.trim() || basename(real),
      path: real,
      addedAt: now,
      lastOpenedAt: now,
    };
    current.projects.push(project);
    current.activeId = project.id;
    added = project;
    return current;
  });
  return { project: added, registry };
}

export function removeProject(
  paths: ProjectPaths,
  needle: string,
): { project?: Project; registry: Registry } {
  const wanted = needle.trim();
  let removed: Project | undefined;
  const registry = updateRegistry(paths, (current) => {
    const lookup = wanted.toLowerCase();
    const index = current.projects.findIndex(
      (project) =>
        project.id === wanted ||
        project.name.toLowerCase() === lookup ||
        basename(project.path).toLowerCase() === lookup ||
        project.path === wanted,
    );
    if (index === -1) return current;
    removed = current.projects[index];
    current.projects.splice(index, 1);
    if (current.activeId === removed.id) {
      current.activeId = current.projects[0]?.id;
    }
    return current;
  });
  return { project: removed, registry };
}

export function touchProject(paths: ProjectPaths, projectId: string): void {
  updateRegistry(paths, (current) => {
    const project = current.projects.find((entry) => entry.id === projectId);
    if (project) project.lastOpenedAt = new Date().toISOString();
    current.activeId = projectId;
    return current;
  });
}

export function renameProject(paths: ProjectPaths, projectId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  updateRegistry(paths, (current) => {
    const project = current.projects.find((entry) => entry.id === projectId);
    if (project) project.name = trimmed;
    return current;
  });
}

/** First run convenience: register the cwd when it looks like a repository. */
export function ensureFirstProject(paths: ProjectPaths, agentDir: string, cwd: string): Registry {
  const registry = loadRegistry(paths);
  if (registry.projects.length > 0) return registry;
  if (!existsSync(join(cwd, ".git"))) return registry;
  const result = addProject(paths, agentDir, { path: cwd });
  return result.registry;
}

// ---------------------------------------------------------------------------
// drafts
// ---------------------------------------------------------------------------

export function loadDrafts(paths: ProjectPaths): Record<string, string> {
  const raw = readJson<Record<string, string>>(paths.draftsFile);
  if (!raw || typeof raw !== "object") return {};
  const drafts: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.length > 0) drafts[key] = value.slice(0, 256 * 1024);
  }
  return drafts;
}

export function saveDraft(paths: ProjectPaths, projectId: string, text: string): void {
  const drafts = loadDrafts(paths);
  if (text.trim().length === 0) {
    delete drafts[projectId];
  } else {
    drafts[projectId] = text;
  }
  atomicWrite(paths.draftsFile, `${JSON.stringify(drafts, null, 2)}\n`);
}

export function takeDraft(paths: ProjectPaths, projectId: string): string | undefined {
  const drafts = loadDrafts(paths);
  const text = drafts[projectId];
  if (text === undefined) return undefined;
  delete drafts[projectId];
  atomicWrite(paths.draftsFile, `${JSON.stringify(drafts, null, 2)}\n`);
  return text;
}
