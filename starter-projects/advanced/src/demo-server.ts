/**
 * Lightweight local comparison UI for the hacknight demo.
 * Keep `npm run dev` running in one terminal, then run `npm run demo` in
 * another. This server proxies the three same-question calls to Mastra so the
 * browser never handles credentials or cross-origin API details.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.DEMO_PORT ?? 4173);
// Mastra dev binds locally. macOS machines can resolve `localhost` to either
// IPv4 or IPv6, so probe both unless the user explicitly supplies MASTRA_URL.
const mastraUrls = process.env.MASTRA_URL
  ? [process.env.MASTRA_URL]
  : ["http://127.0.0.1:4111", "http://[::1]:4111", "http://localhost:4111"];
const demoDir = fileURLToPath(new URL("../demo", import.meta.url));
const vendorFiles: Record<string, string> = {
  "/vendor/marked.esm.js": fileURLToPath(new URL("../node_modules/marked/lib/marked.esm.js", import.meta.url)),
  "/vendor/dompurify.js": fileURLToPath(new URL("../node_modules/dompurify/dist/purify.min.js", import.meta.url)),
};

const agents = [
  { ids: ["founder-no-memory-agent", "founderNoMemoryAgent"], key: "noMemory" },
  { ids: ["founder-long-term-memory-agent", "founderLongTermMemoryAgent"], key: "longTermMemory" },
  { ids: ["advanced-memory-agent", "advancedMemoryAgent"], key: "episodicMemory" },
] as const;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function readJson(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { question?: unknown };
}

async function askAgent(ids: readonly string[], question: string) {
  const connectionFailures: string[] = [];

  for (const mastraUrl of mastraUrls) {
    for (const id of ids) {
      let response: Response;
      try {
        response = await fetch(`${mastraUrl}/api/agents/${id}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
        });
      } catch (error) {
        connectionFailures.push(`${mastraUrl}: ${error instanceof Error ? error.message : "connection failed"}`);
        break; // The next agent ID cannot work at an unreachable base URL.
      }

      const result = await response.json().catch(() => ({}));
      if (response.status === 404) continue; // Mastra versions differ on ID vs registry-key routes.
      if (!response.ok) {
        throw new Error(typeof result?.message === "string" ? result.message : `Mastra returned ${response.status}`);
      }
      return String(result.text ?? result.response?.text ?? "No answer returned.");
    }
  }

  throw new Error(
    connectionFailures.length > 0
      ? `Could not reach Mastra. Keep npm run dev running. (${connectionFailures.join("; ")})`
      : "Mastra is running, but the comparison agents were not found. Restart npm run dev so it loads the new agents."
  );
}

type RecallMemory = {
  type: string;
  title: string;
  content_excerpt: string;
  tags: string[];
  created_at: string;
};

function writeStreamEvent(response: import("node:http").ServerResponse, event: string, body: unknown) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function recallMemories(result: unknown): RecallMemory[] {
  let value = result;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }

  const record = asRecord(value);
  const memories = record?.memories;
  if (!Array.isArray(memories)) return [];

  return memories.flatMap((memory) => {
    const item = asRecord(memory);
    if (!item || typeof item.title !== "string") return [];
    return [{
      type: typeof item.type === "string" ? item.type : "memory",
      title: item.title,
      content_excerpt: typeof item.content_excerpt === "string" ? item.content_excerpt : "",
      tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
      created_at: typeof item.created_at === "string" ? item.created_at : "",
    }];
  });
}

async function consumeMastraSse(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeFrame = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      const event = asRecord(parsed);
      if (event) onEvent(event);
    } catch {
      // Ignore non-JSON keepalive frames.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        consumeFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (buffer.trim()) consumeFrame(buffer);
  } finally {
    reader.releaseLock();
  }
}

async function streamAgent(
  ids: readonly string[],
  key: (typeof agents)[number]["key"],
  question: string,
  response: import("node:http").ServerResponse,
) {
  const connectionFailures: string[] = [];

  for (const mastraUrl of mastraUrls) {
    for (const id of ids) {
      let upstream: Response;
      try {
        upstream = await fetch(`${mastraUrl}/api/agents/${id}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
        });
      } catch (error) {
        connectionFailures.push(`${mastraUrl}: ${error instanceof Error ? error.message : "connection failed"}`);
        break;
      }

      if (upstream.status === 404) continue;
      if (!upstream.ok || !upstream.body) {
        const error = await upstream.json().catch(() => ({}));
        const message = asRecord(error)?.message;
        throw new Error(typeof message === "string" ? message : `Mastra returned ${upstream.status}`);
      }

      await consumeMastraSse(upstream.body, (event) => {
        const type = event.type;
        const payload = asRecord(event.payload);
        if (type === "text-delta" && typeof payload?.text === "string") {
          writeStreamEvent(response, "delta", { key, text: payload.text });
        }

        if (type === "tool-call" && typeof payload?.toolName === "string" && payload.toolName.startsWith("recall")) {
          writeStreamEvent(response, "recalling", { key, query: asRecord(payload.args)?.query ?? "founder history" });
        }

        if (type === "tool-result" && typeof payload?.toolName === "string" && payload.toolName.startsWith("recall")) {
          writeStreamEvent(response, "recall", { key, memories: recallMemories(payload.result) });
        }
      });
      writeStreamEvent(response, "complete", { key });
      return;
    }
  }

  throw new Error(
    connectionFailures.length > 0
      ? `Could not reach Mastra. Keep npm run dev running. (${connectionFailures.join("; ")})`
      : "Mastra is running, but the comparison agents were not found. Restart npm run dev so it loads the new agents.",
  );
}

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "POST" && url.pathname === "/compare/stream") {
    try {
      const { question } = await readJson(request);
      if (typeof question !== "string" || question.trim().length === 0 || question.length > 2_000) {
        sendJson(response, 400, { error: "Enter a question under 2,000 characters." });
        return;
      }

      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.flushHeaders();
      writeStreamEvent(response, "started", { keys: agents.map((agent) => agent.key) });

      await Promise.all(
        agents.map(async (agent) => {
          try {
            await streamAgent(agent.ids, agent.key, question.trim(), response);
          } catch (error) {
            writeStreamEvent(response, "error", {
              key: agent.key,
              message: error instanceof Error ? error.message : "Agent request failed.",
            });
          }
        }),
      );
      writeStreamEvent(response, "done", {});
      response.end();
    } catch {
      sendJson(response, 400, { error: "Could not read the question." });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/compare") {
    try {
      const { question } = await readJson(request);
      if (typeof question !== "string" || question.trim().length === 0 || question.length > 2_000) {
        sendJson(response, 400, { error: "Enter a question under 2,000 characters." });
        return;
      }

      const answers = await Promise.all(
        agents.map(async (agent) => {
          try {
            return [agent.key, { text: await askAgent(agent.ids, question.trim()) }] as const;
          } catch (error) {
            return [agent.key, { error: error instanceof Error ? error.message : "Agent request failed." }] as const;
          }
        })
      );
      sendJson(response, 200, { answers: Object.fromEntries(answers) });
    } catch {
      sendJson(response, 400, { error: "Could not read the question." });
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }

  const vendorFile = vendorFiles[url.pathname];
  if (vendorFile) {
    try {
      const body = await readFile(vendorFile);
      response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(500);
      response.end("Markdown viewer dependency is unavailable.");
    }
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filename = normalize(join(demoDir, requested));
  if (!filename.startsWith(demoDir)) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const body = await readFile(filename);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filename)] ?? "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, () => {
  console.log(`Founder Memory comparison UI: http://localhost:${port}`);
  console.log(`Proxying agent calls to ${mastraUrls.join(", ")}`);
});
