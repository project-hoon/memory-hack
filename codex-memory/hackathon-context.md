# Memory Hacknight Context

## Objective

Build a Mastra agent whose answer changes correctly when its time-stamped Elasticsearch memory changes. The final demo must compare the same prompt with and without the relevant memory, and show the Mastra Studio trace.

The product demo compares two identical-prompt modes: no memory and time-aware episodic memory (`FORK → FUSE → DECAY`). This makes the before/after outcome legible within the 1–2 minute presentation.

## Product framing

The product is **elements-decision-mentat**. A Mentat is the Dune-inspired archetype of a trained human adviser who computes vast context beside a decision-maker. In this product, the founder remains the decision-maker; the Mentat is the always-on decision aide that retrieves years of meeting history, detects what has changed, and presents supporting or contradicting evidence. It should never be framed as an autonomous executive or as merely a chat-history store.

The custom comparison UI streams both agent responses. Its expandable Mentat evidence panel must show only the `tool-result` memories that the episodic agent actually received through `recall` during that response—never a separate, cosmetic search.

The presentation is the home route (`/`). It is a deliberately minimal two-column story: the left describes Mentat as a decision aide for founders who repeatedly decide and change direction; the right displays large card-news examples for the seven Founder Memory types. Each card uses a real imported record's English `title` and `content`; only lengthy content is shortened without changing its meaning. The live before/after comparison is at `/demo`.

## Current technical decision

Start from `starter-projects/advanced`, not from scratch. It already contains the hackathon-critical retrieval path:

```text
User prompt
  → Mastra advanced-memory-agent
  → recall tool
  → Elasticsearch ES|QL: FORK (keyword + semantic) → FUSE → DECAY
  → recent, relevant memories returned to the agent
  → grounded answer + Studio trace
```

Mastra owns agent instructions, tool invocation, and traces. Elasticsearch owns persistent documents, server-side embeddings (`semantic_text`), keyword search, semantic search, and time-aware ranking.

## Where data lives

There is no local Elasticsearch server in this starter. `ELASTICSEARCH_URL` is the HTTPS endpoint for the team's Elastic Cloud Serverless project, and `ELASTICSEARCH_API_KEY` authenticates requests to it.

```text
Local `sample-data/trip-planner.json` (seed source only)
  → `npm run seed:sample`
  → Elasticsearch Serverless `agent-memory` index (persistent remote memory)
  → local Mastra dev server's `recall` tool
  → Elasticsearch Serverless ES|QL query
  → answer in local Mastra Studio
```

`npm run setup` creates the remote index mapping. `npm run seed:sample -- --file ...` converts each `ageDays` value to a real `created_at` timestamp and bulk-indexes the documents remotely. The `trip-planner.json` file remains in the repository as the reproducible seed source; it is not where the live agent recalls from.

`recall` returns the selected memory's title, type, date, tags, and an 800-character `content_excerpt` to the Mastra agent. The excerpt lets the agent ground an answer in the stored rationale, rather than infer solely from a decision title.

The historical-sample importer accepts `decision`, `pattern`, `context`, `feedback`, `issue`, `action`, `proposal`, and `update`. Imported source types are preserved so the agent can distinguish an adopted decision from an open risk, unfinished commitment, draft proposal, or later status update.

## Runtime requirement

The starter requires Node.js `>=20.20.0` (Node 22 LTS is the recommended baseline). Node 18 fails before Elasticsearch is contacted because a dependency expects the global `File` API. If a terminal selects Node 18 through `nvm` while Homebrew Node is installed, temporarily run `export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"` before `npm` commands, then verify `node --version`.

## Terms

- `FORK`: run retrieval branches in parallel. This project uses one keyword/BM25 branch and one semantic-vector branch.
- `FUSE`: merge the ranked branches. Default is RRF; the project can also use weighted linear fusion.
- `DECAY`: multiply relevance by a time-based weight, so newer memories win when old and new memories conflict.
- `Mastra Memory`: Mastra's optional conversation-memory layer (message history, semantic recall, working-memory user profile). It is different from this project's custom Elasticsearch episodic-memory tools. It is a bonus, not the critical path.

## Included preset datasets

### Advanced: time-aware memory

- `starter-projects/advanced/sample-data/coffee-shop.json` — supplier/menu reversals.
- `starter-projects/advanced/sample-data/trip-planner.json` — preference reversals, such as hostels to hotels and diet changes.
- `starter-projects/advanced/src/seed-memories.ts` — generated Nimbus engineering decisions with explicit reversals.
- `starter-projects/advanced/src/seed-movies.ts` — generated catalog and watch-history taste-shift demo.

### Easy Win: static knowledge-base RAG

- `starter-projects/easy-win/sample-data/{board-games,cocktails,recipes,sf-hikes}.json`.

## Important files

- `advanced/src/mastra/tools/memory-tools.ts`: `remember` and hybrid/decayed `recall`.
- `advanced/src/mastra/agents/advanced-agent.ts`: agent memory discipline.
- `advanced/.env`: `BRIDGE_MEMORY_DECAY_WINDOW`, `FUSION_STRATEGY`, and `FUSION_BM25_WEIGHT`.
- `advanced/src/setup-indices.ts`: `agent-memory` mapping with `semantic_text` fields.

## Commands

```bash
cd starter-projects/advanced
cp .env.example .env
npm install
npm run setup
npm run seed:sample -- --file ./sample-data/trip-planner.json
npm run dev
```

For the synthetic engineering demo, use `npm run seed:nimbus`; for the movie demo, use `npm run seed:movies`.

For the Founder Memory comparison UI, run `npm run dev` first and `npm run demo` in a second terminal, then open `http://localhost:4173`.

## Demo acceptance criteria

1. Use a fresh Studio thread for each comparison.
2. Ask one stable, high-value question that has a planted reversal.
3. Without relevant memory (or with a deliberately long decay window), produce the stale/general answer.
4. With the tuned time-aware memory, produce the current answer and explain that the old decision was superseded.
5. Show the trace containing the recall tool call and the Elasticsearch-backed result.

## Open decisions

- Choose the team product domain and write a 12–20 row, time-spread dataset with at least one strong reversal.
- Choose one decay value that makes the reversal visibly change the ranking.
- Choose the exact before/after prompt for the 1–2 minute presentation.
