import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createEmptySession } from "../switch.ts";
import { newestSessionFile } from "../sessions.ts";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-projects-switch-"));
  const repo = join(root, "repo");
  const sessions = join(root, "sessions");
  mkdirSync(repo, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  return { root, repo, sessions };
}

test("empty session is a header-only file with the right cwd", () => {
  const { repo, sessions } = setup();
  const file = createEmptySession(repo, sessions);
  assert.ok(existsSync(file));
  const lines = readFileSync(file, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const header = JSON.parse(lines[0]);
  assert.equal(header.type, "session");
  assert.equal(header.version, 3);
  assert.equal(header.cwd, repo);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("pi appends the first message to the hand-written file", async () => {
  const { repo, sessions } = setup();
  const file = createEmptySession(repo, sessions);
  const manager = SessionManager.open(file, sessions, repo);
  assert.equal(manager.getCwd(), repo);
  manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].type, "session");
  assert.equal(lines[0].cwd, repo);
  assert.equal(lines[1].type, "message");
  assert.equal(lines[1].message.role, "user");
});

test("created sessions are visible to SessionManager.list", async () => {
  const { repo, sessions } = setup();
  const file = createEmptySession(repo, sessions);
  const list = await SessionManager.list(repo, sessions);
  assert.ok(
    list.some((info) => info.path === file),
    `expected ${file} in ${JSON.stringify(list.map((entry) => entry.path))}`,
  );
});

test("newestSessionFile prefers the last file name", () => {
  const { sessions } = setup();
  const a = createEmptySession(sessions, sessions);
  const b = createEmptySession(sessions, sessions);
  assert.notEqual(a, b);
  assert.equal(newestSessionFile(sessions), [a, b].sort((x, y) => y.localeCompare(x))[0]);
});
