import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  createPaths,
  fitWithMarkers,
  formatAge,
  projectMeta,
  sessionsLabel,
  shortPath,
  slugify,
} from "../format.ts";

test("age formatting crosses unit boundaries", () => {
  const now = Date.UTC(2026, 1, 14, 12, 0, 0);
  assert.equal(formatAge(now - 5_000, now), "5s");
  assert.equal(formatAge(now - 90_000, now), "2m");
  assert.equal(formatAge(now - 3 * 3600_000, now), "3h");
  assert.equal(formatAge(now - 3 * 24 * 3600_000, now), "3d");
  assert.equal(formatAge(now - 21 * 24 * 3600_000, now), "3w");
  assert.equal(formatAge(undefined, now), undefined);
});

test("project meta prefers age and session count", () => {
  const now = Date.UTC(2026, 1, 14, 12, 0, 0);
  assert.equal(projectMeta({ count: 4, lastModified: now - 120_000 }, now), "2m · 4 sess");
  assert.equal(projectMeta({ count: 0 }, now), "no sessions");
  assert.equal(projectMeta(undefined, now), "no sessions");
  assert.equal(sessionsLabel({ count: 1 }), "1 sess");
  assert.equal(sessionsLabel({ count: 0 }), undefined);
});

test("slugs are filesystem friendly and non-empty", () => {
  assert.equal(slugify("My Project!"), "my-project");
  assert.equal(slugify("  ...  "), "project");
  assert.equal(slugify("UPPER_case-1"), "upper_case-1");
  assert.ok(slugify("жалоба").length > 0);
});

test("home paths are shortened", () => {
  assert.equal(shortPath("/home/me/work/repo", "/home/me"), "~/work/repo");
  assert.equal(shortPath("/home/me", "/home/me"), "~");
  assert.equal(shortPath("/opt/repo", "/home/me"), "/opt/repo");
});

test("marker rows keep an exact visible width", () => {
  const line = fitWithMarkers("▸ pi-extensions", ["\x1b[36m●\x1b[0m", "✎"], 28);
  assert.equal(visibleWidth(line), 28);
  const long = fitWithMarkers("a-very-long-project-name-that-does-not-fit", [], 20);
  assert.equal(visibleWidth(long), 20);
});

test("paths helper keeps everything under pi-projects", () => {
  const paths = createPaths("/tmp/agent");
  assert.equal(paths.baseDir, "/tmp/agent/pi-projects");
  assert.ok(paths.registryFile.startsWith(paths.baseDir));
});
