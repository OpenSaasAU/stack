# OpenSaaS Stack Plugin Marketplace

Official marketplace for OpenSaaS Stack Claude Code plugins.

## What's Included

This marketplace provides two official plugins for working with OpenSaaS Stack:

### 1. opensaas-stack (Development Plugin)

Feature-driven development assistant for building OpenSaaS Stack applications.

**Features:**

- **opensaas-helper agent** - Specialized agent that understands OpenSaaS patterns
- **opensaas-builder skill** - Proactively helps implement features from high-level requirements
- `/opensaas-features` - List available features
- `/opensaas-docs` - Search documentation
- MCP integration for interactive feature wizards

**Use when:** Building new OpenSaaS Stack applications or adding features

### 2. opensaas-migration (Migration Plugin)

AI-guided migration assistant for converting existing projects to OpenSaaS Stack.

**Features:**

- **migration-assistant agent** - Guides you through migration from Prisma/KeystoneJS/Next.js
- **opensaas-migration skill** - Expert migration patterns
- `/analyze-schema` - Analyze existing schemas
- `/generate-config` - Generate opensaas.config.ts
- `/validate-migration` - Validate configuration
- MCP integration for migration wizard

**Use when:** Migrating existing Prisma, KeystoneJS, or Next.js projects

## Installation

### Adding the Marketplace

In Claude Code:

```bash
/plugin marketplace add OpenSaasAU/stack
```

Or for local development:

```bash
/plugin marketplace add /path/to/stack
```

### Installing Plugins

After adding the marketplace, install either or both plugins:

```bash
# Development plugin
/plugin install opensaas-stack@opensaas-stack-marketplace

# Migration plugin
/plugin install opensaas-migration@opensaas-stack-marketplace
```

### Automatic Installation (Migrations)

The migration plugin is automatically installed when you run:

```bash
npx @opensaas/stack-cli migrate --with-ai
```

This sets up:

- The marketplace in `.claude/settings.json`
- The migration plugin enabled (with MCP server integration)
- Project metadata in `.claude/opensaas-project.json`

## Development Mode

When developing the OpenSaaS Stack monorepo, the marketplace automatically detects local mode:

- In production: Sources from `github:OpenSaasAU/stack`
- In development: Sources from local filesystem

This allows testing plugin changes before publishing.

## Marketplace Structure

```
.claude-plugin/
├── marketplace.json          # Marketplace manifest
├── plugin.json               # opensaas-stack plugin manifest
├── MARKETPLACE.md            # This file
├── README.md                 # opensaas-stack plugin docs
├── agents/                   # opensaas-stack agents
├── commands/                 # opensaas-stack commands
└── skills/                   # opensaas-stack skills

packages/cli/plugin/
├── .claude-plugin/
│   └── plugin.json           # opensaas-migration plugin manifest
├── README.md                 # opensaas-migration plugin docs
├── agents/                   # opensaas-migration agents
├── commands/                 # opensaas-migration commands
└── skills/                   # opensaas-migration skills
```

## Links

- [OpenSaaS Stack Documentation](https://stack.opensaas.au/)
- [GitHub Repository](https://github.com/OpenSaasAU/stack)
- [Claude Code Marketplace Docs](https://code.claude.com/docs/plugins#plugin-marketplaces)

## Contributing

To contribute to the plugins:

1. Clone the repository
2. Make changes to plugin files
3. Test locally with `/plugin marketplace add /path/to/stack`
4. Submit a pull request

## License

MIT
