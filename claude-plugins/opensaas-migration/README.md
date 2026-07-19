# OpenSaaS Migration Assistant Plugin

A Claude Code plugin that provides AI-guided migration assistance for converting existing Prisma, KeystoneJS, or Next.js projects to OpenSaaS Stack.

## Features

- **Migration Assistant Agent**: Contextual agent that guides you through the migration process
- **Interactive Commands**: Slash commands for schema analysis, config generation, and validation
- **Migration Skills**: Expert knowledge about migration patterns and best practices
- **MCP Integration**: Bundles the OpenSaaS Stack MCP server for schema introspection and wizard tooling

## Installation

This plugin is automatically set up when you run:

```bash
npx @opensaas/stack-cli migrate --with-ai
```

The CLI will:

1. Add the OpenSaaS Stack marketplace to your project
2. Enable this plugin from the marketplace
3. Create `.claude/opensaas-project.json` with your project metadata
4. Configure `.claude/settings.json` with marketplace and plugin settings

The plugin's manifest declares the MCP server, so migration tools are available as soon as the plugin is enabled.

### Manual Installation

You can also install this plugin manually by adding the marketplace:

```bash
# In Claude Code
/plugin marketplace add OpenSaasAU/stack
/plugin install opensaas-migration@opensaas-stack-marketplace
```

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

### Migration Skills

Expert knowledge covering:

- The end-to-end migration process (`opensaas-migration`)
- Rewriting `context.query`/`context.graphql` calls (`migrate-context-calls`)
- Import path migration (`migrate-imports`)
- Keystone `document` fields → `richText` (`migrate-document-fields`)
- Keystone `image` fields → storage fields, non-destructively (`migrate-image-fields`)
- Keystone `virtual` fields → `virtual()` with `resolveOutput` (`migrate-virtual-fields`, `keystone-virtual-fields-context`)
- Setting up the admin UI (`setup-admin-ui`)

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

This plugin lives in the OpenSaaS Stack monorepo at `claude-plugins/opensaas-migration/` and is distributed via the Claude Code marketplace (`OpenSaasAU/stack`).

**Directory structure:**

```
claude-plugins/opensaas-migration/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest (declares the MCP server)
├── agents/
│   ├── migration-assistant.md
│   └── github-issue-creator.md
├── commands/
│   ├── analyze-schema.md
│   ├── generate-config.md
│   └── validate-migration.md
├── skills/
│   ├── keystone-virtual-fields-context/
│   ├── migrate-context-calls/
│   ├── migrate-document-fields/
│   ├── migrate-image-fields/
│   ├── migrate-imports/
│   ├── migrate-virtual-fields/
│   ├── opensaas-migration/
│   └── setup-admin-ui/
└── README.md
```

## Links

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [Migration Guide](https://stack.opensaas.au/docs/how-to/migrate-from-keystone)
- [GitHub Repository](https://github.com/OpenSaasAU/stack)
