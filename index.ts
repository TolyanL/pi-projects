/**
 * pi-projects — projects, private context and notes for pi.
 *
 * A project is a directory with its own pi session: switching projects means
 * switching to a session whose cwd is that directory, which re-roots tools,
 * AGENTS.md, .pi config, skills and MCP servers. Private context and notes live
 * in `<agent-dir>/pi-projects/`, never in the repository.
 *
 * There is no persistent overlay. `/projects` opens a dock in pi's editor slot
 * (same idiom as rpiv-ask-user-question): the transcript stays visible above,
 * esc closes the dock and returns the editor. The footer status line always
 * shows the active project and what the agent is doing.
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPaths } from "./format.ts";
import { ensureBaseDir, ensureFirstProject, loadConfig } from "./registry.ts";
import { createStatus } from "./status.ts";
import { registerContext } from "./context.ts";
import { registerNotesTool } from "./notes-tool.ts";
import { registerCommands } from "./commands.ts";
import type { Deps } from "./deps.ts";

export default function piProjects(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const paths = createPaths(agentDir);
  ensureBaseDir(paths);
  const config = loadConfig(paths);

  const deps: Deps = {
    pi,
    paths,
    agentDir,
    config,
    status: undefined as unknown as Deps["status"],
    pending: undefined,
  };
  const status = createStatus(pi, deps);
  deps.status = status;

  registerContext(pi, deps);
  registerNotesTool(pi, deps);
  registerCommands(pi, deps);

  pi.on("session_start", (_event, ctx) => {
    try {
      if (ctx.hasUI) ensureFirstProject(paths, agentDir, ctx.cwd);
    } catch {
      // registry problems must not block startup
    }
    status.setWorking(!ctx.isIdle(), ctx);
    void status.refresh(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    status.setWorking(true, ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    status.setWorking(false, ctx);
    void status.refresh(ctx);
    if (deps.pending) {
      // Commands cannot run inside agent_settled; dispatch one after settling.
      pi.sendUserMessage("/projects-apply-pending", { expandPromptTemplates: true });
    }
  });

  pi.on("agent_end", (event) => {
    let failed = false;
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index];
      if (message.role !== "assistant") continue;
      failed = message.stopReason === "error";
      break;
    }
    status.setError(failed);
  });

  pi.events.on("subagent:async-started", () => status.bumpSubagents(1));
  pi.events.on("subagent:async-complete", () => status.bumpSubagents(-1));

  const shortcut = config.pickerShortcut ?? "ctrl+shift+p";
  try {
    pi.registerShortcut(shortcut, {
      description: "Projects: open the project dock",
      handler: () => {
        pi.sendUserMessage("/projects", { expandPromptTemplates: true });
      },
    });
  } catch {
    try {
      pi.registerShortcut("ctrl+shift+o", {
        description: "Projects: open the project dock",
        handler: () => {
          pi.sendUserMessage("/projects", { expandPromptTemplates: true });
        },
      });
    } catch {
      // no shortcut available in this terminal
    }
  }
}
