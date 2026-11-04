---
'@opensaas/stack-cli': patch
'@opensaas/stack-rag': patch
---

`opensaas generate` now loads the project's `.env` before reading the config, the same as `opensaas dev`, so a config that reads `process.env` at module scope sees consistent values under both commands. `@opensaas/stack-rag`'s runtime no longer loads `.env` as a side effect of import — a script that needs it now loads it explicitly (e.g. `tsx --env-file-if-exists=.env`).
