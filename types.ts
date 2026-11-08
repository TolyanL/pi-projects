/** Shared types for pi-projects. */

export interface Project {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
}

export interface Registry {
  version: 1;
  activeId?: string;
  projects: Project[];
}

export interface ContextConfig {
  maxChars: number;
  warnChars: number;
  promptNotesChars: number;
}

export interface NotesConfig {
  maxLines: number;
  tailEntries: number;
  focusLines: number;
}

export interface Config {
  context: ContextConfig;
  notes: NotesConfig;
  pickerShortcut?: string;
}

export interface ProjectPaths {
  baseDir: string;
  registryFile: string;
  configFile: string;
  draftsFile: string;
}

export interface SessionSummary {
  count: number;
  lastModified?: number;
}

export interface NotesMapEntry {
  section: string;
  start: number;
  lines: number;
}
