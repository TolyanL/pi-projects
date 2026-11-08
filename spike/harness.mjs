/**
 * M0 headless harness: proves S1 (empty session switch), S3 (AGENTS.md reload
 * after switch) and S4 (private context injection) without a TUI and without
 * network access.
 *
 * Run: node spike/harness.mjs
 */

import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "pi-m0-"));
const agentDir = join(root, "agent");
const hub = join(root, "hub");
const project = join(root, "demo-project");
for (const dir of [agentDir, hub, project]) mkdirSync(dir, { recursive: true });

const AGENTS_MARKER = "AGENTS_MARKER_7be1";
const PRIVATE_MARKER = "PRIVATE_MARKER_2f9c";
writeFileSync(
  join(project, "AGENTS.md"),
  `# demo-project\n\n${AGENTS_MARKER}: always answer with the word "pong".\n`,
);
const contextPath = join(agentDir, "m0-context.md");
writeFileSync(contextPath, `# private context\n\n${PRIVATE_MARKER}: this file must never enter the repo.\n`);

process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_M0_CONTEXT = contextPath;
process.env.PI_M0_PROJECTS = project;

// --- stub OpenAI-compatible server -----------------------------------------

const requests = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    requests.push({ url: req.url, body });
    if (!req.url?.includes("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({
        id: "stub-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "stub-1",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.write(chunk({ role: "assistant", content: "pong" }));
    res.write(chunk({}, "stop"));
    res.write(
      `data: ${JSON.stringify({
        id: "stub-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "stub-1",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
process.env.PI_STUB_URL = `http://127.0.0.1:${port}/v1`;

// --- pi SDK ----------------------------------------------------------------

const {
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  createAgentSession,
  SessionManager,
  SettingsManager,
} = await import("@earendil-works/pi-coding-agent");
const m0 = (await import("./m0.js")).default;
const { createEmptySession } = await import("./m0.js");
const stubProvider = (await import("./stub-provider.js")).default;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    settingsManager,
    resourceLoaderOptions: {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [stubProvider, m0],
    },
  });
  const created = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent });
  return { ...created, services, diagnostics: services.diagnostics };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: hub,
  agentDir,
  sessionManager: SessionManager.create(hub),
});

async function bind() {
  await runtime.session.bindExtensions({});
  const model = runtime.session.modelRuntime.getModel("stub", "stub-1");
  if (model) await runtime.session.setModel(model);
  return runtime.session;
}

let session = await bind();
check("runtime starts in hub", runtime.cwd === hub, runtime.cwd);

// S1: empty session file for a project without history
const empty = createEmptySession(project);
const headerLines = readFileSync(empty, "utf8").trim().split("\n");
check("empty session has only a header", headerLines.length === 1);
check("header cwd is the project", JSON.parse(headerLines[0]).cwd === project);

const switched = await runtime.switchSession(empty);
check("switchSession not cancelled", switched.cancelled === false);
check("runtime cwd moved to project", runtime.cwd === project, runtime.cwd);

session = await bind();
check("session file is the empty one", session.sessionFile === empty);

// run one offline turn
await session.prompt("ping");
check("stub provider received a request", requests.length > 0, `${requests.length} request(s)`);

// S1 continued: the first message was appended to our header-only file
const entries = readFileSync(empty, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
check("file kept its header", entries[0].type === "session" && entries[0].cwd === project);
check("file has messages", entries.some((entry) => entry.type === "message"));
check(
  "assistant reply persisted",
  entries.some((entry) => entry.type === "message" && entry.message.role === "assistant"),
);

// S3: AGENTS.md of the target project is part of the system prompt
const systemEntry = entries.find((entry) => entry.type === "message" && entry.message.role === "system");
const sections = systemEntry?.message?.sections ?? {};
const allSections = Object.values(sections).join("\n");
check("system message recorded", Boolean(systemEntry));
check("AGENTS.md loaded after switch", allSections.includes(AGENTS_MARKER));
check("private context injected", allSections.includes(PRIVATE_MARKER), Object.keys(sections).join(","));

// reopen / list behaviour
const reopened = SessionManager.open(empty);
check("reopened session keeps cwd", reopened.getCwd() === project);
check("reopened session has entries", reopened.getEntries().length > 1);

const projectSessions = await SessionManager.list(project);
check(
  "SessionManager.list(project) sees the session",
  projectSessions.some((info) => info.path === empty),
  `${projectSessions.length} session(s)`,
);
const hubSessions = await SessionManager.list(hub);
check("hub does not list the project session", !hubSessions.some((info) => info.path === empty));

await runtime.dispose();
server.close();

console.log("\n--- summary ---");
console.log(`root:       ${root}`);
console.log(`project:    ${project}`);
console.log(`session:    ${empty}`);
console.log(`sections:   ${Object.keys(sections).join(", ")}`);
const failed = results.filter((result) => !result.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exitCode = failed.length === 0 ? 0 : 1;
