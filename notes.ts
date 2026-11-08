/**
 * Note files and generated indexes.
 *
 * Layout per project:
 *   <project>/CONTEXT.md
 *   <project>/NOTES.md        generated index of notes/
 *   <project>/notes/*.md      one note per file, with frontmatter
 *
 * Global:
 *   <root>/INDEX.md           generated index across all projects
 *
 * Note frontmatter:
 *   ---
 *   title: How auth works
 *   description: Token refresh and middleware order
 *   created: 2026-02-14
 *   updated: 2026-02-14
 *   ---
 *
 * Indexes are always derived by scanning files, so hand-written notes show up
 * too. Nothing is created until the user or the agent actually writes a note.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { NoteMeta, Project, ProjectPaths } from "./types.ts";
import { atomicWrite, loadRegistry, projectDir } from "./registry.ts";

export const NOTES_INDEX = "NOTES.md";
export const GLOBAL_INDEX = "INDEX.md";

export function notesDir(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), "notes");
}

export function notesIndexPath(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), NOTES_INDEX);
}

export function noteFilePath(paths: ProjectPaths, project: Project, file: string): string {
  const safe = basename(file).replace(/[^A-Za-z0-9._-]/g, "-");
  return join(notesDir(paths, project), safe.endsWith(".md") ? safe : `${safe}.md`);
}

/** Old strict-schema file; the user allowed deleting it. */
export function cleanupLegacyNotes(paths: ProjectPaths, project: Project): boolean {
  const legacy = join(projectDir(paths, project), "notes.md");
  try {
    if (!existsSync(legacy) || !statSync(legacy).isFile()) return false;
    rmSync(legacy);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

export interface NoteDocument {
  meta: NoteMeta;
  /** Body without the leading `# Title` heading. */
  body: string;
  /** Full file contents. */
  text: string;
  path: string;
}

function oneLine(value: string, limit = 160): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `note-${Date.now().toString(36)}`;
}

function uniqueNoteFile(paths: ProjectPaths, project: Project, base: string): string {
  const dir = notesDir(paths, project);
  let candidate = `${base}.md`;
  let counter = 2;
  while (existsSync(join(dir, candidate))) {
    candidate = `${base}-${counter}.md`;
    counter += 1;
  }
  return candidate;
}

export function parseNote(text: string): { meta: Omit<NoteMeta, "file">; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  let meta: Record<string, string> = {};
  let rest = normalized;
  if (normalized.startsWith("---\n")) {
    const end = normalized.indexOf("\n---", 4);
    if (end !== -1) {
      const block = normalized.slice(4, end);
      rest = normalized.slice(end + 4).replace(/^\n+/, "");
      for (const line of block.split("\n")) {
        const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
        if (!match) continue;
        let value = match[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        meta[match[1].toLowerCase()] = value;
      }
    }
  }

  let title = meta.title ?? "";
  let body = rest;
  const heading = /^#\s+(.+?)\s*$/m.exec(rest);
  if (heading && rest.trimStart().startsWith("# ")) {
    if (!title) title = heading[1];
    body = rest.slice(rest.indexOf(heading[0]) + heading[0].length).replace(/^\n+/, "");
  }

  let description = meta.description ?? "";
  if (!description) {
    const line = body
      .split("\n")
      .map((entry) => entry.replace(/^[-*#>\s]+/, "").trim())
      .find((entry) => entry.length > 0);
    description = line ?? "";
  }

  return {
    meta: {
      title: oneLine(title || "(untitled)", 120),
      description: oneLine(description),
      created: meta.created,
      updated: meta.updated,
    },
    body: body.replace(/\s+$/, ""),
  };
}

function composeNote(meta: Omit<NoteMeta, "file">, body: string): string {
  const cleanBody = body.replace(/\s+$/, "");
  const heading = `# ${meta.title}`;
  const content = cleanBody.trimStart().startsWith("# ")
    ? `${cleanBody}\n`
    : `${heading}\n\n${cleanBody}\n`;
  return [
    "---",
    `title: ${oneLine(meta.title, 120)}`,
    `description: ${oneLine(meta.description)}`,
    `created: ${meta.created ?? today()}`,
    `updated: ${meta.updated ?? today()}`,
    "---",
    "",
    content,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------

export function ensureNotesDir(paths: ProjectPaths, project: Project): string {
  const dir = notesDir(paths, project);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function listNotes(paths: ProjectPaths, project: Project): NoteMeta[] {
  const dir = notesDir(paths, project);
  if (!existsSync(dir)) return [];
  const notes: NoteMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    let text: string;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue;
    }
    const parsed = parseNote(text);
    notes.push({ file: name, ...parsed.meta });
  }
  notes.sort((a, b) => a.title.localeCompare(b.title));
  return notes;
}

export function countNotes(paths: ProjectPaths, project: Project): number {
  return listNotes(paths, project).length;
}

export function readNote(
  paths: ProjectPaths,
  project: Project,
  reference: string,
): NoteDocument | undefined {
  const wanted = reference.trim();
  if (!wanted) return undefined;
  const notes = listNotes(paths, project);
  const byFile = notes.find((note) => note.file === basename(wanted));
  const byTitle = notes.find(
    (note) => note.title.toLowerCase() === wanted.toLowerCase(),
  );
  const note =
    byFile ??
    byTitle ??
    notes.find((entry) => entry.title.toLowerCase().includes(wanted.toLowerCase()));
  if (!note) return undefined;
  const path = join(notesDir(paths, project), note.file);
  const text = readFileSync(path, "utf8");
  return { meta: note, body: parseNote(text).body, text, path };
}

export interface NoteWriteResult {
  meta: NoteMeta;
  created: boolean;
  path: string;
}

export function writeNote(
  paths: ProjectPaths,
  project: Project,
  input: { title: string; description?: string; content?: string },
): NoteWriteResult {
  const title = oneLine(input.title, 120);
  if (!title) throw new Error("Note title is required");
  ensureNotesDir(paths, project);
  const existing = listNotes(paths, project).find(
    (note) => note.title.toLowerCase() === title.toLowerCase(),
  );
  const stamp = today();
  if (existing) {
    const doc = readNote(paths, project, existing.file);
    const body = input.content !== undefined ? input.content : doc?.body ?? "";
    const meta = {
      title,
      description: oneLine(input.description ?? existing.description),
      created: existing.created ?? stamp,
      updated: stamp,
    };
    atomicWrite(join(notesDir(paths, project), existing.file), composeNote(meta, body));
    rebuildProjectIndex(paths, project);
    rebuildGlobalIndex(paths);
    return {
      meta: { file: existing.file, ...meta },
      created: false,
      path: join(notesDir(paths, project), existing.file),
    };
  }
  const file = uniqueNoteFile(paths, project, slugifyTitle(title));
  const meta = {
    title,
    description: oneLine(input.description ?? ""),
    created: stamp,
    updated: stamp,
  };
  atomicWrite(join(notesDir(paths, project), file), composeNote(meta, input.content ?? ""));
  rebuildProjectIndex(paths, project);
  rebuildGlobalIndex(paths);
  return { meta: { file, ...meta }, created: true, path: join(notesDir(paths, project), file) };
}

export function writeNoteBody(
  paths: ProjectPaths,
  project: Project,
  file: string,
  body: string,
): NoteMeta {
  const doc = readNote(paths, project, file);
  if (!doc) throw new Error(`Note not found: ${file}`);
  const meta = {
    title: doc.meta.title,
    description: doc.meta.description,
    created: doc.meta.created ?? today(),
    updated: today(),
  };
  atomicWrite(join(notesDir(paths, project), doc.meta.file), composeNote(meta, body));
  rebuildProjectIndex(paths, project);
  rebuildGlobalIndex(paths);
  return { file: doc.meta.file, ...meta };
}

export function appendNote(
  paths: ProjectPaths,
  project: Project,
  reference: string,
  content: string,
): NoteMeta {
  const doc = readNote(paths, project, reference);
  if (!doc) throw new Error(`Note not found: ${reference}`);
  return writeNoteBody(paths, project, doc.meta.file, `${doc.body}\n\n${content.trim()}`);
}

export function deleteNote(paths: ProjectPaths, project: Project, file: string): boolean {
  const doc = readNote(paths, project, file);
  if (!doc) return false;
  rmSync(doc.path, { force: true });
  rebuildProjectIndex(paths, project);
  rebuildGlobalIndex(paths);
  return true;
}

// ---------------------------------------------------------------------------
// indexes
// ---------------------------------------------------------------------------

function indexEntry(meta: NoteMeta, path: string): string {
  return meta.description
    ? `- **${meta.title}** — ${meta.description} — \`${path}\``
    : `- **${meta.title}** — \`${path}\``;
}

export function projectIndexText(project: Project, notes: NoteMeta[]): string {
  const lines = [
    `# Notes — ${project.name}`,
    "",
    "<!-- generated by pi-projects; entries come from notes/*.md frontmatter -->",
    "",
  ];
  if (notes.length === 0) {
    lines.push("_No notes yet._");
  } else {
    for (const note of notes) lines.push(indexEntry(note, `notes/${note.file}`));
  }
  return `${lines.join("\n")}\n`;
}

export function rebuildProjectIndex(paths: ProjectPaths, project: Project): void {
  cleanupLegacyNotes(paths, project);
  const index = notesIndexPath(paths, project);
  const notes = listNotes(paths, project);
  if (notes.length === 0 && !existsSync(index)) return;
  atomicWrite(index, projectIndexText(project, notes));
}

export function globalIndexText(
  paths: ProjectPaths,
  entries: Array<{ project: Project; notes: NoteMeta[] }>,
): string {
  const lines = [
    "# Notes — all projects",
    "",
    "<!-- generated by pi-projects; entries come from <project>/notes/*.md frontmatter -->",
    "",
  ];
  const shared = entries.filter((entry) => !entry.project.private);
  const withNotes = shared.filter((entry) => entry.notes.length > 0);
  if (withNotes.length === 0) {
    lines.push("_No notes yet._");
  }
  for (const { project, notes } of withNotes) {
    lines.push(`## ${project.name}`);
    const dir = basename(projectDir(paths, project));
    for (const note of notes) {
      lines.push(indexEntry(note, `${dir}/notes/${note.file}`));
    }
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function rebuildGlobalIndex(paths: ProjectPaths, registry = loadRegistry(paths)): void {
  // Private projects never reach the global index (or all_project_notes).
  const entries = registry.projects
    .filter((project) => !project.private)
    .map((project) => ({
      project,
      notes: listNotes(paths, project),
    }));
  const total = entries.reduce((sum, entry) => sum + entry.notes.length, 0);
  if (total === 0 && !existsSync(paths.indexFile)) return;
  atomicWrite(paths.indexFile, globalIndexText(paths, entries));
}

/** Rebuild every project index plus the global one. */
export function rebuildIndexes(paths: ProjectPaths): void {
  const registry = loadRegistry(paths);
  for (const project of registry.projects) rebuildProjectIndex(paths, project);
  rebuildGlobalIndex(paths, registry);
}

// ---------------------------------------------------------------------------
// prompt and search
// ---------------------------------------------------------------------------

export function promptNoteIndex(
  notes: NoteMeta[],
  maxEntries: number,
  maxChars: number,
): string {
  if (notes.length === 0) return "";
  const lines: string[] = [];
  for (const note of notes.slice(0, Math.max(1, maxEntries))) {
    lines.push(
      note.description
        ? `- ${note.title} — ${note.description} (notes/${note.file})`
        : `- ${note.title} (notes/${note.file})`,
    );
  }
  if (notes.length > maxEntries) lines.push(`- …${notes.length - maxEntries} more notes`);
  let text = lines.join("\n");
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return text;
}

export function searchProjectNotes(
  paths: ProjectPaths,
  project: Project,
  query: string,
  limit = 20,
): Array<{ file: string; line: number; text: string }> {
  const needle = query.toLowerCase();
  const results: Array<{ file: string; line: number; text: string }> = [];
  for (const note of listNotes(paths, project)) {
    let text: string;
    try {
      text = readFileSync(join(notesDir(paths, project), note.file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && results.length < limit; index += 1) {
      if (lines[index].toLowerCase().includes(needle)) {
        results.push({ file: note.file, line: index + 1, text: lines[index].trim() });
      }
    }
    if (results.length >= limit) break;
  }
  return results;
}
