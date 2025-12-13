# OpenSaaS Migration Assistant Plugin

A Claude Code plugin that provides AI-guided migration assistance for converting existing Prisma, KeystoneJS, or Next.js projects to OpenSaaS Stack.

## Features

- **Migration Assistant Agent**: Contextual agent that guides you through the migration process
- **Interactive Commands**: Slash commands for schema analysis, config generation, and validation
- **Migration Skill**: Expert knowledge about migration patterns and best practices
- **MCP Integration**: Works with the OpenSaaS MCP server for advanced tooling

## Installation

This plugin is automatically set up when you run:

```bash
npx @opensaas/stack-cli migrate --with-ai
```

The CLI will:
1. Install this plugin to your project
2. Create `.claude/opensaas-project.json` with your project metadata
3. Configure `.claude/settings.json` to enable the plugin
4. Set up `.mcp.json` for MCP server integration

## What's Included

### Migration Assistant Agent

A specialized agent that:
- Reads your project metadata from `.claude/opensaas-project.json`
- Guides you through the migration wizard
- Explains access control patterns
- Generates `opensaas.config.ts`

### Slash Commands

- `/analyze-schema` - Detailed schema analysis with recommendations
- `/generate-config` - Generate opensaas.config.ts
- `/validate-migration` - Validate generated configuration

### Migration Skill

Expert knowledge including:
- Access control patterns
- Field type mappings
- Database configuration examples
- Common challenges and solutions

## Usage

Once installed, simply ask Claude:

```
Help me migrate to OpenSaaS Stack
```

The migration assistant will:
1. Read your project details
2. Start the interactive wizard
3. Guide you through configuration
4. Generate your opensaas.config.ts

## Project Metadata

The CLI creates `.claude/opensaas-project.json` with information about your project:

```json
{
  "projectTypes": ["prisma"],
  "provider": "sqlite",
  "models": [
    { "name": "User", "fieldCount": 5 },
    { "name": "Post", "fieldCount": 7 }
  ],
  "hasAuth": true
}
```

The plugin reads this file to provide contextual assistance.

## Development

This plugin is part of the `@opensaas/stack-cli` package and is distributed with it.

**Directory structure:**

```
plugin/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── agents/
│   └── migration-assistant.md   # Migration agent
├── commands/
│   ├── analyze-schema.md
│   ├── generate-config.md
│   └── validate-migration.md
├── skills/
│   └── opensaas-migration/
│       └── SKILL.md
└── README.md
```

## Links

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/guides/migration)
- [GitHub Repository](https://github.com/OpenSaasAU/stack)
