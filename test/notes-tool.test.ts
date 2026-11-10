import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPaths, DEFAULT_CONFIG } from "../format.ts";
import { addProject } from "../registry.ts";
import { writeNote } from "../notes.ts";
import type { Deps } from "../deps.ts";
import { ALL_NOTES_TOOL, NOTES_TOOL, registerNotesTool } from "../notes-tool.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pi-tools-"));
  const agentDir = join(dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const paths = createPaths(agentDir);
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const { project } = addProject(paths, agentDir, { path: repo, name: "demo" });
  writeNote(paths, project!, { title: "How auth works", description: "tokens", content: "body" });

  const tools = new Map<string, { execute: (...args: unknown[]) => Promise<unknown> }>();
  const pi = {
    registerTool: (definition: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) => {
      tools.set(definition.name, definition);
    },
  };
  const deps = {
    pi,
    paths,
    agentDir,
    config: DEFAULT_CONFIG,
    status: {
      refresh: () => {},
      setQueued: () => {},
      setWorking: () => {},
      bumpSubagents: () => {},
      setError: () => {},
    },
    pending: undefined,
  } as unknown as Deps;
  registerNotesTool(pi as never, deps);
  return { dir, paths, project: project!, tools };
}

const ctx = (cwd: string) => ({ cwd });

test("all_project_notes runs with a tool context", async () => {
  const { project, tools } = setup();
  const tool = tools.get(ALL_NOTES_TOOL);
  assert.ok(tool, "all_project_notes registered");
  const result = (await tool!.execute("id", {}, undefined, undefined, ctx(project.path))) as {
    content: Array<{ text: string }>;
  };
  assert.match(result.content[0].text, /How auth works/);
});

test("project_notes list runs with a tool context", async () => {
  const { project, tools } = setup();
  const tool = tools.get(NOTES_TOOL);
  assert.ok(tool, "project_notes registered");
  const result = (await tool!.execute(
    "id",
    { action: "list" },
    undefined,
    undefined,
    ctx(project.path),
  )) as { content: Array<{ text: string }> };
  assert.match(result.content[0].text, /How auth works/);
});
