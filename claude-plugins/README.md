# OpenSaaS Stack Claude Code Plugins

This directory contains the Claude Code plugins distributed through the OpenSaaS Stack marketplace (defined in `../.claude-plugin/marketplace.json`).

## Plugins

### [opensaas-stack](./opensaas-stack/)

Feature-driven development assistant for building OpenSaaS Stack applications. Describe what you want to build and the plugin's agent, skill, and MCP feature wizards implement it — authentication, blog, comments, file uploads, semantic search, or fully custom features.

### [opensaas-migration](./opensaas-migration/)

Migration assistant for converting existing Prisma, KeystoneJS, or Next.js projects to OpenSaaS Stack. Includes a migration agent, slash commands for schema analysis and config generation, and eight skills covering context calls, imports, document/image/virtual fields, and admin UI setup.

## Installation

```bash
# In Claude Code
/plugin marketplace add OpenSaasAU/stack
/plugin install opensaas-stack@opensaas-stack-marketplace
/plugin install opensaas-migration@opensaas-stack-marketplace
```

Or let the tooling set things up for you:

```bash
# New projects — prompts "Enable AI development tools?"
npm create opensaas-app@latest my-app

# Existing projects — sets up the migration plugin
npx @opensaas/stack-cli migrate --with-ai
```

Both plugins bundle the OpenSaaS Stack MCP server from `@opensaas/stack-cli` (feature wizards, documentation search, schema introspection, and migration tooling).

## Versioning

Plugin versions are managed directly in each plugin's `.claude-plugin/plugin.json` and the marketplace entry in `../.claude-plugin/marketplace.json` — see the `plugin-version` skill in the monorepo.
