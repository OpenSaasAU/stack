---
'create-opensaas-app': minor
---

Scaffolded projects are now Claude-Code-ready out of the box. Every template ships an AI bundle — a concise, project-oriented `CLAUDE.md` (the framework's hard rules plus example "ask Claude to build X" prompts) and a `.claude/settings.json` that registers the OpenSaaS MCP server for the project — so your third step is simply to describe a feature to Claude Code.

The bundle is included when AI tooling is enabled (the default / `--with-ai`). Opting out (declining the prompt) removes the bundle from the generated project via `removeAiTooling`.
