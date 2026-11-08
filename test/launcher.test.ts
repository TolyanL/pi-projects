import test from "node:test";
import assert from "node:assert/strict";
import { detectLauncher, fallbackCommand, shellQuote } from "../launcher.ts";
import type { Project } from "../types.ts";

const project: Project = {
  id: "x",
  name: "demo",
  path: "/home/me/work/my repo",
  addedAt: "",
  lastOpenedAt: "",
};

test("detects tmux and passes the path as argv", () => {
  const spec = detectLauncher(project, { TMUX: "/tmp/tmux-1000/default,1,0" });
  assert.equal(spec?.kind, "argv");
  if (spec?.kind === "argv") {
    assert.equal(spec.command, "tmux");
    assert.deepEqual(spec.args.slice(0, 5), ["new-window", "-c", project.path, "-n", "demo"]);
  }
});

test("detects wezterm, kitty and windows terminal", () => {
  const wez = detectLauncher(project, { WEZTERM_PANE: "1" });
  assert.equal(wez?.kind, "argv");
  if (wez?.kind === "argv") assert.equal(wez.command, "wezterm");

  const kitty = detectLauncher(project, { KITTY_WINDOW_ID: "1" });
  assert.equal(kitty?.kind, "argv");
  if (kitty?.kind === "argv") assert.equal(kitty.command, "kitty");

  const wt = detectLauncher(project, { WT_SESSION: "abc" });
  assert.equal(wt?.kind, "argv");
  if (wt?.kind === "argv") assert.equal(wt.command, "wt");
});

test("macOS terminals use osascript and quote the path", () => {
  const iterm = detectLauncher(project, { TERM_PROGRAM: "iTerm.app" });
  assert.equal(iterm?.kind, "osascript");
  if (iterm?.kind === "osascript") {
    assert.match(iterm.script, /iTerm2/);
    assert.match(iterm.script, /my repo/);
  }
  const apple = detectLauncher(project, { TERM_PROGRAM: "Apple_Terminal" });
  assert.equal(apple?.kind, "osascript");
});

test("unknown terminals fall back to a manual command", () => {
  assert.equal(detectLauncher(project, {}), undefined);
  assert.equal(fallbackCommand(project), "cd '/home/me/work/my repo' && pi");
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
});
