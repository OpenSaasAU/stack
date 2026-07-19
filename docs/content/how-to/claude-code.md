# Claude Code Plugin

Use AI-assisted development with OpenSaaS Stack. Describe what you want to build and let Claude guide you through systematic feature implementation.

## Overview

The OpenSaaS Stack Claude Code plugin enables **feature-driven development**:

**Traditional approach:**

> "How do I add user authentication?"
> → Lists of manual configuration steps

**With the plugin:**

> "I want to build a recipe sharing app"
> → Claude asks clarifying questions, identifies needed features, runs interactive wizards, generates complete code

## What You Get

### Commands

- `/opensaas-features` - List all available feature wizards
- `/opensaas-docs` - Search OpenSaaS Stack documentation

### Agent

- **opensaas-helper** - Expert assistant that maps requirements to features and implements them systematically

### Skill

- **opensaas-builder** - Proactively invoked when you describe app ideas

### MCP Server Tools

When the MCP server is installed, Claude has access to:

- `opensaas_implement_feature` - Start feature implementation wizards
- `opensaas_feature_docs` - Search live documentation
- `opensaas_list_features` - Browse available features
- `opensaas_suggest_features` - Get personalized recommendations
- `opensaas_validate_feature` - Validate implementations

## Installation

### Option 1: During Project Creation (Recommended)

```bash
npm create opensaas-app@latest my-app --with-ai
```

Or answer "yes" when prompted about AI development tools during interactive setup.

### Option 2: Add to Existing Project

Install the MCP server:

```bash
npx @opensaas/stack-cli mcp install
```

This adds the OpenSaaS MCP server to your Claude Code configuration.

### Option 3: Install Plugin from Marketplace

Add the OpenSaaS repository as a plugin marketplace:

```shell
/plugin marketplace add OpenSaasAU/stack
```

Install the plugin:

```shell
/plugin install opensaas-stack@OpenSaasAU/stack
```

### For OpenSaaS Stack Contributors

The plugin is automatically available when you trust the repository folder in Claude Code.

## MCP Server Setup

The MCP server provides Claude with tools to implement features interactively.

### Automatic Installation

```bash
npx @opensaas/stack-cli mcp install
```

This command updates your Claude Code configuration automatically.

### Manual Configuration

If you prefer manual setup, add to your Claude Code MCP configuration:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

**Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "opensaas": {
      "command": "npx",
      "args": ["@opensaas/stack-cli", "mcp", "serve"],
      "env": {}
    }
  }
}
```

Restart Claude Code after updating the configuration.

## Usage Examples

### Building a New App

```
You: "I want to create a task management app with projects and team collaboration"

Claude will:
1. Ask clarifying questions about requirements
2. Identify needed features (authentication, custom lists, relationships)
3. Run interactive wizards for each feature
4. Generate complete, production-ready code
```

### Adding a Feature

```
You: "I need user authentication with Google login"

Claude will:
1. Use opensaas_implement_feature with authentication wizard
2. Ask about auth methods, roles, profile fields
3. Generate config, UI components, access control
4. Provide migration steps
```

### Searching Documentation

```
/opensaas-docs

You: "How do relationship fields work?"

Claude will fetch current documentation with code examples.
```

## Best Practices

1. **Describe goals, not infrastructure** - Say "I want users to save recipes" not "I need a Recipe model with a userId foreign key"

2. **Answer clarifying questions fully** - The more context you provide, the better the generated code

3. **Let wizards generate complete code** - Wizards produce config, UI, access control, and documentation together

4. **Validate after implementation** - Use `opensaas_validate_feature` to check implementations

## Troubleshooting

### Plugin Not Loading

1. Verify Claude Code is installed and updated
2. Check that you've trusted the project folder
3. Run `/plugin` to see installed plugins

### MCP Server Not Connecting

1. Verify configuration file exists at the correct path
2. Check that `@opensaas/stack-cli` is accessible via npx
3. Restart Claude Code after configuration changes
4. Check for errors with `/mcp` command

### Features Not Generating

1. Ensure you have a valid `opensaas.config.ts` in your project
2. Run `pnpm install` to ensure dependencies are installed
3. Check that the MCP server can access your project directory

## Next Steps

- [Quick Start](/docs/quick-start) - Set up your first OpenSaaS project
- [MCP Setup](/docs/guides/mcp-setup) - Configure MCP for your deployed app
- [Access Control](/docs/core-concepts/access-control) - Understand security patterns
- [Authentication](/docs/guides/authentication) - Detailed auth configuration
