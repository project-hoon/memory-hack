/**
 * Mastra registration - everything here appears in Studio (`npm run dev`).
 *
 * The challenge agent:
 *   advanced-memory-agent - typed memories, hybrid recall, time decay (tunable)
 *
 * The worked example (the kickoff's three-stage movie demo):
 *   movie-rec-bare      - Stage 0: no tools
 *   movie-rec-catalog   - Stage 1: + long-term knowledge (hybrid catalog search)
 *   movie-rec-personal  - Stage 2: + episodic memory (decay-weighted taste + exclusions)
 */
import { Mastra } from "@mastra/core";
import { Observability, MastraStorageExporter } from "@mastra/observability";
import {
  advancedMemoryAgent,
  founderNoMemoryAgent,
} from "./agents/advanced-agent";
import { movieRecBare, movieRecCatalog, movieRecPersonal } from "./agents/movie-agents";

export const mastra = new Mastra({
  agents: {
    founderNoMemoryAgent,
    advancedMemoryAgent,
    movieRecBare,
    movieRecCatalog,
    movieRecPersonal,
  },
  // Records agent traces (LLM turns, tool calls, ES|QL queries) so they show
  // up in Studio's Traces view - the demo and the judging rubric both use it.
  observability: new Observability({
    configs: {
      default: {
        serviceName: "hacknight-advanced",
        exporters: [new MastraStorageExporter()],
      },
    },
  }),
});
