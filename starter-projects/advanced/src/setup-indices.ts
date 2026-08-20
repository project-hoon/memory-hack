/**
 * setup-indices.ts - one-time setup for the hacknight.
 *
 * Creates the `agent-memory` index with the same mapping used in the
 * Elastic Search Labs post "Persistent memory for agents: Claude Code on
 * Elasticsearch", minus the Claude Code-specific pieces.
 *
 * On Elasticsearch Serverless, `semantic_text` fields are backed by the
 * Elastic Inference Service (Jina v5) automatically - no inference_id or
 * API key needed. On self-managed 9.3+, create a Jina inference endpoint
 * first and set INFERENCE_ID below.
 *
 * Run: npx tsx src/setup-indices.ts
 */
import { Client } from "@elastic/elasticsearch";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

// Leave undefined on Serverless to use the default (Jina v5 via EIS).
const INFERENCE_ID = process.env.INFERENCE_ID || undefined;

const semanticField = INFERENCE_ID
  ? { type: "semantic_text" as const, inference_id: INFERENCE_ID }
  : { type: "semantic_text" as const };

async function main() {
  const exists = await es.indices.exists({ index: "agent-memory" });
  if (exists) {
    console.log("agent-memory index already exists - skipping (idempotent).");
    return;
  }

  await es.indices.create({
    index: "agent-memory",
    mappings: {
      properties: {
        memory_id: { type: "keyword" },
        agent: { type: "keyword" },
        // Core live-memory types plus imported history: issue | action |
        // proposal | update.
        type: { type: "keyword" },
        category: { type: "keyword" },
        title: { type: "text", fields: { keyword: { type: "keyword" } } },
        title_semantic: semanticField,
        content: { type: "text" },
        content_semantic: semanticField,
        tags: { type: "keyword" },
        source: { type: "keyword" },
        created_at: { type: "date" },
        updated_at: { type: "date" },
        access_scope: { type: "keyword" }, // shared | <agent>-only
      },
    },
  });

  console.log("Created agent-memory index with semantic_text mappings.");
  console.log("Embeddings are generated server-side at index time - no client embedder needed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
