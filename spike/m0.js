/**
 * M0 spike extension for pi-projects.
 *
 * Goal: prove the switching mechanics on a live pi with as little code as possible.
 *  - create a header-only session file for a project that has no history;
 *  - switch to it with ctx.switchSession();
 *  - show a left non-capturing overlay with the project list and agent status;
 *  - inject a private CONTEXT.md into the system prompt.
 *
 * This file is plain ESM JavaScript so the headless harness can import the same
 * code the extension uses. Not shipped as the real extension (see ../index.ts).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// core helpers (also used by the headless harness)
// ---------------------------------------------------------------------------

/**
 * Create an empty pi session file for `cwd`.
 *
 * pi only materialises a session file after the first user/assistant message,
 * so a project without history has no file to switch to. We write the session
 * header ourselves; SessionManager.open() then treats it as an existing
 * session (flushed=true) and appends the first message to the same file.
 */
export function createEmptySession(cwd) {
  const manager = SessionManager.create(resolve(cwd));
  const dir = manager.getSessionDir();
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const file = join(dir, `${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`);
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id, timestamp, cwd: resolve(cwd) })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return file;
}

/** Newest session file for `cwd`, or undefined. pi sorts file names descending. */
export function latestSession(cwd) {
  const manager = SessionManager.create(resolve(cwd));
  const dir = manager.getSessionDir();
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort((a, b) => b.localeCompare(a));
  return files.length > 0 ? join(dir, files[0]) : undefined;
}

/** Open or create a session for a project and return its path. */
export function ensureSession(cwd) {
  return latestSession(cwd) ?? createEmptySession(cwd);
}

export function countSessions(cwd) {
  try {
    const dir = SessionManager.create(resolve(cwd)).getSessionDir();
    return readdirSync(dir).filter((name) => name.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

export function ageLabel(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function sessionAge(cwd) {
  const file = latestSession(cwd);
  if (!file) return undefined;
  try {
    return ageLabel(statSync(file).mtimeMs);
  } catch {
    return undefined;
  }
}

export function privateContextPath() {
  return process.env.PI_M0_CONTEXT ?? join(homedir(), ".pi", "agent", "m0-context.md");
}

export function readPrivateContext() {
  try {
    return readFileSync(privateContextPath(), "utf8").trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// tiny panel component (no pi-tui imports: spike runs in the headless harness too)
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const ACCENT = "\x1b[36m";
const WARN = "\x1b[33m";
const ERROR = "\x1b[31m";

/** Strip ANSI sequences so we can truncate by visible width. */
function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleWidth(text) {
  return stripAnsi(text).length;
}

/** Truncate to a visible width, keeping ANSI escapes and adding an ellipsis. */
export function truncate(text, width) {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  const limit = Math.max(0, width - 1);
  for (let index = 0; index < text.length; ) {
    if (text[index] === "\x1b") {
      const match = /^\x1b\[[0-9;]*m/.exec(text.slice(index));
      if (match) {
        out += match[0];
        index += match[0].length;
        continue;
      }
    }
    if (used >= limit) break;
    out += text[index];
    used += 1;
    index += 1;
  }
  return `${out}\x1b[0m…`;
}

/** Fit a string into exactly `width` visible columns. */
function fit(text, width) {
  const clipped = truncate(text, width);
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/** Left text plus right-aligned markers inside the content area. */
function rowWithMarkers(left, markers, width) {
  const markerText = markers.filter(Boolean).join(" ");
  const markerWidth = visibleWidth(markerText);
  const leftWidth = Math.max(1, width - markerWidth - (markerWidth > 0 ? 1 : 0));
  const clippedLeft = truncate(left, leftWidth);
  const gap = Math.max(0, width - visibleWidth(clippedLeft) - markerWidth);
  return fit(clippedLeft + " ".repeat(gap) + markerText, width);
}

export function renderPanel(state, width, rows) {
  const contentWidth = Math.max(8, width - 4);
  const lines = [];
  const row = (content = "") => lines.push(`│ ${fit(content, contentWidth)} │`);
  const title = " Projects ";
  lines.push(`┌${title}${"─".repeat(Math.max(0, width - 2 - title.length))}┐`);

  for (const project of state.projects) {
    const active = project.path === state.activePath;
    const name = active ? `${ACCENT}${BOLD}${project.name}${RESET}` : project.name;
    const markers = [];
    if (active && state.working) markers.push(`${ACCENT}●${RESET}`);
    if (project.subagents > 0) markers.push(`${WARN}⚙${project.subagents}${RESET}`);
    if (project.stale) markers.push(`${WARN}?${RESET}`);
    if (project.error) markers.push(`${ERROR}!${RESET}`);
    if (project.notes) markers.push(`${DIM}✎${RESET}`);
    row(rowWithMarkers(`${active ? "▸" : " "} ${name}`, markers, contentWidth));
    const meta = [project.sessionAge, project.sessions > 0 ? `${project.sessions} sess` : "no sessions"]
      .filter(Boolean)
      .join(" · ");
    row(`  ${DIM}${meta}${RESET}`);
  }

  row("");
  row(`${DIM}+ /m0 add <path>${RESET}`);
  row(`${DIM}  /m0 panel · /m0 open${RESET}`);
  while (lines.length < rows) row();
  lines.push(`└${"─".repeat(Math.max(0, width - 2))}┘`);
  return lines;
}

// ---------------------------------------------------------------------------
// extension
// ---------------------------------------------------------------------------

export default function m0Extension(pi) {
  /** @type {{projects: Array<{name: string, path: string, sessions: number, sessionAge?: string, notes: boolean, stale: boolean, subagents: number, error: boolean}>, activePath: string, working: boolean}} */
  const state = {
    projects: [],
    activePath: process.cwd(),
    working: false,
  };
  const contextPath = privateContextPath();
  const injected = readPrivateContext();
  let handle;
  let component;
  let tui;

  const initial = (process.env.PI_M0_PROJECTS ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (initial.length === 0) initial.push(process.cwd());

  function refresh() {
    state.projects = initial.map((path) => {
      const existing = state.projects.find((project) => project.path === path);
      return {
        name: basename(path),
        path,
        sessions: countSessions(path),
        sessionAge: sessionAge(path),
        notes: existing ? existing.notes : false,
        stale: !existsSync(path),
        subagents: existing ? existing.subagents : 0,
        error: existing ? existing.error : false,
      };
    });
    for (const extra of state.projects) {
      if (!initial.includes(extra.path)) initial.push(extra.path);
    }
    component?.invalidate();
    tui?.requestRender();
  }

  function startPanel(ctx) {
    if (!ctx.hasUI || component) return;
    void ctx.ui.custom(
      (candidate, theme, _keybindings, done) => {
        tui = candidate;
        component = {
          render: (width) => renderPanel(state, width, Math.max(12, tui.rows ? tui.rows - 2 : 30)),
          handleInput: () => {},
          invalidate: () => {},
          dispose: () => {
            component = undefined;
            tui = undefined;
            done();
          },
        };
        return component;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "top-left",
          width: 30,
          maxHeight: "100%",
          margin: { left: 0 },
          nonCapturing: true,
          visible: (width) => width >= 60,
        },
        onHandle: (overlay) => {
          handle = overlay;
          overlay.unfocus();
        },
      },
    );
  }

  pi.on("session_start", (_event, ctx) => {
    state.activePath = ctx.cwd;
    state.working = !ctx.isIdle();
    refresh();
    startPanel(ctx);
    ctx.ui.setStatus("m0", `project: ${basename(ctx.cwd)}`);
  });

  pi.on("session_shutdown", () => {
    handle?.hide();
    handle = undefined;
    component = undefined;
  });

  pi.on("before_agent_start", (event) => {
    if (!injected) return;
    event.systemPromptOptions.sections.m0_context = injected;
    event.systemPromptOptions.promptGuidelines.push(
      "M0 spike: the <m0_context> section is private project context, never copy it into the repository.",
    );
  });

  pi.on("agent_start", () => {
    state.working = true;
    component?.invalidate();
    tui?.requestRender();
  });
  pi.on("agent_settled", () => {
    state.working = false;
    refresh();
  });

  const bumpSubagents = (delta) => {
    const project = state.projects.find((entry) => entry.path === state.activePath);
    if (project) project.subagents = Math.max(0, project.subagents + delta);
    component?.invalidate();
    tui?.requestRender();
  };
  pi.events.on("subagent:async-started", () => bumpSubagents(1));
  pi.events.on("subagent:async-complete", () => bumpSubagents(-1));

  pi.registerCommand("m0", {
    description: "M0 spike: /m0 list | open <path> | add <path> | panel | context",
    handler: async (args, ctx) => {
      const [sub, ...rest] = args.trim().split(/\s+/);
      const value = rest.join(" ");
      if (sub === "list") {
        refresh();
        ctx.ui.notify(
          state.projects
            .map((p) => `${p.path === state.activePath ? "*" : " "} ${p.path} (${p.sessions} sess)`)
            .join("\n"),
          "info",
        );
        return;
      }
      if (sub === "add" && value) {
        const path = resolve(value.replace(/^~(?=\/|$)/, homedir()));
        if (!existsSync(path)) {
          ctx.ui.notify(`No such directory: ${path}`, "error");
          return;
        }
        initial.push(path);
        refresh();
        ctx.ui.notify(`Added ${path}`, "info");
        return;
      }
      if (sub === "open" && value) {
        const path = resolve(value.replace(/^~(?=\/|$)/, homedir()));
        if (!existsSync(path)) {
          ctx.ui.notify(`No such directory: ${path}`, "error");
          return;
        }
        const file = ensureSession(path);
        const result = await ctx.switchSession(file, {
          withSession: async (next) => {
            next.ui.notify(`Switched to ${basename(path)} (cwd ${next.cwd})`, "info");
          },
        });
        if (result.cancelled) ctx.ui.notify("Switch cancelled", "warning");
        return;
      }
      if (sub === "panel") {
        if (component) {
          handle?.hide();
          component = undefined;
        } else {
          startPanel(ctx);
        }
        return;
      }
      if (sub === "context") {
        ctx.ui.notify(`cwd=${ctx.cwd}\ncontext=${contextPath}\nbytes=${injected.length}`, "info");
        return;
      }
      ctx.ui.notify("Usage: /m0 list | open <path> | add <path> | panel | context", "warning");
    },
  });
}
