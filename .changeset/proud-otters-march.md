---
'create-opensaas-app': minor
---

Scaffolding now runs setup for you, so the flow is just **scaffold → `pnpm dev` → build with Claude**.

After copying the template, the CLI runs `install` → `generate` → `db:push` itself, so a new project is ready to run with no further commands. If a step fails it stops and prints a recoverable message naming the failed step and its retry command, instead of leaving a raw stack trace. The final "next steps" now shows the three-step flow and points you at building features with Claude Code.

Pass `--no-install` (or `--skip-install`) to skip the auto-run and get the full manual command list instead.
