import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Project } from "../types.ts";
import { createPaths, DEFAULT_CONFIG } from "../format.ts";
import { addProject, loadRegistry, projectDir, setProjectPrivate } from "../registry.ts";
import {
  allNotesEntries,
  cleanupLegacyNotes,
  globalIndexText,
  listNotes,
  notesDir,
  notesIndexPath,
  parseNote,
  projectIndexText,
  promptNoteIndex,
  readNote,
  rebuildGlobalIndex,
  rebuildProjectIndex,
  searchProjectNotes,
  writeNote,
  writeNoteBody,
} from "../notes.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-notes-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const paths = createPaths(agentDir);
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const project: Project = {
    id: "11111111-2222-3333-4444-555555555555",
    name: "demo",
    path: repo,
    addedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  const { project: registered } = addProject(paths, agentDir, { path: repo, name: "demo" });
  return { dir, paths, project, registered: registered ?? project };
}

test("nothing is created until the first note is written", () => {
  const { paths, project } = fixture();
  assert.deepEqual(listNotes(paths, project), []);
  assert.equal(existsSync(notesIndexPath(paths, project)), false);
  assert.equal(existsSync(paths.indexFile), false);
  rebuildProjectIndex(paths, project);
  assert.equal(existsSync(notesIndexPath(paths, project)), false);
});

test("writeNote creates a note file with frontmatter and both indexes", () => {
  const { paths, registered } = fixture();
  const result = writeNote(paths, registered, {
    title: "How auth works",
    description: "Token refresh and middleware order",
    content: "Details live here.",
  });
  assert.equal(result.created, true);
  assert.equal(result.meta.file, "how-auth-works.md");

  const file = join(notesDir(paths, registered), result.meta.file);
  const raw = readFileSync(file, "utf8");
  assert.match(raw, /^---\ntitle: How auth works/);
  assert.match(raw, /description: Token refresh and middleware order/);
  assert.match(raw, /# How auth works/);
  assert.match(raw, /Details live here\./);

  const index = readFileSync(notesIndexPath(paths, registered), "utf8");
  assert.match(index, /- \*\*How auth works\*\* — Token refresh and middleware order — `notes\/how-auth-works\.md`/);

  const global = readFileSync(paths.indexFile, "utf8");
  assert.match(global, /## demo/);
  assert.match(
    global,
    new RegExp(`${basename(projectDir(paths, registered))}/notes/how-auth-works\\.md`),
  );
});

test("readNote resolves by title and by file", () => {
  const { paths, registered } = fixture();
  writeNote(paths, registered, { title: "How auth works", description: "d", content: "Body" });
  const byTitle = readNote(paths, registered, "How auth works");
  const byFile = readNote(paths, registered, "how-auth-works.md");
  assert.equal(byTitle?.meta.file, "how-auth-works.md");
  assert.equal(byFile?.meta.title, "How auth works");
  assert.match(byTitle?.body ?? "", /Body/);
});

test("writing the same title updates the note instead of duplicating it", () => {
  const { paths, registered } = fixture();
  writeNote(paths, registered, { title: "Same", description: "one", content: "first" });
  const second = writeNote(paths, registered, { title: "same", description: "two", content: "second" });
  assert.equal(second.created, false);
  assert.equal(readdirSync(notesDir(paths, registered)).length, 1);
  const doc = readNote(paths, registered, "same");
  assert.match(doc?.body ?? "", /second/);
  assert.equal(doc?.meta.description, "two");
});

test("hand-written notes without frontmatter still get indexed", () => {
  const { paths, registered } = fixture();
  const dir = notesDir(paths, registered);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manual.md"), "# Manual note\n\nWhat this note is about.\n");
  const notes = listNotes(paths, registered);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Manual note");
  assert.equal(notes[0].description, "What this note is about.");
  rebuildProjectIndex(paths, registered);
  assert.match(
    readFileSync(notesIndexPath(paths, registered), "utf8"),
    /- \*\*Manual note\*\* — What this note is about\. — `notes\/manual\.md`/,
  );
});

test("append extends the body and bumps updated", () => {
  const { paths, registered } = fixture();
  const note = writeNote(paths, registered, { title: "Journal", description: "d", content: "one" });
  writeNoteBody(paths, registered, note.meta.file, "one\n\ntwo");
  const doc = readNote(paths, registered, note.meta.file);
  assert.match(doc?.body ?? "", /one\n\ntwo/);
  assert.match(doc?.meta.updated ?? "", /^\d{4}-\d{2}-\d{2}$/);
});

test("legacy notes.md is removed", () => {
  const { paths, project } = fixture();
  const legacy = join(projectDir(paths, project), "notes.md");
  mkdirSync(join(projectDir(paths, project)), { recursive: true });
  writeFileSync(legacy, "old schema");
  assert.equal(cleanupLegacyNotes(paths, project), true);
  assert.equal(existsSync(legacy), false);
});

test("prompt index respects entry and character budgets", () => {
  const { paths, registered } = fixture();
  for (let index = 0; index < 5; index += 1) {
    writeNote(paths, registered, {
      title: `Note ${index}`,
      description: `description ${index}`,
      content: "x",
    });
  }
  const notes = listNotes(paths, registered);
  const text = promptNoteIndex(notes, 2, 10_000);
  assert.equal(text.split("\n").length, 3);
  assert.match(text, /…3 more notes/);
  assert.ok(promptNoteIndex(notes, 5, 30).length <= 30);
});

test("search finds text in note bodies", () => {
  const { paths, registered } = fixture();
  writeNote(paths, registered, {
    title: "Auth",
    description: "d",
    content: "refresh tokens happen here",
  });
  const results = searchProjectNotes(paths, registered, "refresh");
  assert.equal(results.length, 1);
  assert.equal(results[0].file, "auth.md");
});

test("parseNote falls back to the first heading", () => {
  const parsed = parseNote("# Title\n\nDescription line\n\nBody\n");
  assert.equal(parsed.meta.title, "Title");
  assert.equal(parsed.meta.description, "Description line");
  assert.match(parsed.body, /Body/);
});

test("global index can be rendered without writing", () => {
  const { paths, registered } = fixture();
  writeNote(paths, registered, { title: "A", description: "aa", content: "x" });
  const text = globalIndexText(paths, [{ project: registered, notes: listNotes(paths, registered) }]);
  assert.match(text, /# Notes — all projects/);
  assert.match(text, /## demo/);
  assert.match(text, /\*\*A\*\* — aa/);
  rebuildGlobalIndex(paths);
  assert.ok(existsSync(paths.indexFile));
});

test("projectIndexText and empty state", () => {
  const { project } = fixture();
  assert.match(projectIndexText(project, []), /_No notes yet\._/);
});

test("private projects stay out of the global index", () => {
  const { paths, registered } = fixture();
  writeNote(paths, registered, { title: "Secret", description: "hidden", content: "x" });
  const projectIndex = readFileSync(notesIndexPath(paths, registered), "utf8");
  assert.match(projectIndex, /Secret/);

  setProjectPrivate(paths, registered.id, true);
  rebuildGlobalIndex(paths);
  const privateGlobal = readFileSync(paths.indexFile, "utf8");
  assert.doesNotMatch(privateGlobal, /Secret/);
  assert.doesNotMatch(privateGlobal, /## demo/);
  // the project's own index keeps working
  assert.match(readFileSync(notesIndexPath(paths, registered), "utf8"), /Secret/);

  setProjectPrivate(paths, registered.id, false);
  rebuildGlobalIndex(paths);
  assert.match(readFileSync(paths.indexFile, "utf8"), /Secret/);
});

test("all_project_notes includes the current project when it is private", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-allnotes-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const paths = createPaths(agentDir);
  const build = (name: string, isPrivate: boolean) => {
    const repo = join(dir, name);
    mkdirSync(repo, { recursive: true });
    const { project } = addProject(paths, agentDir, { path: repo, name });
    if (project && isPrivate) setProjectPrivate(paths, project.id, true);
    return project!;
  };
  const shared = build("shared", false);
  const privateCurrent = build("private-current", true);
  const privateOther = build("private-other", true);
  for (const project of [shared, privateCurrent, privateOther]) {
    writeNote(paths, project, { title: `Note ${project.name}`, description: "d", content: "x" });
  }
  const registry = loadRegistry(paths);

  const fromPrivate = allNotesEntries(paths, registry.projects, privateCurrent);
  assert.deepEqual(
    fromPrivate.map((entry) => entry.project.name).sort(),
    ["private-current", "shared"],
  );
  const text = globalIndexText(paths, fromPrivate);
  assert.match(text, /Note shared/);
  assert.match(text, /Note private-current/);
  assert.doesNotMatch(text, /Note private-other/);

  const fromShared = allNotesEntries(paths, registry.projects, shared);
  assert.deepEqual(fromShared.map((entry) => entry.project.name), ["shared"]);
});

test("storage.root moves registry and indexes to another directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-root-"));
  const root = join(dir, "store");
  const paths = createPaths(dir, {
    ...DEFAULT_CONFIG,
    storage: { root },
  });
  assert.equal(paths.root, root);
  assert.equal(paths.registryFile, join(root, "registry.json"));
  assert.equal(paths.indexFile, join(root, "INDEX.md"));
  assert.equal(paths.configFile, join(dir, "pi-projects", "config.json"));
});
