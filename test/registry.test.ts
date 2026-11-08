import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaths } from "../format.ts";
import {
  addProject,
  ensureFirstProject,
  ensureBaseDir,
  findByCwd,
  loadConfig,
  loadDrafts,
  loadRegistry,
  projectDir,
  removeProject,
  saveConfig,
  setProjectPrivate,
  saveDraft,
  takeDraft,
  validateProjectPath,
} from "../registry.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-projects-reg-"));
  const agentDir = join(root, "agent");
  const repo = join(root, "repo");
  const other = join(root, "other");
  for (const dir of [agentDir, repo, other]) mkdirSync(dir, { recursive: true });
  const paths = createPaths(agentDir);
  ensureBaseDir(paths);
  return { root, agentDir, repo, other, paths };
}

test("validates project directories and refuses pi's config dir", () => {
  const { agentDir, repo } = setup();
  assert.equal(validateProjectPath(repo, agentDir).ok, true);
  assert.equal(validateProjectPath(join(agentDir, "..", "missing"), agentDir).ok, false);
  assert.equal(validateProjectPath(agentDir, agentDir).ok, false);
  const inside = join(agentDir, "sessions");
  mkdirSync(inside, { recursive: true });
  assert.equal(validateProjectPath(inside, agentDir).ok, false);
});

test("adds projects, dedupes real paths and persists", () => {
  const { agentDir, repo, paths } = setup();
  const first = addProject(paths, agentDir, { path: repo });
  assert.ok(first.project);
  const second = addProject(paths, agentDir, { path: repo });
  assert.equal(second.project!.id, first.project!.id);
  assert.equal(loadRegistry(paths).projects.length, 1);

  const link = join(repo, "..", "link-to-repo");
  symlinkSync(repo, link);
  const third = addProject(paths, agentDir, { path: link });
  assert.equal(third.project!.id, first.project!.id, "symlinked path is the same project");
  assert.equal(realpathSync(third.project!.path), realpathSync(repo));
});

test("findByCwd matches the root and subdirectories", () => {
  const { agentDir, repo, other, paths } = setup();
  const { project } = addProject(paths, agentDir, { path: repo });
  addProject(paths, agentDir, { path: other });
  const registry = loadRegistry(paths);
  assert.equal(findByCwd(registry, repo)?.id, project!.id);
  const nested = join(repo, "src", "deep");
  mkdirSync(nested, { recursive: true });
  assert.equal(findByCwd(registry, nested)?.id, project!.id);
  assert.equal(findByCwd(registry, join(other, "x"))?.path, realpathSync(other));
});

test("removes projects without touching disk", () => {
  const { agentDir, repo, paths } = setup();
  const { project } = addProject(paths, agentDir, { path: repo });
  const removed = removeProject(paths, "repo");
  assert.equal(removed.project?.id, project!.id);
  assert.equal(loadRegistry(paths).projects.length, 0);
  assert.equal(validateProjectPath(repo, agentDir).ok, true);
});

test("projects can be marked private", () => {
  const { agentDir, repo, paths } = setup();
  const { project } = addProject(paths, agentDir, { path: repo });
  assert.equal(project!.private, false);
  setProjectPrivate(paths, project!.id, true);
  const loaded = loadRegistry(paths).projects.find((entry) => entry.id === project!.id);
  assert.equal(loaded?.private, true);
  setProjectPrivate(paths, project!.id, false);
  assert.equal(loadRegistry(paths).projects[0].private, false);
});

test("config merges defaults and persists", () => {
  const { paths } = setup();
  const defaults = loadConfig(paths);
  assert.equal(defaults.context.maxChars, 32768);
  assert.equal(defaults.storage.root, "");
  assert.equal(defaults.notes.promptEntries, 12);
  assert.equal(defaults.pickerShortcut, "ctrl+shift+p");
  defaults.notes.promptEntries = 30;
  saveConfig(paths, defaults);
  const loaded = loadConfig(paths);
  assert.equal(loaded.notes.promptEntries, 30);
  assert.equal(loaded.context.warnChars, 8192);
});

test("drafts are saved, taken once and ignore empty text", () => {
  const { agentDir, repo, paths } = setup();
  const { project } = addProject(paths, agentDir, { path: repo });
  saveDraft(paths, project!.id, "half-written prompt");
  assert.equal(takeDraft(paths, project!.id), "half-written prompt");
  assert.equal(takeDraft(paths, project!.id), undefined);
  saveDraft(paths, project!.id, "another");
  saveDraft(paths, project!.id, "   ");
  assert.deepEqual(Object.keys(loadDrafts(paths)), []);
});

test("project private dir is stable and outside the repo", () => {
  const { agentDir, repo, paths } = setup();
  const { project } = addProject(paths, agentDir, { path: repo });
  const dir = projectDir(paths, project!);
  assert.ok(dir.startsWith(paths.baseDir));
  assert.ok(!dir.startsWith(repo));
  assert.match(dir, /repo-[0-9a-f]{8}$/);
  assert.equal(projectDir(paths, project!), dir);
});

test("first run registers a git repository only", () => {
  const { agentDir, repo, paths } = setup();
  assert.equal(ensureFirstProject(paths, agentDir, repo).projects.length, 0);
  mkdirSync(join(repo, ".git"));
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  assert.equal(ensureFirstProject(paths, agentDir, repo).projects.length, 1);
});
