---
'create-opensaas-app': patch
---

Replace the in-place scaffold smoke test with an isolated first-run guard that scaffolds the real CLI into an OS temp dir and runs generate + db:push against the workspace toolchain (no network install), and add `--no-auth`/`--no-ai` flags so the CLI can run fully non-interactively.
