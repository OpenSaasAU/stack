---
'@opensaas/stack-cli': minor
---

Migrate AI migration assistant to Claude Code plugin system

The `opensaas migrate --with-ai` command now uses a Claude Code plugin instead of writing templated files to the user's `.claude/` directory. This provides several benefits:

**What changed:**

- Migration assistant is now distributed as a plugin within `@opensaas/stack-cli`
- CLI writes project metadata to `.claude/opensaas-project.json` instead of templated files
- Plugin is automatically configured in `.claude/settings.json`

**Benefits:**

- Migration assistant content can be updated by upgrading `@opensaas/stack-cli`
- Cleaner separation between generic content and project-specific data
- Easier to maintain and update migration logic

**Usage remains the same:**

```bash
npx @opensaas/stack-cli migrate --with-ai
```

Then open the project in Claude Code and ask: "Help me migrate to OpenSaaS Stack"

The migration assistant agent will read your project metadata and guide you through the migration wizard as before.
