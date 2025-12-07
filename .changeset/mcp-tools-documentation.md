---
'@opensaas/stack-cli': minor
---

Add Phase 2 MCP migration tools and enhanced documentation provider

This update adds 6 new MCP server tools to assist with project migration:

**New MCP Tools:**

- `opensaas_start_migration`: Start migration wizard for Prisma/Keystone/Next.js projects
- `opensaas_answer_migration`: Answer migration wizard questions
- `opensaas_introspect_prisma`: Analyze Prisma schema files
- `opensaas_introspect_keystone`: Analyze KeystoneJS config files
- `opensaas_search_migration_docs`: Search local and online documentation
- `opensaas_get_example`: Retrieve curated code examples

**Enhanced Documentation Provider:**

- Local CLAUDE.md file search with relevance scoring
- Curated code examples for common patterns (blog-with-auth, access-control, relationships, hooks, custom-fields)
- Project-specific migration guides for Prisma, KeystoneJS, and Next.js

**Dependencies:**

- Added `fs-extra` and `glob` for local file search capabilities
- Added `@types/fs-extra` for TypeScript support

Note: Migration wizard and introspectors are currently stubs and will be fully implemented in future phases.
