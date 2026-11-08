/** Formatting helpers: no pi runtime dependencies except width-aware truncation. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Config, ProjectPaths, SessionSummary } from "./types.ts";
import { isAbsolute, join } from "node:path";

export const DEFAULT_CONFIG: Config = {
  storage: {
    // Empty means `<agent-dir>/pi-projects`.
    root: "",
  },
  context: {
    maxChars: 32768,
    warnChars: 8192,
  },
  notes: {
    promptEntries: 12,
    promptChars: 4096,
    maxNoteChars: 200_000,
  },
  pickerShortcut: "ctrl+shift+p",
};

export function createPaths(agentDir: string, config?: Config): ProjectPaths {
  const baseDir = join(agentDir, "pi-projects");
  const configured = config?.storage.root?.trim() ?? "";
  const expanded = expandHomePath(configured);
  const root = configured ? (isAbsolute(expanded) ? expanded : join(baseDir, expanded)) : baseDir;
  return {
    baseDir,
    root,
    configFile: join(baseDir, "config.json"),
    registryFile: join(root, "registry.json"),
    draftsFile: join(root, "drafts.json"),
    indexFile: join(root, "INDEX.md"),
  };
}

function expandHomePath(value: string): string {
  const home = process.env.HOME;
  if (!home) return value;
  if (value === "~") return home;
  if (value.startsWith("~/")) return join(home, value.slice(2));
  return value;
}


/** `1`, `2`, `5` → `1s`, `2m`, `3h`, `4d`, `2w`. */
export function formatAge(timestamp: number | undefined, now = Date.now()): string | undefined {
  if (!timestamp) return undefined;
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

export function sessionsLabel(summary: SessionSummary | undefined): string | undefined {
  if (!summary || summary.count === 0) return undefined;
  return `${summary.count} sess`;
}

/** Second line under a project name: `2m · 4 sess`, `no sessions`, `3d`. */
export function projectMeta(summary: SessionSummary | undefined, now = Date.now()): string {
  const age = formatAge(summary?.lastModified, now);
  const sessions = sessionsLabel(summary);
  if (!age && !sessions) return "no sessions";
  return [age, sessions].filter(Boolean).join(" · ");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 40);
  return slug || "project";
}

/** `~/work/foo` instead of the absolute path when it lives under $HOME. */
export function shortPath(path: string, home: string | undefined = process.env.HOME): string {
  if (!home) return path;
  const normalized = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === normalized) return "~";
  if (path.startsWith(`${normalized}/`)) return `~${path.slice(normalized.length)}`;
  return path;
}

/** Pad to an exact visible width (ANSI aware). */
export function fit(text: string, width: number): string {
  const clipped = truncateToWidth(text, width, "");
  const pad = Math.max(0, width - visibleWidth(clipped));
  return `${clipped}${" ".repeat(pad)}`;
}

/** Left content plus right-aligned markers, padded to `width`. */
export function fitWithMarkers(left: string, markers: string[], width: number): string {
  const markerText = markers.filter(Boolean).join(" ");
  const markerWidth = visibleWidth(markerText);
  const leftWidth = Math.max(1, width - markerWidth - (markerWidth > 0 ? 1 : 0));
  const clippedLeft = truncateToWidth(left, leftWidth, "…");
  const gap = Math.max(0, width - visibleWidth(clippedLeft) - markerWidth);
  return `${clippedLeft}${" ".repeat(gap)}${markerText}`;
}

/** One-line summary of an error for notifications. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
