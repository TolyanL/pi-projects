import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, ProjectPaths } from "../types.ts";
import { createPaths } from "../format.ts";
import { createProjectFile, projectFileExists } from "../store.ts";
import {
  appendEntry,
  archiveDir,
  contextTemplate,
  detectSecret,
  loadNotes,
  notesHaveContent,
  notesPath,
  notesTemplate,
  parseNotes,
  readNotesText,
  renderNotes,
  renderNotesForPrompt,
  rotateNotes,
  sectionMap,
  setFocus,
  writeNotes,
} from "../store.ts";

function fixture(): { paths: ProjectPaths; project: Project; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pi-projects-store-"));
  const paths = createPaths(dir);
  const project: Project = {
    id: "11111111-2222-3333-4444-555555555555",
    name: "demo",
    path: join(dir, "repo"),
    addedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  createProjectFile(paths, project, "context");
  createProjectFile(paths, project, "notes");
  return { paths, project, dir };
}

test("templates contain every canonical section and a managed toc", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const notes = notesTemplate(project);
  for (const name of ["Focus", "Decisions", "Gotchas", "Open", "Log"]) {
    assert.match(notes, new RegExp(`^## ${name}$`, "m"));
  }
  assert.match(notes, /<!-- toc: managed by pi-projects/);
  assert.match(notes, /<!-- \/toc -->/);
  assert.match(contextTemplate(project), /# demo/);
});

test("parse and render round-trip keeps section bodies", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const parsed = parseNotes(notesTemplate(project));
  appendEntry(parsed, "Decisions", "use header-only sessions");
  const text = renderNotes(project.name, parsed);
  const again = parseNotes(text);
  const decisions = again.sections.find((entry) => entry.name === "Decisions");
  assert.ok(decisions);
  assert.match(decisions!.lines.join("\n"), /use header-only sessions/);
  assert.equal(testCountToc(text), 5);
});

function testCountToc(text: string): number {
  const match = /<!-- toc:[\s\S]*?<!-- \/toc -->/.exec(text);
  if (!match) return 0;
  return match[0].split("\n").filter((line) => line.startsWith("- ")).length;
}

test("log entries group under today's date", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const parsed = parseNotes(notesTemplate(project));
  appendEntry(parsed, "Log", "first finding", "2026-02-14");
  appendEntry(parsed, "Log", "second finding", "2026-02-14");
  const text = renderNotes(project.name, parsed);
  assert.equal((text.match(/### 2026-02-14/g) ?? []).length, 1);
  assert.match(text, /- first finding/);
  assert.match(text, /- second finding/);
});

test("non-log entries are date-prefixed, focus is not", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const parsed = parseNotes(notesTemplate(project));
  appendEntry(parsed, "Gotchas", "switch aborts the run", "2026-02-14");
  setFocus(parsed, "ship M1", 3);
  const text = renderNotes(project.name, parsed);
  assert.match(text, /- 2026-02-14 switch aborts the run/);
  assert.match(text, /## Focus\n- ship M1/);
});

test("focus respects the line limit", () => {
  const parsed = parseNotes(notesTemplate({ name: "demo" } as Project));
  assert.throws(() => setFocus(parsed, "a\nb\nc\nd", 3), /limited to 3/);
});

test("section map points at real 1-based lines", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const parsed = parseNotes(notesTemplate(project));
  appendEntry(parsed, "Log", "hello", "2026-02-14");
  const text = renderNotes(project.name, parsed);
  const map = sectionMap(text);
  const lines = text.split("\n");
  for (const entry of map) {
    assert.equal(lines[entry.start - 1], `## ${entry.section}`);
    assert.ok(entry.lines >= 1);
  }
  assert.equal(map.length, 5);
});

test("writes notes, tracks content and rotates the oldest log block", () => {
  const { paths, project } = fixture();
  const parsed = parseNotes(notesTemplate(project));
  appendEntry(parsed, "Log", "old entry 1", "2026-01-01");
  appendEntry(parsed, "Log", "old entry 2", "2026-01-02");
  appendEntry(parsed, "Log", "today", "2026-02-14");
  const written = writeNotes(paths, project, parsed, 2);
  assert.ok(written.archived.length > 0, "expected rotation");
  const text = readFileSync(notesPath(paths, project), "utf8");
  assert.doesNotMatch(text, /old entry 1/);
  assert.match(text, /today/);
  assert.ok(existsSync(archiveDir(paths, project)));
  const archived = readdirSync(archiveDir(paths, project));
  assert.equal(archived.length, 1, "one file per month");
  const archivedText = readFileSync(join(archiveDir(paths, project), archived[0]), "utf8");
  assert.match(archivedText, /old entry 1/);
  assert.match(archivedText, /old entry 2/);
  assert.ok(notesHaveContent(paths, project));
});

test("files are created only on demand", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-projects-demand-"));
  const paths = createPaths(dir);
  const project: Project = {
    id: "x",
    name: "demo",
    path: join(dir, "repo"),
    addedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  mkdirSync(project.path, { recursive: true });
  assert.equal(projectFileExists(paths, project, "notes"), false);
  assert.equal(projectFileExists(paths, project, "context"), false);
  assert.equal(projectFileExists(paths, project, "agents"), false);
  createProjectFile(paths, project, "agents");
  assert.equal(projectFileExists(paths, project, "agents"), true);
  assert.ok(existsSync(join(project.path, "AGENTS.md")));
  createProjectFile(paths, project, "notes");
  assert.equal(projectFileExists(paths, project, "notes"), true);
});

test("template alone has no content", () => {
  const { paths, project } = fixture();
  assert.equal(notesHaveContent(paths, project), false);
});

test("compact prompt rendering is budgeted and includes focus/decisions", () => {
  const project: Project = {
    id: "x",
    name: "demo",
    path: "/tmp/demo",
    addedAt: "",
    lastOpenedAt: "",
  };
  const parsed = parseNotes(notesTemplate(project));
  setFocus(parsed, "ship M1", 3);
  appendEntry(parsed, "Decisions", "use header-only sessions", "2026-02-14");
  appendEntry(parsed, "Log", "ran harness", "2026-02-14");
  const summary = renderNotesForPrompt(project, parsed, 5, 10000);
  assert.match(summary, /ship M1/);
  assert.match(summary, /header-only sessions/);
  assert.match(summary, /ran harness/);
  const tiny = renderNotesForPrompt(project, parsed, 5, 40);
  assert.ok(tiny.length <= 40);
  assert.ok(tiny.endsWith("…"));
});

test("secret detection flags tokens and assignments", () => {
  assert.match(detectSecret("token = abcdef123456") ?? "", /token/);
  assert.match(detectSecret("sk-abcdefghijklmnopqrstuvwx") ?? "", /sk-/);
  assert.equal(detectSecret("ordinary prose about tokens"), undefined);
  assert.equal(detectSecret("<!-- token = something -->"), undefined);
});

test("unknown sections survive and are listed in the toc", () => {
  const text = [
    "# Notes — demo",
    "",
    "## Focus",
    "- ship",
    "",
    "## Scratchpad",
    "- custom section",
    "",
  ].join("\n");
  const parsed = parseNotes(text);
  const rendered = renderNotes("demo", parsed);
  assert.match(rendered, /## Scratchpad\n- custom section/);
  assert.match(rendered, /- Scratchpad/);
});
