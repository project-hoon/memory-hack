# Advanced - Episodic Memory with Time Decay

A complete, working Mastra project where the agent's memory is **time-aware**: recent context outranks stale context, superseded decisions lose to their replacements, and just-consumed items get excluded. The retrieval machinery is fully built - **your challenge is the data and the tuning.**

## What's going on here

This is a Mastra port of Elastic's [agent-memory](https://github.com/jeffvestal/agent-memory) pattern ([blog post](https://www.elastic.co/search-labs/blog/persistent-memory-agents-elasticsearch-claude-code)). Where the original wired memory into Claude Code with lifecycle hooks, here memory is **tools the agent chooses to call** - watch it decide in the Studio trace.

Two memory systems live in this project:

### 1. The generic decision memory (`advanced-memory-agent`)
- **`remember`** stores typed memories - `decision`, `pattern`, `context`, `feedback` - in an `agent-memory` index. Text is embedded server-side via `semantic_text` (automatic Jina v5 on Serverless): no embedding pipeline to configure.
- **`recall`** retrieves with one ES|QL query (see `src/mastra/tools/memory-tools.ts`):
  - **`FORK`** runs two branches in parallel: BM25 keyword search (exact IDs, names) and semantic search (meaning, paraphrase);
  - **`FUSE`** merges them (Reciprocal Rank Fusion, or `FUSE LINEAR` with explicit weights);
  - **`DECAY`** multiplies the score by recency: `_score * DECAY(created_at, NOW(), <window>)` - the further back a memory, the less it counts. (The window is a `time_duration`, so the tools convert your day-denominated knobs to hours.)
- The agent's instructions enforce **memory discipline**: recall before deciding, prefer the most recent when memories conflict, cite what it used.

### 2. The worked example: the three-stage movie demo
The `movie-rec-*` agents show the whole idea on a relatable domain - run them before building your own:
- `movie-rec-bare` - no tools; fluent, generic, ungrounded.
- `movie-rec-catalog` - + long-term knowledge: hybrid search over a ~60-title catalog.
- `movie-rec-personal` - + **episodic memory**: a decay-weighted taste formula over watch history (`get_taste_profile`: `weight = DECAY(watched_at) * rating`, summed by genre) plus exclusion of just-watched titles. The seeded history contains a **planted taste shift** - months of rom-coms, then a recent sci-fi kick - so the decay window visibly changes who the agent thinks you are.

## Setup (5 minutes)

**Requires Elasticsearch Serverless or 9.3+** - the `DECAY` function and `FUSE` command are recent ES|QL features. Serverless also gives you automatic embeddings. **Node 22.22+ (or 20.20+)** - the current LTS is easiest.

1. **Clone the repo** (skip if you already did) and enter this project:

   ```bash
   git clone https://github.com/jdarmada/agent-memory-hacknight.git
   cd agent-memory-hacknight/starter-projects/advanced
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure credentials** - copy the template, then edit `.env`:

   ```bash
   cp .env.example .env
   ```

   - `ELASTICSEARCH_URL` + `ELASTICSEARCH_API_KEY` - from your Serverless project (Cloud console → your project → *Endpoints & API keys*)
   - `OPENROUTER_API_KEY` - handed out by the organizers
   - `AGENT_ID` - any unique name, e.g. `team-yourname` (namespaces your memories)

4. **Create the memory index and seed the movie demo** (seed day-of: watch history is backdated relative to today):

   ```bash
   npm run setup
   npm run seed:movies
   ```

5. **Launch Mastra Studio:**

   ```bash
   npm run dev
   ```

   Open http://localhost:4111 - you'll see `advanced-memory-agent` and the three `movie-rec-*` agents.

### See it work (5 more minutes)

Ask all three movie agents the same question - *"Recommend me something to watch tonight"* - and open the traces. Then **the decay flip**: change `TASTE_DECAY_DAYS=21` to `180` in `.env`, restart, ask again. Sci-fi kick → rom-com era. Same data, same agent, one knob: which *version of you* the memory remembers.

## Your challenge

1. **Get data with a shift or reversal** - a moment where the right answer *changed*:
   ```bash
   npm run seed:nimbus                                   # synthetic engineering decision log, planted reversals (src/seed-memories.ts)
   npm run seed:sample -- --file ./sample-data/coffee-shop.json   # café ops log: supplier + menu reversals
   npm run seed:sample -- --file ./sample-data/trip-planner.json  # travel assistant: preference reversals (hostels→hotels, vegetarian now)
   npm run ingest:issues -- --repo owner/name --max 150  # any repo's closed issues (src/ingest-github-issues.ts - also your BYOD template)
   npm run ingest:markdown -- --dir ./corpus --tag adr   # cloned ADRs / PEPs / changelogs (src/ingest-markdown.ts)
   ```
   The `sample-data/` sets all have **planted reversals** (superseded decisions written *longer and more convincing* than their replacements - that's what makes undecayed recall fail visibly). Copy one as a template for your own domain: each memory is just `{type, title, content, tags, ageDays}`. Bringing outside data? See **Bring your own data** below for the routes and requirements.
2. **Break it:** find the question where memory-blind or badly-tuned recall gives the confidently *stale* answer.
3. **Tune until it's right:**
   - `BRIDGE_MEMORY_DECAY_WINDOW` - hours-scale for incidents, weeks for taste, months for architecture decisions;
   - `FUSION_STRATEGY=linear` + `FUSION_BM25_WEIGHT` - push toward keyword for ID-heavy data, semantic for prose;
   - the ES|QL itself in `memory-tools.ts` - branch fields, limits, filters, or your own weighting formula (the taste profile in `movie-tools.ts` is a template);
   - the instructions in `advanced-agent.ts` - when to recall, how to resolve conflicts.
4. **Demo:** same question, before and after, trace visible, plus *why* your window and weights fit your domain.

### Bring your own data

Three routes in, by what your source looks like:

| Your source | Route | Where the timestamp comes from |
|---|---|---|
| Anything you can shape into JSON | `npm run seed:sample -- --file ./my-data.json` | `ageDays` per entry (relative to today - decay always has something to bite) |
| A GitHub repo's closed issues | `npm run ingest:issues -- --repo owner/name --max 150` | real `closed_at` dates from the API |
| A folder of dated markdown (ADRs, PEPs, changelogs) | `npm run ingest:markdown -- --dir ./corpus --tag adr` | frontmatter `date:`, a `Date:` line, or file mtime (last resort - it warns) |

**Requirements - this tier is stricter than Easy Win:**

1. **Every memory needs a timestamp.** Decay is the whole demo; undated data can't fade. If your source has no real dates, assign `ageDays` offsets yourself via the JSON route.
2. **Temporal spread measured in months, not days.** With a 45-day decay window, memories from last week all score alike. The shipped datasets span ~330 days - aim for that shape.
3. **At least one reversal** - a decision, preference, or fact that *changed* ("we picked X" ... months later ... "X is superseded, now Y"). Without one, decay reorders nothing visible.
4. **Write the stale answer to *deserve* to win.** Give superseded entries longer, richer rationale than their replacements (see `sample-data/*.json`) - undecayed recall then confidently returns the wrong answer, which is your before/after.
5. For new live memories, keep `type` one of `decision | pattern | context | feedback`. The sample importer also accepts `issue | action | proposal | update` so historical meeting logs retain their source meaning. Use `tags` - they feed the BM25 branch.

**Fast sources:** your team's real ADR folder or changelog, any active repo's closed issues (exact IDs in issue titles also show off the keyword branch), personal decision journals or notes exports, or synthetic data written with an LLM - just keep the timestamps honest to rules 1-3.

### Bonus: add the conversation layer (rubric credit under "Use of Mastra")

You may have noticed these agents keep **no chat history** - that's deliberate. Their memory lives in Elasticsearch, not in the conversation. Wiring in Mastra's memory primitives is part of the challenge: combine both layers - Mastra Memory (chat history, working memory, semantic recall) for the *conversation*, your ES|QL `remember`/`recall` tools for the *episodic* record. One agent that remembers who it's talking to AND what changed over time. When it works, you'll see it: threads start persisting in Studio and the "Memory not enabled" notice disappears.

The recipe (add it to `advanced-memory-agent`, ~15 minutes):

1. `npm install @mastra/memory @mastra/libsql`
2. Give the agent a `memory: new Memory({ storage: new LibSQLStore({ id: "memory-storage", url: "file:./memory.db" }), options: { lastMessages: 10, workingMemory: { enabled: true } } })` - that alone gets you chat history + working memory.
3. Want semantic recall too? Also `npm install @ai-sdk/provider`, copy `../easy-win/src/mastra/elastic-embedder.ts`, and add `vector` + `embedder` - `../easy-win/src/mastra/agents/memory-agent.ts` is the complete worked example.

Two gotchas: run your before/after demo in a **fresh thread** each time (with conversation memory, the second ask of a question references the first answer instead of re-querying), and leave the `movie-rec-*` agents memory-free so the three-stage comparison stays clean.

## Troubleshooting

- **Studio spinner never resolves (no answer, no error)** → check the terminal running `npm run dev` - it's almost always an OpenRouter 402 (key out of credits; Studio's UI swallows stream errors silently). Flag an organizer for a fresh key.
- **`DECAY(...)` type error** → the third argument must be a `time_duration` (`1080 hours`), not a `date_period` (`45 days`) - the tools already convert your day-denominated env knobs to hours; keep that pattern if you edit the query. If it still fails, swap in the `DATE_DIFF` fallback commented next to each DECAY line.
- **`semantic_text` errors on self-managed ES** → create a Jina inference endpoint and set `INFERENCE_ID`; or use Serverless.
- **Recall empty right after remember** → the tools use `refresh: "wait_for"`; keep it.
- **Decay changes nothing** → your data has no temporal spread. Seed scripts backdate for you; `ingest:markdown` warns when it falls back to file mtimes.

## Simpler start?

If this is too much machinery to begin with, start with the **Easy Win** project (`../easy-win`): Elasticsearch as plain long-term memory - no timestamps, no decay - then come back here to add the time dimension.
