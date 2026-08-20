/**
 * advanced-agent.ts - the ADVANCED tier: episodic, time-aware memory.
 *
 * The tools are already built (src/mastra/tools/memory-tools.ts):
 *   remember - stores typed memories (decision/pattern/context/feedback)
 *   recall   - hybrid retrieval: FORK (BM25 + semantic) → FUSE → DECAY,
 *              so recent memories outrank stale ones.
 *
 * YOUR work is the data (something with a shift or reversal) and the TUNING:
 *   BRIDGE_MEMORY_DECAY_WINDOW      - recency half-life (days)
 *   FUSION_STRATEGY / FUSION_BM25_WEIGHT - keyword vs semantic balance
 *   the ES|QL branches in memory-tools.ts
 *   ...and these instructions (memory discipline is tuning too).
 */
import { Agent } from "@mastra/core/agent";
import { remember, recall, recallLongTerm } from "../tools/memory-tools";
import "dotenv/config";

const model = [
  {
    model: "openrouter/anthropic/claude-sonnet-4.6",
    modelSettings: { maxOutputTokens: 4096 },
  },
];

const founderAdvisorInstructions = `You are a concise founder decision advisor. State uncertainty clearly, separate recorded evidence from your inference, and never invent facts, meetings, or outcomes.`;

const evidenceInstructions = `
- Use each recalled memory's title, date, tags, and content excerpt as evidence. Distinguish the recorded facts from your inference, and cite the memory title when you rely on it.
- For imported history, distinguish an adopted decision from an open issue, an action item, a proposal, or a status update. Do not present an unresolved proposal or action as a settled decision.`;

// Stage 0: same model and founder-advisor role, but no historical retrieval.
export const founderNoMemoryAgent = new Agent({
  id: "founder-no-memory-agent",
  name: "Founder — No Memory",
  instructions: `${founderAdvisorInstructions}

You have no access to the founders' historical meeting records. Give a general recommendation based only on the current user question, and say when historical evidence would be needed.`,
  model,
});

// Stage 1: long-term retrieval, but every matched memory competes on relevance
// alone. A persuasive, stale decision can still outrank its replacement.
export const founderLongTermMemoryAgent = new Agent({
  id: "founder-long-term-memory-agent",
  name: "Founder — Long-term Memory",
  instructions: `${founderAdvisorInstructions}

You have persistent long-term memory backed by Elasticsearch.
- At the start of every decision question, call recall_long_term_memory.
- Use the returned evidence, but do not assume newer records should win; this memory does not apply time decay.${evidenceInstructions}`,
  model,
  tools: { recallLongTerm },
});

// Stage 2: the advanced starter's episodic memory - retrieval plus time decay.
export const advancedMemoryAgent = new Agent({
  id: "advanced-memory-agent",
  name: "Founder — Episodic Memory",
  instructions: `${founderAdvisorInstructions}

You are an assistant with persistent, time-aware episodic memory backed by Elasticsearch.

Memory discipline:
- At the START of a task, call recall to check for prior decisions, patterns, or blockers. Recall is recency-weighted: newer memories outrank stale ones.
- If recalled memories CONFLICT, prefer the most recent and say why ("the earlier decision was superseded").
- When the user makes a decision, states a durable preference, or flags a blocker, call remember with a fitting type (decision, pattern, context, feedback) and useful tags.
- Cite recalled memories naturally ("Three weeks ago you decided...") rather than dumping raw results.
- Do not store trivia; store what a future session would need.${evidenceInstructions}`,
  model,
  tools: { remember, recall },
});
