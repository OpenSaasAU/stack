# OpenSaaS Stack Claude Code Plugin

Feature-driven development assistant for building OpenSaaS Stack applications.

## What This Plugin Provides

### Commands

- `/opensaas-features` - List all available features that can be implemented
- `/opensaas-docs` - Search OpenSaaS Stack documentation

### Agent

- **opensaas-helper** - Specialized agent that understands OpenSaaS patterns and guides you through building applications from high-level requirements

### Skill

- **opensaas-builder** - Proactively detects when you're describing an app idea and helps implement it systematically using feature wizards

### MCP Server Integration

This plugin works with the MCP server built into `@opensaas/stack-cli` which provides:

- `opensaas_implement_feature` - Interactive feature implementation wizards
- `opensaas_feature_docs` - Live documentation search
- `opensaas_list_features` - Browse available features
- `opensaas_suggest_features` - Get personalized recommendations
- `opensaas_validate_feature` - Validate implementations

## Installation

### For OpenSaaS Stack Contributors

If you're working in the OpenSaaS Stack repository, the plugin is automatically available when you trust the folder.

### For External Projects

Install the MCP server:

```bash
npx @opensaas/stack-cli mcp install
```

Or during project creation:

```bash
npm create opensaas-app@latest my-app
# When prompted: Enable AI development tools? → yes
```

## Usage Philosophy

This plugin enables **feature-driven development** instead of infrastructure configuration:

**Traditional approach**:

```
User: "How do I add user authentication?"
Response: [Lists steps to create User model, configure plugin, etc.]
```

**With this plugin**:

```
User: "I want to build a recipe sharing app"
Agent: "Let me understand your requirements:
- Will users need accounts to save recipes?
- Should recipes have ingredients as separate entities?
- Any social features like ratings or comments?

[After answers, systematically implements:
1. Authentication with user accounts
2. Recipe list with relationships
3. Ingredient management
4. Comment system
All with complete code, UI, and access control]"
```

## Example Workflows

### Building a New App

Simply describe what you want:

```
You: "I want to create a task management app"

Agent will:
1. Ask clarifying questions about requirements
2. Identify needed features (auth, custom Task/Project lists)
3. Run interactive wizards for each feature
4. Generate complete, production-ready code
```

### Adding a Feature

Ask for what you need:

```
You: "I need user authentication with Google login"

Agent will:
1. Use opensaas_implement_feature with authentication wizard
2. Ask about auth methods, roles, profile fields
3. Generate config, UI components, access control
4. Provide migration steps
```

### Searching Documentation

Use commands or just ask:

```
/opensaas-docs

You: "How do relationship fields work?"

Agent will:
1. Use opensaas_feature_docs to fetch current docs
2. Show code examples and patterns
3. Link to relevant sections
```

## What Makes This Different

1. **App-level thinking** - Describe goals, not infrastructure
2. **Complete solutions** - Config + UI + access control + docs + tests
3. **Conversational wizards** - Natural Q&A, not configuration files
4. **Smart suggestions** - Recommends next features based on context
5. **Live documentation** - Always current with production docs
6. **Best practices baked in** - Generated code follows OpenSaaS patterns

## Components

### opensaas-helper Agent

Expert assistant that:

- Understands OpenSaaS Stack patterns from CLAUDE.md
- Maps application requirements to features
- Implements features systematically using MCP wizards
- Enforces best practices (proper access control, strong typing, etc.)
- Validates implementations

### opensaas-builder Skill

Proactively invoked when you describe app ideas:

- Recognizes patterns like "I want to build..." or "I need to add..."
- Asks clarifying questions to understand requirements
- Maps needs to built-in or custom features
- Guides through implementation step-by-step
- Ensures features integrate correctly

### Feature Wizards (via MCP)

Interactive flows for:

- **Authentication** - Users, OAuth, roles, verification
- **Blog** - Content management, rich text, SEO, drafts
- **Comments** - Threading, moderation, reactions
- **File Upload** - Cloud storage, image optimization
- **Semantic Search** - RAG-powered search with embeddings
- **Custom Features** - Domain-specific implementations

Each wizard generates:

- OpenSaaS config updates
- UI components (React/Next.js)
- Access control patterns
- Development documentation
- Environment variables
- Migration steps

## Links

- [MCP Server Package](../packages/stack-mcp/) - Implementation details
- [OpenSaaS Stack Docs](https://stack.opensaas.au/) - Full documentation
- [GitHub Repository](https://github.com/OpenSaasAU/stack)
- [Examples](../examples/) - Reference implementations

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../CONTRIBUTING.md).

## License

MIT
