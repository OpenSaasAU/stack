---
'@opensaas/stack-cli': minor
'create-opensaas-app': minor
---

# Add MCP Server for AI-Assisted Development

## New Features

### CLI Package (@opensaas/stack-cli)

- **New `opensaas mcp` command group** for AI-assisted development:
  - `opensaas mcp install` - Install MCP server in Claude Code
  - `opensaas mcp uninstall` - Remove MCP server from Claude Code
  - `opensaas mcp start` - Start MCP server directly (for debugging)

- **Feature-driven development tools**:
  - Interactive feature implementation wizards (authentication, blog, comments, file-upload, semantic-search)
  - Live documentation search from stack.opensaas.au
  - Code generation following OpenSaaS best practices
  - Smart feature suggestions based on your current app
  - Config validation

- **MCP tools available in Claude Code**:
  - `opensaas_implement_feature` - Start feature wizard
  - `opensaas_feature_docs` - Search documentation
  - `opensaas_list_features` - Browse available features
  - `opensaas_suggest_features` - Get personalized recommendations
  - `opensaas_validate_feature` - Validate implementations

### create-opensaas-app

- **Interactive MCP setup prompt** during project creation
- Option to enable AI development tools automatically
- Automatic installation of MCP server if user opts in
- Helpful instructions if MCP installation is declined or fails

## Installation

Enable AI development tools for an existing project:

```bash
npx @opensaas/stack-cli mcp install
```

Or during project creation:

```bash
npm create opensaas-app@latest my-app
# When prompted: Enable AI development tools? → yes
```

## Benefits

- **Build apps faster**: Describe what you want to build, get complete implementations
- **Feature-driven development**: Work with high-level features instead of low-level config
- **Best practices baked in**: Generated code follows OpenSaaS Stack patterns
- **Live documentation**: Always up-to-date docs from the official site
- **Single toolkit**: All developer commands in one CLI

## Example Usage

With Claude Code installed and the MCP server enabled, you can:

```
You: "I want to build a food tracking app"

Claude Code uses MCP tools to:
1. Ask clarifying questions about requirements
2. Implement authentication feature (wizard)
3. Create custom Food and FoodLog lists
4. Generate complete code with UI and access control
5. Provide testing and deployment guidance
```
