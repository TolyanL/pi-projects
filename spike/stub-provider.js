/**
 * M0 spike: offline OpenAI-compatible provider used by the headless harness.
 * It never reaches the network; the harness serves canned SSE responses.
 */

export default function stubProvider(pi) {
  const baseUrl = process.env.PI_STUB_URL ?? "http://127.0.0.1:8765/v1";
  pi.registerProvider("stub", {
    name: "Stub",
    baseUrl,
    apiKey: "stub-key",
    api: "openai-completions",
    models: [
      {
        type: "chat",
        id: "stub-1",
        name: "Stub 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}
