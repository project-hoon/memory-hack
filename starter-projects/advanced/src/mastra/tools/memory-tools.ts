/**
 * memory-tools.ts - Mastra port of `bridge remember` / `bridge recall`
 * from Elastic's agent-memory project (github.com/jeffvestal/agent-memory).
 *
 * The Claude Code version wires these through a CLI + hooks. In Mastra,
 * they're just tools: the model decides when to call them.
 *
 * Requirements: Elasticsearch Serverless (or 9.3+) for ES|QL FUSE + DECAY.
 */
import { createTool } from "@mastra/core/tools";
import { Client } from "@elastic/elasticsearch";
import { z } from "zod";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const MEMORY_INDEX = "agent-memory";

// ---- TUNING KNOBS (the hacknight challenge lives here) --------------------
// Recency half-life in days. Incidents might want 2; architecture decisions 90.
const DECAY_WINDOW_DAYS = Number(process.env.BRIDGE_MEMORY_DECAY_WINDOW ?? 45);
// "rrf" = plain FUSE (Reciprocal Rank Fusion, k=60). "linear" = FUSE LINEAR
// with explicit weights - shift toward BM25 for ID-heavy data, toward
// semantic for prose. (The agent-memory blog uses 0.3/0.7 for graph search.)
const FUSION_STRATEGY = (process.env.FUSION_STRATEGY ?? "rrf") as "rrf" | "linear";
const BM25_WEIGHT = Number(process.env.FUSION_BM25_WEIGHT ?? 0.3);
const SEMANTIC_WEIGHT = 1 - BM25_WEIGHT;
// ---------------------------------------------------------------------------

function fuseClause(): string {
  if (FUSION_STRATEGY === "linear") {
    return `| FUSE LINEAR WITH { "weights": { "fork1": ${BM25_WEIGHT}, "fork2": ${SEMANTIC_WEIGHT} }, "normalizer": "minmax" }`;
  }
  return "| FUSE";
}

/** ES|QL has no parameter binding for field-match strings, so sanitize. */
function esqlEscape(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 500);
}

// ---------------------------------------------------------------------------
// remember - store a typed memory. semantic_text computes embeddings
// server-side at index time, so this is a plain index call.
// ---------------------------------------------------------------------------
export const remember = createTool({
  id: "remember",
  description:
    "Store a decision, pattern, piece of context, or feedback so it can be " +
    "recalled in future sessions. Use whenever the user makes a decision, " +
    "states a durable preference, or flags a blocker worth remembering.",
  inputSchema: z.object({
    type: z.enum(["decision", "pattern", "context", "feedback"]),
    title: z.string().describe("Short human-readable title"),
    content: z.string().describe("The full memory content, including rationale"),
    tags: z.array(z.string()).default([]),
    scope: z.enum(["shared", "private"]).default("shared"),
  }),
  outputSchema: z.object({ memoryId: z.string() }),
  execute: async (input) => {
    const now = new Date().toISOString();
    const memoryId = `${AGENT_ID}-${input.type}-${Date.now()}`;

    await es.index({
      index: MEMORY_INDEX,
      id: memoryId,
      document: {
        memory_id: memoryId,
        agent: AGENT_ID,
        type: input.type,
        title: input.title,
        title_semantic: input.title, // embedded server-side
        content: input.content,
        content_semantic: input.content, // embedded server-side
        tags: input.tags,
        source: "mastra",
        created_at: now,
        updated_at: now,
        access_scope: input.scope === "shared" ? "shared" : `${AGENT_ID}-only`,
      },
      refresh: "wait_for", // hacknight-friendly: recallable immediately
    });

    return { memoryId };
  },
});

// ---------------------------------------------------------------------------
// Recall variants used by the three-way demo:
//   1. no-memory agent: no tool at all
//   2. long-term agent: FORK → FUSE (relevance, no time weighting)
//   3. episodic agent: FORK → FUSE → DECAY (relevance + recency)
// ---------------------------------------------------------------------------
const recallInputSchema = z.object({
  query: z.string().describe("What to recall, e.g. 'embedding model decisions'"),
  limit: z.number().min(1).max(20).default(5),
});

const recallOutputSchema = z.object({
  memories: z.array(
    z.object({
      memory_id: z.string(),
      type: z.string(),
      title: z.string(),
      content_excerpt: z.string(),
      tags: z.array(z.string()),
      agent: z.string(),
      created_at: z.string(),
      score: z.number(),
    })
  ),
});

function createRecallTool({
  id,
  description,
  timeAware,
}: {
  id: string;
  description: string;
  timeAware: boolean;
}) {
  return createTool({
    id,
    description,
    inputSchema: recallInputSchema,
    outputSchema: recallOutputSchema,
    execute: async (input) => {
    const q = esqlEscape(input.query);
    const scopeFilter =
      `(access_scope == "shared" OR access_scope == "${AGENT_ID}-only" OR agent == "${AGENT_ID}")`;
    const scoring = timeAware
      ? `| EVAL final_score = _score * DECAY(created_at, NOW(), ${DECAY_WINDOW_DAYS * 24} hours)`
      : "| EVAL final_score = _score";

    const query = `
FROM ${MEMORY_INDEX} METADATA _id, _score, _index
| FORK (
    WHERE ${scopeFilter}
      AND (content:"${q}" OR title:"${q}" OR tags:"${q}")
    | SORT _score DESC | LIMIT 50
) (
    WHERE ${scopeFilter}
      AND content_semantic:"${q}"
    | SORT _score DESC | LIMIT 50
)
${fuseClause()}
${scoring}
| SORT final_score DESC | LIMIT ${input.limit}
| KEEP memory_id, type, title, content, tags, agent, created_at, final_score
`.trim();

      // If DECAY throws a type error on your deployment, swap that EVAL for:
      // | EVAL final_score = _score / (1 + DATE_DIFF("day", created_at, NOW()) / ${DECAY_WINDOW_DAYS}.0)

      const result = await es.esql.query({ query, format: "json" });

      const cols = result.columns.map((c: { name: string }) => c.name);
      const idx = (name: string) => cols.indexOf(name);

      const memories = (result.values as unknown[][]).map((row) => {
        const tags = row[idx("tags")];
        return {
          memory_id: String(row[idx("memory_id")]),
          type: String(row[idx("type")]),
          title: String(row[idx("title")]),
          // Return concise evidence, not the entire meeting note, to keep the
          // agent's context focused and its tool payload bounded.
          content_excerpt: String(row[idx("content")]).slice(0, 800),
          tags: Array.isArray(tags) ? tags.map((tag) => String(tag)) : [],
          agent: String(row[idx("agent")]),
          created_at: String(row[idx("created_at")]),
          score: Number(row[idx("final_score")]),
        };
      });

      return { memories };
    },
  });
}

/** Long-term memory: hybrid relevance only, with no time decay. */
export const recallLongTerm = createRecallTool({
  id: "recall_long_term_memory",
  description:
    "Recall relevant past memories using hybrid keyword and semantic search. " +
    "This is long-term memory: it does not favor newer records over older ones.",
  timeAware: false,
});

/** Episodic memory: hybrid relevance weighted by recency. */
export const recall = createRecallTool({
  id: "recall",
  description:
    "Recall memories from previous sessions using hybrid search (exact " +
    "keyword + semantic similarity, recency-weighted). Use at the start of " +
    "a task to check for prior decisions, patterns, or blockers.",
  timeAware: true,
});
