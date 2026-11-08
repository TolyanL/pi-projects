/** Note tools available to the agent. */

import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Deps } from "./deps.ts";
import type { Project, ProjectPaths } from "./types.ts";
import { findByCwd, loadRegistry } from "./registry.ts";
import {
  appendNote,
  globalIndexText,
  listNotes,
  notesDir,
  notesIndexPath,
  projectIndexText,
  readNote,
  rebuildIndexes,
  rebuildProjectIndex,
  searchProjectNotes,
  writeNote,
} from "./notes.ts";

export const NOTES_TOOL = "project_notes";
export const ALL_NOTES_TOOL = "all_project_notes";

const ACTIONS = ["list", "read", "write", "append", "search"] as const;
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

function formatNoteList(paths: ProjectPaths, project: Project): string {
  const notes = listNotes(paths, project);
  if (notes.length === 0) return "No notes yet.";
  return notes
    .map(
      (note) =>
        `- ${note.title}${note.description ? ` — ${note.description}` : ""} (notes/${note.file})`,
    )
    .join("\n");
}

export function registerNotesTool(pi: ExtensionAPI, deps: Deps): void {
  pi.registerTool({
    name: NOTES_TOOL,
    label: "Project Notes",
    description:
      "Notes for the current project, stored outside the repository as markdown files in notes/. NOTES.md is a generated index (title — description — path). Actions: list (index), read (one note by file or title), write (create or replace a note: title + description + content), append (extend an existing note), search (substring across notes).",
    parameters: Type.Object({
      action: Type.String({ enum: [...ACTIONS] }),
      title: Type.Optional(Type.String({ description: "Note title (write) or reference (read/append)" })),
      description: Type.Optional(Type.String({ description: "One-line description for the index" })),
      content: Type.Optional(Type.String({ description: "Markdown body for write/append" })),
      file: Type.Optional(Type.String({ description: "Note file name for read/append" })),
      query: Type.Optional(Type.String({ description: "Search query" })),
    }),
    async execute(
      _toolCallId,
      params: {
        action: Action;
        title?: string;
        description?: string;
        content?: string;
        file?: string;
        query?: string;
      },
      _signal,
      _onUpdate,
      ctx,
    ) {
      const project = requireProject(deps, ctx.cwd);

      if (params.action === "list") {
        rebuildProjectIndex(deps.paths, project);
        const notes = listNotes(deps.paths, project);
        return {
          content: [
            {
              type: "text",
              text:
                notes.length === 0
                  ? `No notes yet in ${project.name}. Create one with action "write" (title, description, content).`
                  : `${projectIndexText(project, notes)}\nNotes directory: ${notesDir(deps.paths, project)}`,
            },
          ],
          details: { path: notesIndexPath(deps.paths, project), count: notes.length },
        };
      }

      if (params.action === "read") {
        const ref = params.file ?? params.title;
        if (!ref) throw new Error("file or title is required for action=read");
        const doc = readNote(deps.paths, project, ref);
        if (!doc) throw new Error(`Note not found: ${ref}\n${formatNoteList(deps.paths, project)}`);
        return {
          content: [
            {
              type: "text",
              text: [
                `# ${doc.meta.title}`,
                doc.meta.description ? `Description: ${doc.meta.description}` : "",
                `File: notes/${doc.meta.file}`,
                doc.meta.updated ? `Updated: ${doc.meta.updated}` : "",
                "",
                doc.body.trim() || "(empty)",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: { file: doc.meta.file, path: doc.path, title: doc.meta.title },
        };
      }

      if (params.action === "write") {
        const title = params.title?.trim();
        if (!title) throw new Error("title is required for action=write");
        if (params.content && params.content.length > deps.config.notes.maxNoteChars) {
          throw new Error(
            `content is too large (${params.content.length} chars, limit ${deps.config.notes.maxNoteChars})`,
          );
        }
        const result = writeNote(deps.paths, project, {
          title,
          description: params.description,
          content: params.content,
        });
        return {
          content: [
            {
              type: "text",
              text: `${result.created ? "Created" : "Updated"} notes/${result.meta.file}${
                result.meta.description ? ` — ${result.meta.description}` : ""
              }`,
            },
          ],
          details: { file: result.meta.file, path: result.path, created: result.created },
        };
      }

      if (params.action === "append") {
        const ref = params.file ?? params.title;
        if (!ref) throw new Error("file or title is required for action=append");
        if (!params.content?.trim()) throw new Error("content is required for action=append");
        const meta = appendNote(deps.paths, project, ref, params.content);
        return {
          content: [{ type: "text", text: `Appended to notes/${meta.file}` }],
          details: { file: meta.file, title: meta.title },
        };
      }

      if (params.action === "search") {
        const query = params.query?.trim();
        if (!query) throw new Error("query is required for action=search");
        const results = searchProjectNotes(deps.paths, project, query);
        const text =
          results.length === 0
            ? `No matches for "${query}" in ${project.name} notes.`
            : results
                .map((entry) => `notes/${entry.file}:${entry.line}: ${entry.text}`)
                .join("\n");
        return {
          content: [{ type: "text", text }],
          details: { query, matches: results.length },
        };
      }

      throw new Error(`Unknown action: ${params.action}`);
    },
  });

  pi.registerTool({
    name: ALL_NOTES_TOOL,
    label: "All Project Notes",
    description:
      "List note titles, descriptions and paths across every shared project, in the same format as NOTES.md (with project headings). Private projects are excluded. Use it to see what other projects already know without switching sessions; read the full note with project_notes after opening that project.",
    parameters: Type.Object({}),
    async execute() {
      rebuildIndexes(deps.paths);
      const registry = loadRegistry(deps.paths);
      // Projects marked private are invisible to cross-project tools.
      const shared = registry.projects.filter((project) => !project.private);
      const entries = shared.map((project) => ({
        project,
        notes: listNotes(deps.paths, project),
      }));
      const total = entries.reduce((sum, entry) => sum + entry.notes.length, 0);
      const text =
        total === 0
          ? "No shared notes in any project."
          : existsSync(deps.paths.indexFile)
            ? readFileSync(deps.paths.indexFile, "utf8")
            : globalIndexText(deps.paths, entries);
      return {
        content: [{ type: "text", text }],
        details: {
          projects: shared.length,
          notes: total,
          path: deps.paths.indexFile,
        },
      };
    },
  });
}
