# Migration Helper - Implementation Tasks

This folder contains standalone task specifications for implementing the AI-powered migration system for OpenSaaS Stack. Each phase can be assigned to a separate coding agent.

## Overview

The migration helper enables users to migrate existing Prisma, Next.js, and KeystoneJS projects to OpenSaaS Stack with AI assistance through Claude Code.

## Task Dependency Order

Tasks must be completed in this order due to dependencies:

```
Phase 1: CLI Command (foundation)
    ↓
Phase 4: Introspectors (needed by Phase 2 & 3)
    ↓
Phase 2: MCP Tools (depends on introspectors)
    ↓
Phase 3: Migration Wizard (depends on MCP tools)
    ↓
Phase 5: Config Generator (depends on wizard)
    ↓
Phase 6: Claude Agent Templates (final integration)
```

**Recommended parallel work:**
- Phase 1 and Phase 4 can be done in parallel
- Phase 2 and Phase 3 can be started together once Phase 4 is complete

## Task Files

| Phase | File | Description | Estimated Effort |
|-------|------|-------------|------------------|
| 1 | `phase-1-cli-command.md` | CLI `migrate` command with project detection | 1 day |
| 2 | `phase-2-mcp-tools.md` | MCP server tools and documentation provider | 2 days |
| 3 | `phase-3-migration-wizard.md` | Interactive migration wizard engine | 2 days |
| 4 | `phase-4-introspectors.md` | Prisma, KeystoneJS, Next.js introspectors | 2 days |
| 5 | `phase-5-config-generator.md` | opensaas.config.ts generator | 2 days |
| 6 | `phase-6-claude-agent.md` | Claude Code agent templates | 1 day |

## Repository Structure

All files are created in `packages/cli/`:

```
packages/cli/src/
├── commands/
│   └── migrate.ts                    # Phase 1
├── migration/
│   ├── types.ts                      # Phase 1 (shared types)
│   ├── introspectors/
│   │   ├── prisma-introspector.ts    # Phase 4
│   │   ├── keystone-introspector.ts  # Phase 4
│   │   └── nextjs-introspector.ts    # Phase 4
│   └── generators/
│       └── migration-generator.ts    # Phase 5
└── mcp/
    ├── lib/
    │   ├── documentation-provider.ts # Phase 2 (modify)
    │   └── wizards/
    │       └── migration-wizard.ts   # Phase 3
    └── server/
        ├── index.ts                  # Phase 2 (modify)
        └── stack-mcp-server.ts       # Phase 2 (modify)
```

## How to Use These Tasks

Each task file contains:

1. **Context Section** - Background info and architecture overview
2. **Reference Code** - Existing patterns to follow
3. **Requirements** - Exact specifications
4. **File Paths** - What to create/modify
5. **Code Templates** - Starting points for implementation
6. **Acceptance Criteria** - How to verify completion
7. **Testing Instructions** - How to test the implementation

To assign a task to a coding agent:
1. Copy the entire contents of the phase file
2. Paste into a new Claude Code context
3. The agent has all context needed to complete the task

## Integration Points

After each phase, verify integration:

- **After Phase 1**: Run `opensaas migrate` and verify project detection
- **After Phase 4**: Run introspectors on test projects
- **After Phase 2**: Test MCP tools via `opensaas mcp start`
- **After Phase 3**: Test wizard flow with mock data
- **After Phase 5**: Generate config and run `opensaas generate`
- **After Phase 6**: Full E2E test with Claude Code

## Key Patterns to Follow

All implementations should:

1. **Use existing dependencies** - chalk, ora, fs-extra, jiti, commander
2. **Follow CLI output style** - Emoji prefixes, spinner animations, colored output
3. **Use MCP response format** - `{ content: [{ type: 'text', text: '...' }] }`
4. **Implement proper TypeScript** - No `any` types, proper generics
5. **Handle errors gracefully** - User-friendly messages, recovery suggestions

## Documentation

After implementation, create:
- `docs/content/guides/migration.md` - User-facing migration guide
- Update `packages/cli/CLAUDE.md` - Add migrate command docs
- Update `packages/cli/README.md` - Add migrate command usage
