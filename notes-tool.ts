/** The `project_notes` tool available to the agent. */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deps } from "./deps.ts";
import type { NotesSection } from "./store.ts";
import { findByCwd, loadRegistry } from "./registry.ts";
import {
  appendEntry,
  contextPath,
  loadNotes,
  notesPath,
  projectFileExists,
  readContext,
  searchNotes,
  setFocus,
  writeNotes,
  type ParsedNotes,
} from "./store.ts";

export const NOTES_TOOL = "project_notes";

const ACTIONS = ["read", "log", "decide", "gotcha", "open", "set_focus", "search"] as const;
type Action = (typeof ACTIONS)[number];

function requireProject(deps: Deps, cwd: string) {
  const project = findByCwd(loadRegistry(deps.paths), cwd);
  if (!project) {
    throw new Error(
      "The current directory is not a registered project. Open /projects and add it first.",
    );
  }
  return project;
}

function formatMap(parsed: ParsedNotes): string {
  const lines: string[] = [];
  for (const section of parsed.sections) {
    const body = section.lines.filter((line) => line.trim() !== "");
    lines.push(`## ${section.name} (${body.length} line(s))`);
  }
  return lines.join("\n");
}

export function registerNotesTool(pi: ExtensionAPI, deps: Deps): void {
  pi.registerTool({
    name: NOTES_TOOL,
    label: "Project Notes",
    description:
      "Read and update private notes for the current project. Notes live outside the repository, survive sessions, and are injected into the system prompt in compact form. Actions: read (full CONTEXT.md + notes.md + section map), log (today's findings), decide (durable decision), gotcha (pitfall), open (open question), set_focus (1-3 current lines), search.",
    parameters: Type.Object({
      action: Type.String({ enum: [...ACTIONS] }),
      text: Type.Optional(Type.String({ description: "Entry text for log/decide/gotcha/open/set_focus" })),
      query: Type.Optional(Type.String({ description: "Search query for action=search" })),
    }),
    async execute(_toolCallId, params: { action: Action; text?: string; query?: string }, _signal, _onUpdate, ctx) {
      const project = requireProject(deps, ctx.cwd);
      const notes = loadNotes(deps.paths, project);

      if (params.action === "read") {
        const contextExists = projectFileExists(deps.paths, project, "context");
        const notesExists = projectFileExists(deps.paths, project, "notes");
        const context = contextExists ? readContext(deps.paths, project).trim() : "";
        const body = [
          `# CONTEXT.md (${contextPath(deps.paths, project)})${contextExists ? "" : " — not created yet"}`,
          "",
          contextExists
            ? context || "(empty)"
            : "(not created yet — create it from /projects → a project → Files…)",
          "",
          `# notes.md (${notesPath(deps.paths, project)})${notesExists ? "" : " — not created yet"}`,
          "",
          notesExists
            ? notes.text.trim()
            : "(not created yet — log/decide/gotcha will create it)",
        ].join("\n");
        return {
          content: [{ type: "text", text: body }],
          details: {
            path: notesPath(deps.paths, project),
            sections: notes.map.map((entry) => `${entry.section}:${entry.start}+${entry.lines}`),
          },
        };
      }

      if (params.action === "search") {
        const query = params.query?.trim();
        if (!query) throw new Error("query is required for action=search");
        const results = searchNotes(deps.paths, project, query);
        const text =
          results.length === 0
            ? `No matches for "${query}" in CONTEXT.md, notes.md or the archive.`
            : results
                .map((entry) => `${entry.file.split("/").slice(-2).join("/")}:${entry.line}: ${entry.text}`)
                .join("\n");
        return {
          content: [{ type: "text", text }],
          details: { query, matches: results.length },
        };
      }

      if (params.action === "set_focus") {
        const text = params.text?.trim();
        if (!text) throw new Error("text is required for action=set_focus");
        setFocus(notes.parsed, text, deps.config.notes.focusLines);
        const written = writeNotes(deps.paths, project, notes.parsed, deps.config.notes.maxLines);
        return {
          content: [{ type: "text", text: `Focus updated (${written.text.split("\n").length} lines total).` }],
          details: { path: notesPath(deps.paths, project), sections: written.map },
        };
      }

      const text = params.text?.trim();
      if (!text) throw new Error(`text is required for action=${params.action}`);
      const section: NotesSection =
        params.action === "log" ? "Log" : params.action === "decide" ? "Decisions" : params.action === "gotcha" ? "Gotchas" : "Open";
      appendEntry(notes.parsed, section, text);
      const written = writeNotes(deps.paths, project, notes.parsed, deps.config.notes.maxLines);
      const archived = written.archived.length > 0 ? ` Rotated ${written.archived.length} old log block(s) to the archive.` : "";
      return {
        content: [{ type: "text", text: `Appended to ${section}.${archived}` }],
        details: {
          path: notesPath(deps.paths, project),
          section,
          sections: written.map,
          archived: written.archived,
        },
      };
    },
  });
}

export { formatMap };
