# Hackathon Working Rules

1. Preserve the starter's Elasticsearch retrieval mechanism unless a change directly strengthens the demo. Do not rebuild `FORK`, `FUSE`, or `DECAY`.
2. Prioritize a working before/after trace over a custom UI or optional features.
3. Any custom advanced-memory dataset must use `type`, `title`, `content`, `tags`, and `ageDays`; span months and include a clear replacement/supersession.
4. Treat the decay window as a product decision. State why the selected interval fits the domain in the final presentation.
5. Keep the bare/memory-aware comparison fair: same prompt, fresh thread, only memory/retrieval availability differs.
6. Do not add Mastra's conversation `Memory` layer until the core episodic-memory demo works. It is bonus scope.
7. Keep secrets only in `.env`; never commit Elasticsearch URLs/API keys or OpenRouter keys.
8. After each material decision, update `codex-memory/hackathon-context.md` with the chosen domain, dataset path, demo question, and tuning values.
