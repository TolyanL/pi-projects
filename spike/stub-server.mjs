/** Standalone offline OpenAI-compatible server for the TUI smoke test. */
import http from "node:http";

const port = Number(process.env.PI_STUB_PORT ?? 8765);
const delay = Number(process.env.PI_STUB_DELAY_MS ?? 0);
let count = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    count += 1;
    console.log(`[stub] ${req.method} ${req.url} #${count}`);
    if (!req.url?.includes("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    if (delay > 0) {
      setTimeout(() => respond(res), delay);
      return;
    }
    respond(res);
  });
});

function respond(res) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({
        id: `stub-${count}`,
        object: "chat.completion.chunk",
        created: 0,
        model: "stub-1",
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    res.write(chunk({ role: "assistant", content: `pong-${count}` }));
    res.write(chunk({}, "stop"));
    res.write(
      `data: ${JSON.stringify({
        id: `stub-${count}`,
        object: "chat.completion.chunk",
        created: 0,
        model: "stub-1",
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      })}\n\n`,
    );
    res.write("data: [DONE]\n\n");
    res.end();
}
server.listen(port, "127.0.0.1", () => console.log(`[stub] listening on ${port}`));
