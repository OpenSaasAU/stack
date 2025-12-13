# Claude Code Configuration

This directory contains Claude Code settings for OpenSaaS Stack contributors.

## What's Here

### `settings.json`

Automatically connects to the `@opensaas/stack-mcp` MCP server, giving contributors access to:

- Feature implementation wizards
- Live documentation search
- Feature suggestions and validation

This setting is only applied when you **trust this folder** in Claude Code.

## The Actual Plugins

The Claude Code **plugins** (commands, agents, skills) are located in:

```
claude-plugins/
├── opensaas-stack/      # Development tools plugin
└── opensaas-migration/  # Migration assistant plugin
```

That's where the `plugin.json`, commands, agents, and skills live for each plugin.

## Why Separate Directories?

- **`.claude/`** - Repository-level settings (like auto-connecting MCP servers)
- **`claude-plugins/`** - Distributable plugins with commands/agents/skills

When you trust the OpenSaaS Stack repository folder:

1. Settings from `.claude/settings.json` are applied (MCP server connects)
2. Plugins from `claude-plugins/` are loaded (commands/agents/skills available)

## For Contributors

Just trust the repository folder in Claude Code and everything works automatically!

## For External Projects

Install the MCP server and plugin separately:

```bash
npx @opensaas/stack-mcp install
```

Then optionally install the plugin from a marketplace.
