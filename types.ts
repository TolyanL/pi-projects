/** Shared types for pi-projects. */

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
  /** Private projects are excluded from INDEX.md and all_project_notes. */
  private?: boolean;
}

export interface Registry {
  version: 1;
  activeId?: string;
  projects: Project[];
}

export interface StorageConfig {
  /** Projects root. Empty string means `<agent-dir>/pi-projects`. */
  root: string;
}

export interface ContextConfig {
  maxChars: number;
  warnChars: number;
}

export interface NotesConfig {
  /** How many note index entries are injected into the system prompt. */
  promptEntries: number;
  /** Character budget for the injected note index. */
  promptChars: number;
  /** Hard cap for one note body written through the tool. */
  maxNoteChars: number;
}

export interface Config {
  storage: StorageConfig;
  context: ContextConfig;
  notes: NotesConfig;
  pickerShortcut?: string;
}

export interface ProjectPaths {
  /** `<agent-dir>/pi-projects`: bootstrap dir that always holds config.json. */
  baseDir: string;
  /** Data root: registry, drafts, INDEX.md, project directories. */
  root: string;
  configFile: string;
  registryFile: string;
  draftsFile: string;
  indexFile: string;
}

export interface SessionSummary {
  count: number;
  lastModified?: number;
}

/** One note file discovered in `notes/`. */
export interface NoteMeta {
  file: string;
  title: string;
  description: string;
  created?: string;
  updated?: string;
}
