/** Shared dependency bag passed between modules (avoids import cycles). */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Config, ProjectPaths } from "./types.ts";

export type OpenMode = "last" | "new";

export interface PendingSwitch {
  projectId: string;
  mode: OpenMode;
}

/** Footer status surface (no overlay: the dock is opened on demand). */
export interface StatusApi {
  refresh(ctx?: ExtensionContext): void;
  setQueued(name: string | undefined): void;
  setWorking(working: boolean, ctx?: ExtensionContext): void;
  bumpSubagents(delta: number): void;
  setError(hasError: boolean): void;
}

export interface Deps {
  pi: ExtensionAPI;
  paths: ProjectPaths;
  agentDir: string;
  config: Config;
  status: StatusApi;
  pending: PendingSwitch | undefined;
}
