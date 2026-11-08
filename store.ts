/**
 * Private per-project files: CONTEXT.md and notes.md.
 *
 * notes.md has a strict, machine-managed schema:
 *
 *   # Notes — <name>
 *   <!-- toc: managed by pi-projects; do not edit by hand -->
 *   - Focus
 *   ...
 *   <!-- /toc -->
 *   ## Focus
 *   ## Decisions
 *   ## Gotchas
 *   ## Open
 *   ## Log
 *
 * Section order is canonical, the TOC is rebuilt on every write, unknown
 * sections are preserved after the canonical ones. Entries are written by the
 * agent through the `project_notes` tool; manual edits are allowed and repaired
 * on the next write.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NotesMapEntry, Project, ProjectPaths } from "./types.ts";
import { atomicWrite, projectDir } from "./registry.ts";

export const NOTES_SECTIONS = ["Focus", "Decisions", "Gotchas", "Open", "Log"] as const;
export type NotesSection = (typeof NOTES_SECTIONS)[number];

const TOC_START = "<!-- toc: managed by pi-projects; do not edit by hand -->";
const TOC_END = "<!-- /toc -->";
const DATE_HEADING = /^###\s+(\d{4}-\d{2}-\d{2})\s*$/;

// ---------------------------------------------------------------------------
// paths and templates
// ---------------------------------------------------------------------------

export function contextPath(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), "CONTEXT.md");
}

export function notesPath(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), "notes.md");
}

export function archiveDir(paths: ProjectPaths, project: Project): string {
  return join(projectDir(paths, project), "archive");
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

export function notesTemplate(project: Project): string {
  return renderNotes(project.name, {
    header: [],
    sections: NOTES_SECTIONS.map((name) => ({ name, lines: [] })),
  });
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

export type ProjectFile = "notes" | "context" | "agents";

export function projectFilePath(paths: ProjectPaths, project: Project, file: ProjectFile): string {
  if (file === "notes") return notesPath(paths, project);
  if (file === "context") return contextPath(paths, project);
  return join(project.path, "AGENTS.md");
}

export function projectFileExists(paths: ProjectPaths, project: Project, file: ProjectFile): boolean {
  return existsSync(projectFilePath(paths, project, file));
}

/** Explicit creation only: the extension never prepares files on its own. */
export function createProjectFile(paths: ProjectPaths, project: Project, file: ProjectFile): void {
  const target = projectFilePath(paths, project, file);
  if (existsSync(target)) return;
  if (file === "notes") {
    atomicWrite(target, notesTemplate(project));
    return;
  }
  if (file === "context") {
    atomicWrite(target, contextTemplate(project));
    return;
  }
  // AGENTS.md lives in the repository: normal file mode, not 0600.
  writeFileSync(target, agentsTemplate(project), { mode: 0o644 });
}


// ---------------------------------------------------------------------------
// parsing and rendering
// ---------------------------------------------------------------------------

export interface ParsedNotes {
  /** Lines before the first `## ` heading, without the managed TOC block. */
  header: string[];
  sections: Array<{ name: string; lines: string[] }>;
}

function stripToc(lines: string[]): string[] {
  const start = lines.findIndex((line) => line.trim().startsWith("<!-- toc:"));
  if (start === -1) return lines;
  const end = lines.findIndex((line, index) => index > start && line.trim() === TOC_END);
  if (end === -1) return lines;
  return [...lines.slice(0, start), ...lines.slice(end + 1)];
}

export function parseNotes(text: string): ParsedNotes {
  const lines = stripToc(text.replace(/\r\n/g, "\n").split("\n"));
  const header: string[] = [];
  const sections: ParsedNotes["sections"] = [];
  let current: { name: string; lines: string[] } | undefined;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current) sections.push(current);
      current = { name: heading[1], lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else header.push(line);
  }
  if (current) sections.push(current);
  return { header, sections };
}

function trimBlank(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** Canonical sections first (in order, missing ones created), unknown preserved. */
export function ensureSections(parsed: ParsedNotes): ParsedNotes {
  const byName = new Map(parsed.sections.map((section) => [section.name.toLowerCase(), section]));
  const sections: ParsedNotes["sections"] = [];
  for (const name of NOTES_SECTIONS) {
    const existing = byName.get(name.toLowerCase());
    sections.push({ name, lines: existing ? [...existing.lines] : [] });
    if (existing) byName.delete(name.toLowerCase());
  }
  for (const section of parsed.sections) {
    const remaining = byName.get(section.name.toLowerCase());
    if (remaining === section) {
      sections.push({ name: section.name, lines: [...section.lines] });
      byName.delete(section.name.toLowerCase());
    }
  }
  return { header: [...parsed.header], sections };
}

export function renderNotes(projectName: string, parsed: ParsedNotes): string {
  const withSections = ensureSections(parsed);
  const header = trimBlank(withSections.header).filter((line) => !line.startsWith("# "));
  const lines: string[] = [`# Notes — ${projectName}`, ""];
  lines.push(TOC_START, ...withSections.sections.map((section) => `- ${section.name}`), TOC_END);
  for (const section of withSections.sections) {
    lines.push("");
    lines.push(`## ${section.name}`);
    const body = trimBlank(section.lines);
    if (body.length > 0) lines.push(...body);
  }
  if (header.length > 0) lines.push("", ...header);
  return `${trimBlank(lines).join("\n")}\n`;
}

export function sectionMap(text: string): NotesMapEntry[] {
  const lines = text.split("\n");
  const entries: NotesMapEntry[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[index]);
    if (!heading) continue;
    let end = index + 1;
    while (end < lines.length && !/^##\s+/.test(lines[end])) end += 1;
    entries.push({ section: heading[1], start: index + 1, lines: end - index });
    index = end - 1;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function bullets(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

/** Normalise canonical sections in place so mutations stick to the caller's object. */
function normalizeInPlace(parsed: ParsedNotes): void {
  const normalized = ensureSections(parsed);
  parsed.header = normalized.header;
  parsed.sections = normalized.sections;
}

export function appendEntry(
  parsed: ParsedNotes,
  section: NotesSection,
  text: string,
  date = today(),
): void {
  const items = bullets(text);
  if (items.length === 0) throw new Error("Nothing to write");
  normalizeInPlace(parsed);
  const target = parsed.sections.find((entry) => entry.name === section);
  if (!target) throw new Error(`Section ${section} is missing`);
  if (section === "Focus") {
    target.lines.push(...items.map((item) => `- ${item}`));
    return;
  }
  if (section === "Log") {
    const lines = target.lines;
    const blocks: Array<{ date?: string; lines: string[] }> = [];
    for (const line of lines) {
      const match = DATE_HEADING.exec(line);
      if (match) blocks.push({ date: match[1], lines: [line] });
      else if (blocks.length === 0) blocks.push({ lines: [line] });
      else blocks[blocks.length - 1].lines.push(line);
    }
    const head = blocks.length > 0 && blocks[0].date === undefined ? blocks.shift()!.lines : [];
    const existing = blocks.find((block) => block.date === date);
    if (existing) {
      existing.lines.push(...items.map((item) => `- ${item}`));
    } else {
      blocks.unshift({ date, lines: [`### ${date}`, ...items.map((item) => `- ${item}`)] });
    }
    target.lines = trimBlank([...trimBlank(head), "", ...blocks.flatMap((block) => [...trimBlank(block.lines), ""])]);
    return;
  }
  target.lines.push(...items.map((item) => `- ${date} ${item}`));
}

export function setFocus(parsed: ParsedNotes, text: string, maxLines: number): void {
  const items = bullets(text);
  if (items.length === 0) throw new Error("Focus cannot be empty");
  if (items.length > maxLines) {
    throw new Error(`Focus is limited to ${maxLines} lines (got ${items.length})`);
  }
  normalizeInPlace(parsed);
  const target = parsed.sections.find((entry) => entry.name === "Focus");
  if (!target) throw new Error("Focus section is missing");
  target.lines = items.map((item) => `- ${item}`);
}

/** Move the oldest Log date blocks to `archive/YYYY-MM.md` until under `maxLines`. */
export function rotateNotes(
  paths: ProjectPaths,
  project: Project,
  parsed: ParsedNotes,
  maxLines: number,
): string[] {
  normalizeInPlace(parsed);
  const log = parsed.sections.find((entry) => entry.name === "Log");
  if (!log) return [];
  const archived: string[] = [];
  let total = log.lines.filter((line) => line.trim() !== "").length;
  const blocks: Array<{ date?: string; lines: string[] }> = [];
  for (const line of log.lines) {
    const match = DATE_HEADING.exec(line);
    if (match) blocks.push({ date: match[1], lines: [line] });
    else if (blocks.length === 0) blocks.push({ lines: [line] });
    else blocks[blocks.length - 1].lines.push(line);
  }
  const head = blocks.length > 0 && blocks[0].date === undefined ? blocks.shift()! : undefined;
  while (total > maxLines && blocks.length > 1) {
    const oldest = blocks.pop()!;
    if (!oldest.date) break;
    const month = oldest.date.slice(0, 7);
    const dir = archiveDir(paths, project);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${month}.md`);
    const existing = existsSync(file) ? readFileSync(file, "utf8").replace(/\s+$/, "\n") : `# Notes archive — ${project.name}\n`;
    atomicWrite(file, `${existing}\n${trimBlank(oldest.lines).join("\n")}\n`);
    total -= trimBlank(oldest.lines).filter((line) => line.trim() !== "").length;
    archived.push(file);
  }
  log.lines = trimBlank([
    ...(head ? trimBlank(head.lines) : []),
    "",
    ...blocks.flatMap((block) => [...trimBlank(block.lines), ""]),
  ]);
  return archived;
}

// ---------------------------------------------------------------------------
// file operations
// ---------------------------------------------------------------------------

export function readContext(paths: ProjectPaths, project: Project): string {
  try {
    return readFileSync(contextPath(paths, project), "utf8");
  } catch {
    return "";
  }
}

export function writeContext(paths: ProjectPaths, project: Project, text: string): void {
  atomicWrite(contextPath(paths, project), text.endsWith("\n") ? text : `${text}\n`);
}

export function readNotesText(paths: ProjectPaths, project: Project): string {
  try {
    return readFileSync(notesPath(paths, project), "utf8");
  } catch {
    return notesTemplate(project);
  }
}

export interface LoadedNotes {
  text: string;
  parsed: ParsedNotes;
  map: NotesMapEntry[];
}

export function loadNotes(paths: ProjectPaths, project: Project): LoadedNotes {
  const text = readNotesText(paths, project);
  return { text, parsed: parseNotes(text), map: sectionMap(text) };
}

export function writeNotes(
  paths: ProjectPaths,
  project: Project,
  parsed: ParsedNotes,
  maxLines: number,
): { text: string; map: NotesMapEntry[]; archived: string[] } {
  const normalized = ensureSections(parsed);
  const archived = rotateNotes(paths, project, normalized, maxLines);
  const text = renderNotes(project.name, normalized);
  atomicWrite(notesPath(paths, project), text);
  return { text, map: sectionMap(text), archived };
}

/** True when notes contain at least one real entry (not just headings/templates). */
export function notesHaveContent(paths: ProjectPaths, project: Project): boolean {
  const { parsed } = loadNotes(paths, project);
  for (const section of parsed.sections) {
    for (const line of section.lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("<!--")) continue;
      if (/^-{3,}$/.test(trimmed)) continue;
      if (trimmed.startsWith("-") || trimmed.startsWith("###")) return true;
    }
  }
  return false;
}

export function notesStats(paths: ProjectPaths, project: Project): { bytes: number; lines: number } {
  try {
    const stats = statSync(notesPath(paths, project));
    const text = readFileSync(notesPath(paths, project), "utf8");
    return { bytes: stats.size, lines: text.split("\n").length };
  } catch {
    return { bytes: 0, lines: 0 };
  }
}

// ---------------------------------------------------------------------------
// prompt rendering
// ---------------------------------------------------------------------------

function sectionBullets(parsed: ParsedNotes, name: string): string[] {
  const section = parsed.sections.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!section) return [];
  return section.lines.map((line) => line.trim()).filter((line) => line.startsWith("-") || DATE_HEADING.test(line));
}

function logTail(parsed: ParsedNotes, count: number): string[] {
  const section = parsed.sections.find((entry) => entry.name.toLowerCase() === "log");
  if (!section) return [];
  const items = section.lines.map((line) => line.trim()).filter((line) => line.startsWith("-"));
  return items.slice(0, count);
}

/**
 * Compact notes for the system prompt: Focus, Decisions, Gotchas, open count,
 * recent log. Budget-limited; the full file is available through `project_notes`.
 */
export function renderNotesForPrompt(
  project: Project,
  parsed: ParsedNotes,
  tailEntries: number,
  budget: number,
): string {
  const focus = sectionBullets(parsed, "Focus");
  const decisions = sectionBullets(parsed, "Decisions");
  const gotchas = sectionBullets(parsed, "Gotchas");
  const open = sectionBullets(parsed, "Open");
  const log = logTail(parsed, tailEntries);
  if (focus.length + decisions.length + gotchas.length + open.length + log.length === 0) return "";

  const lines: string[] = [];
  const push = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    lines.push(...items);
    lines.push("");
  };
  if (focus.length > 0) push("Focus", focus);
  if (decisions.length > 0) push("Decisions", decisions.slice(-12));
  if (gotchas.length > 0) push("Gotchas", gotchas.slice(-8));
  if (open.length > 0) push("Open", [`- ${open.length} open question(s) — see project_notes read`]);
  if (log.length > 0) push("Recent log", log);

  let text = `# Private notes for ${project.name}\n\n${lines.join("\n").trim()}`;
  if (text.length > budget) text = `${text.slice(0, budget - 1)}…`;
  return text;
}

// ---------------------------------------------------------------------------
// search and secrets
// ---------------------------------------------------------------------------

export function searchNotes(
  paths: ProjectPaths,
  project: Project,
  query: string,
  limit = 20,
): Array<{ file: string; line: number; text: string }> {
  const needle = query.toLowerCase();
  const results: Array<{ file: string; line: number; text: string }> = [];
  const files = [contextPath(paths, project), notesPath(paths, project)];
  const dir = archiveDir(paths, project);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
      files.push(join(dir, name));
    }
  }
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let index = 0; index < lines.length && results.length < limit; index += 1) {
      if (lines[index].toLowerCase().includes(needle)) {
        results.push({ file, line: index + 1, text: lines[index].trim() });
      }
    }
    if (results.length >= limit) break;
  }
  return results;
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
