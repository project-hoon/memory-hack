/**
 * seed-sample.ts - seed the agent-memory index from a sample dataset JSON.
 *
 * Same shape as the Nimbus seed (src/seed-memories.ts), but data-driven so
 * you can pick a domain - or copy a file and write your own:
 *
 *   npx tsx src/seed-sample.ts --file ./sample-data/coffee-shop.json
 *   npx tsx src/seed-sample.ts --file ./sample-data/trip-planner.json
 *
 * Dataset format - an array of memories with RELATIVE ages, so the decay
 * demo works whenever you run it:
 *
 *   {
 *     "type": "decision" | "pattern" | "context" | "feedback",
 *     "title": "...",
 *     "content": "...",
 *     "tags": ["..."],
 *     "ageDays": 305        // how many days ago this memory was created
 *   }
 *
 * Authoring rule for a good demo: give SUPERSEDED decisions longer, richer
 * rationale than their reversals - that's what makes recall without decay
 * confidently return the stale answer.
 *
 * Run `npm run setup` first (creates the index).
 */
import { Client } from "@elastic/elasticsearch";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import "dotenv/config";

const es = new Client({
  node: process.env.ELASTICSEARCH_URL!,
  auth: { apiKey: process.env.ELASTICSEARCH_API_KEY! },
});

const AGENT_ID = process.env.AGENT_ID ?? "mastra-agent";
const INDEX = "agent-memory";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

// The starter's live `remember` tool writes these four core types. Historical
// decision logs can also preserve their source semantics as issue/action/
// proposal/update records, so recall can distinguish an adopted decision from
// an open risk or unfinished commitment.
const IMPORT_MEMORY_TYPES = [
  "decision",
  "pattern",
  "context",
  "feedback",
  "issue",
  "action",
  "proposal",
  "update",
] as const;

type Mem = {
  type: (typeof IMPORT_MEMORY_TYPES)[number];
  title: string;
  content: string;
  tags: string[];
  ageDays: number;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const file = arg("file");
  if (!file) {
    console.error("Usage: npx tsx src/seed-sample.ts --file ./sample-data/coffee-shop.json");
    process.exit(1);
  }

  const memories = JSON.parse(await readFile(file, "utf8")) as Mem[];
  const bad = memories.filter(
    (m) => !m.title || !m.content || typeof m.ageDays !== "number" ||
      !IMPORT_MEMORY_TYPES.includes(m.type)
  );
  if (bad.length > 0) {
    console.error(`${bad.length} entries are missing type/title/content/ageDays - first bad title: ${bad[0]?.title ?? "(none)"}`);
    process.exit(1);
  }

  const dataset = basename(file).replace(/\.json$/i, "");
  const operations = memories.flatMap((m, i) => {
    const created = daysAgo(m.ageDays);
    const id = `${AGENT_ID}-${dataset}-${String(i).padStart(3, "0")}`;
    return [
      { index: { _index: INDEX, _id: id } },
      {
        memory_id: id,
        agent: AGENT_ID,
        type: m.type,
        title: m.title,
        title_semantic: m.title,
        content: m.content,
        content_semantic: m.content,
        tags: m.tags ?? [],
        source: `seed-sample:${dataset}`,
        created_at: created,
        updated_at: created,
        access_scope: "shared",
      },
    ];
  });

  const result = await es.bulk({ operations, refresh: true });
  if (result.errors) {
    console.error("Some documents failed:", JSON.stringify(result.items.filter((i: any) => i.index?.error), null, 2));
    process.exit(1);
  }

  const maxAge = Math.max(...memories.map((m) => m.ageDays));
  console.log(`Seeded ${memories.length} memories from '${dataset}' (backdated up to ${maxAge} days).`);
  console.log("Now ask the advanced-memory-agent something the dataset reverses - then tune BRIDGE_MEMORY_DECAY_WINDOW.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
