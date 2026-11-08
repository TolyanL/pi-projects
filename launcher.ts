/**
 * Open a project in a separate pi process (new terminal tab/window).
 *
 * We never build shell strings from paths for the spawn itself: argv arrays
 * only. The shell-quoted fallback command is shown to the user, not executed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Project } from "./types.ts";

export interface LaunchResult {
  ok: boolean;
  message: string;
  command?: string;
}

export type LaunchSpec =
  | { kind: "argv"; command: string; args: string[] }
  | { kind: "osascript"; script: string };

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function fallbackCommand(project: Project): string {
  return `cd ${shellQuote(project.path)} && pi`;
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Pick a terminal-specific launcher from environment variables. */
export function detectLauncher(project: Project, env: NodeJS.ProcessEnv = process.env): LaunchSpec | undefined {
  const name = project.name;
  if (env.TMUX) {
    return { kind: "argv", command: "tmux", args: ["new-window", "-c", project.path, "-n", name, "pi"] };
  }
  if (env.WEZTERM_PANE) {
    return { kind: "argv", command: "wezterm", args: ["cli", "spawn", "--cwd", project.path, "--", "pi"] };
  }
  if (env.KITTY_WINDOW_ID) {
    return { kind: "argv", command: "kitty", args: ["@", "launch", "--type=tab", `--cwd=${project.path}`, "--", "pi"] };
  }
  if (env.WT_SESSION) {
    return { kind: "argv", command: "wt", args: ["-d", project.path, "pi"] };
  }
  if (env.TERM_PROGRAM === "iTerm.app") {
    const script = [
      'tell application "iTerm2"',
      "  tell current window",
      "    create tab with default profile",
      `    tell current session to write text "cd ${escapeAppleScript(shellQuote(project.path))} && pi"`,
      "  end tell",
      "end tell",
    ].join("\n");
    return { kind: "osascript", script };
  }
  if (env.TERM_PROGRAM === "Apple_Terminal") {
    const script = `tell application "Terminal" to do script "cd ${escapeAppleScript(shellQuote(project.path))} && pi" in front window`;
    return { kind: "osascript", script };
  }
  return undefined;
}

export async function launchInNewTab(pi: ExtensionAPI, project: Project): Promise<LaunchResult> {
  const spec = detectLauncher(project);
  const command = fallbackCommand(project);
  if (!spec) {
    return {
      ok: false,
      command,
      message: `Unknown terminal. Open a new tab manually:\n${command}`,
    };
  }
  try {
    const result =
      spec.kind === "argv"
        ? await pi.exec(spec.command, spec.args, { cwd: project.path, timeout: 5000 })
        : await pi.exec("osascript", ["-e", spec.script], { timeout: 5000 });
    if (result.code !== 0) {
      return {
        ok: false,
        command,
        message: `Could not open a tab (${spec.kind === "argv" ? spec.command : "osascript"} exited ${result.code}).\n${result.stderr.trim() || command}`,
      };
    }
    return { ok: true, message: `Opened ${project.name} in a new terminal tab.` };
  } catch (error) {
    return {
      ok: false,
      command,
      message: `Could not open a tab: ${error instanceof Error ? error.message : String(error)}\n${command}`,
    };
  }
}
