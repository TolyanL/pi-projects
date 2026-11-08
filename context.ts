/** Injects CONTEXT.md and compact notes into the system prompt. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deps } from "./deps.ts";
import { findByCwd, loadRegistry } from "./registry.ts";
import { loadNotes, readContext, renderNotesForPrompt } from "./store.ts";

const GUIDELINES = [
  "Private project notes live outside the repository. Record durable decisions with project_notes action \"decide\", pitfalls with \"gotcha\", open questions with \"open\", and today's findings with \"log\".",
  "Never copy CONTEXT.md, notes.md or the <pi_projects_private> section into files inside the repository.",
];

export function registerContext(pi: ExtensionAPI, deps: Deps): void {
  let warnedLarge = false;

  pi.on("before_agent_start", (event, ctx) => {
    let project;
    try {
      project = findByCwd(loadRegistry(deps.paths), ctx.cwd);
    } catch {
      return;
    }
    if (!project) return;

    const raw = readContext(deps.paths, project).trim();
    if (raw) {
      const limit = deps.config.context.maxChars;
      const text = raw.length > limit ? `${raw.slice(0, limit)}\n…(truncated)` : raw;
      if (!warnedLarge && raw.length > deps.config.context.warnChars && ctx.hasUI) {
        warnedLarge = true;
        ctx.ui.notify(
          `CONTEXT.md for ${project.name} is ${raw.length} chars and is injected into every request.`,
          "warning",
        );
      }
      // pi wraps each section value in its own XML tag; the value is plain text.
      event.systemPromptOptions.sections.pi_projects_private =
        `Project: ${project.name}\nPath: ${project.path}\n\n${text}`;
    }

    try {
      const notes = loadNotes(deps.paths, project);
      const summary = renderNotesForPrompt(
        project,
        notes.parsed,
        deps.config.notes.tailEntries,
        deps.config.context.promptNotesChars,
      );
      if (summary) event.systemPromptOptions.sections.pi_projects_notes = summary;
    } catch {
      // notes are best effort; never block a run because of them
    }

    event.systemPromptOptions.promptGuidelines.push(...GUIDELINES);
  });
}
