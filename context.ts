/** Injects CONTEXT.md and compact notes into the system prompt. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deps } from "./deps.ts";
import { findByCwd, loadRegistry } from "./registry.ts";
import { readContext } from "./store.ts";
import { listNotes, promptNoteIndex } from "./notes.ts";

const GUIDELINES = [
  "Project notes live outside the repository as markdown files under notes/. Read them with project_notes action \"list\" or \"read\"; create one with \"write\" (title, description, content) and extend one with \"append\". NOTES.md is a generated index, never edit it.",
  "Every other project has its own notes; all_project_notes lists their titles, descriptions and paths without switching projects.",
  "Never copy CONTEXT.md, notes or the <pi_projects_private> section into files inside the repository.",
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
      const notes = listNotes(deps.paths, project);
      const index = promptNoteIndex(
        notes,
        deps.config.notes.promptEntries,
        deps.config.notes.promptChars,
      );
      if (index) {
        event.systemPromptOptions.sections.pi_projects_notes =
          `Project: ${project.name}\nNotes are files under notes/; NOTES.md is the generated index.\n\n${index}`;
      }
    } catch {
      // notes are best effort; never block a run because of them
    }

    event.systemPromptOptions.promptGuidelines.push(...GUIDELINES);
  });
}
