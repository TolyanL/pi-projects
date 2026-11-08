import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  dockBudget,
  dockProjectCount,
  projectRowCount,
  renderDock,
  selectedProject,
  type DockState,
} from "../picker.ts";
import type { Project } from "../types.ts";

const theme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
  style: (text: string) => text,
  colors: {},
  appearance: "dark",
} as unknown as Theme;

function project(id: string, name: string, lastOpenedAt: string): Project {
  return { id, name, path: `/tmp/${name}`, addedAt: lastOpenedAt, lastOpenedAt };
}

function state(overrides: Partial<DockState> = {}): DockState {
  return {
    projects: [
      project("a", "pi-extensions", "2026-02-14T10:00:00.000Z"),
      project("b", "pi-sounds", "2026-02-13T10:00:00.000Z"),
      project("c", "anymodel-provider", "2026-02-12T10:00:00.000Z"),
    ],
    activeId: "a",
    sessions: new Map([["/tmp/pi-extensions", { count: 4 }]]),
    query: "",
    selected: 0,
    stage: "projects",
    actionSelected: 0,
    fileSelected: 0,
    noteSelected: 0,
    ...overrides,
  };
}

test("dock budget follows the terminal height, floored and capped", () => {
  assert.equal(dockBudget({ terminal: { rows: 40 } }), 24);
  assert.equal(dockBudget({ terminal: { rows: 30 } }), 18);
  assert.equal(dockBudget({ terminal: { rows: 20 } }), 12);
  assert.equal(dockBudget({ terminal: { rows: 8 } }), 8);
});

test("every dock line has exactly the editor width", () => {
  for (const width of [40, 60, 80]) {
    for (const line of renderDock(state(), width, 24, theme)) {
      assert.equal(visibleWidth(line), width, `width ${width}: ${JSON.stringify(line)}`);
    }
  }
});

test("dock never exceeds its row budget", () => {
  for (const budget of [8, 10, 16, 24]) {
    assert.ok(renderDock(state(), 70, budget, theme).length <= budget, `budget ${budget}`);
    assert.ok(renderDock(state({ stage: "project", project: state().projects[0] }), 70, budget, theme).length <= budget);
  }
});

test("selection uses the model-picker idiom: arrow cursor and check for current", () => {
  const lines = renderDock(state({ selected: 1 }), 80, 24, theme).join("\n");
  assert.match(lines, /^│ →   pi-sounds\s/m);
  assert.match(lines, /^│   ✓ pi-extensions\s/m);
});

test("project list ends with an Add project row", () => {
  assert.equal(projectRowCount(state()), 4);
  const lines = renderDock(state({ selected: 3 }), 80, 24, theme).join("\n");
  assert.match(lines, /→ \+ Add project…/);
});

test("project stage lists every action in the UI", () => {
  const lines = renderDock(
    state({ stage: "project", project: state().projects[0], actionSelected: 4 }),
    80,
    24,
    theme,
  ).join("\n");
  for (const label of [
    "Project actions",
    "Open project (last session)",
    "New session",
    "Open in a new terminal tab",
    "Sessions…",
    "Files…",
    "Rename project…",
    "Remove from list…",
  ]) {
    assert.ok(lines.includes(label), `missing action: ${label}`);
  }
  assert.match(lines, /→ Files…/);
});

test("files stage lists context, index, notes and AGENTS", () => {
  const lines = renderDock(
    state({
      stage: "edit",
      project: state().projects[0],
      fileSelected: 1,
      files: { context: true, index: true, agents: false, count: 3 },
    }),
    80,
    24,
    theme,
  ).join("\n");
  assert.match(lines, /Project files/);
  assert.match(lines, /CONTEXT\.md/);
  assert.match(lines, /→ NOTES\.md/);
  assert.match(lines, /Notes…/);
  assert.match(lines, /3 note.*generated index/);
  assert.match(lines, /AGENTS\.md/);
  assert.match(lines, /not created/);
});

test("missing files are marked as not created", () => {
  const lines = renderDock(
    state({
      stage: "edit",
      project: state().projects[0],
      fileSelected: 0,
      files: { context: false, index: false, agents: false, count: 0 },
    }),
    80,
    24,
    theme,
  ).join("\n");
  assert.match(lines, /CONTEXT\.md\s+not created/);
  assert.match(lines, /NOTES\.md\s+no notes yet/);
});

test("notes stage lists New note and existing notes", () => {
  const lines = renderDock(
    state({
      stage: "notes",
      project: state().projects[0],
      noteSelected: 1,
      noteList: [
        { file: "auth.md", title: "How auth works", description: "token refresh", updated: "2026-02-14" },
        { file: "sessions.md", title: "Header-only sessions", description: "switch", updated: "2026-02-13" },
      ],
    }),
    80,
    24,
    theme,
  ).join("\n");
  assert.match(lines, /Notes/);
  assert.match(lines, /＋ New note…/);
  assert.match(lines, /→ How auth works/);
  assert.match(lines, /notes\/auth\.md/);
  assert.match(lines, /Header-only sessions/);
});

test("private projects carry a lock and the protection toggle", () => {
  const projects = state().projects;
  projects[0] = { ...projects[0], private: true };
  const list = renderDock(state({ projects }), 80, 24, theme).join("\n");
  assert.match(list, /🔒/);

  const actions = renderDock(
    state({
      projects,
      stage: "project",
      project: projects[0],
      actionSelected: 7,
    }),
    80,
    24,
    theme,
  ).join("\n");
  assert.match(actions, /→ Protection: private \(hidden from global index\)/);

  const shared = renderDock(
    state({ stage: "project", project: state().projects[1], actionSelected: 7 }),
    80,
    24,
    theme,
  ).join("\n");
  assert.match(shared, /Protection: shared/);
});

test("typing filters projects and reports an empty state", () => {
  assert.equal(dockProjectCount(state({ query: "pi-ext" })), 1);
  assert.equal(dockProjectCount(state({ query: "zzz" })), 0);
  assert.equal(selectedProject(state({ query: "pi-ext" }))?.name, "pi-extensions");
  const lines = renderDock(state({ query: "zzz", selected: 0 }), 70, 24, theme).join("\n");
  assert.match(lines, /No matching projects/);
  assert.match(lines, /Add project…/);
});
