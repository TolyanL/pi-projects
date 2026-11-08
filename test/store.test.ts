import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project } from "../types.ts";
import { createPaths } from "../format.ts";
import {
  createProjectFile,
  detectSecret,
  projectFileExists,
  projectFilePath,
  readContext,
  writeContext,
} from "../store.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-store-"));
  const paths = createPaths(dir);
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const project: Project = {
    id: "11111111-2222-3333-4444-555555555555",
    name: "demo",
    path: repo,
    addedAt: "",
    lastOpenedAt: "",
  };
  return { paths, project };
}

test("context and AGENTS.md are created only on demand", () => {
  const { paths, project } = fixture();
  assert.equal(projectFileExists(paths, project, "context"), false);
  assert.equal(projectFileExists(paths, project, "agents"), false);
  createProjectFile(paths, project, "context");
  assert.equal(projectFileExists(paths, project, "context"), true);
  assert.match(readContext(paths, project), /## What this is/);
  writeContext(paths, project, "# custom\n");
  assert.match(readContext(paths, project), /custom/);
});

test("AGENTS.md is written into the repository with normal permissions", () => {
  const { paths, project } = fixture();
  createProjectFile(paths, project, "agents");
  const file = projectFilePath(paths, project, "agents");
  assert.equal(file, join(project.path, "AGENTS.md"));
  assert.match(readFileSync(file, "utf8"), /# AGENTS\.md/);
  assert.equal(statSync(file).mode & 0o777, 0o644);
});

test("secret detection flags tokens but not prose", () => {
  assert.match(detectSecret("token = abcdef123456") ?? "", /token/);
  assert.match(detectSecret("sk-abcdefghijklmnopqrstuvwx") ?? "", /sk-/);
  assert.equal(detectSecret("ordinary prose about tokens"), undefined);
  assert.equal(detectSecret("<!-- token = something -->"), undefined);
});
