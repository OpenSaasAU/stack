---
'@opensaas/stack-cli': minor
---

Add `opensaas migrate` CLI command for project migration

Implements a new CLI command that helps users migrate existing Prisma, KeystoneJS, and Next.js projects to OpenSaaS Stack. The command provides both automatic project analysis and AI-guided migration through Claude Code integration.

Features:
- Auto-detects project type (Prisma, KeystoneJS, Next.js)
- Analyzes existing schema (models, fields, database provider)
- Optional AI-guided migration with `--with-ai` flag
- Creates `.claude/` directory with migration assistant agent
- Generates command files for schema analysis and config generation
- Provides clear next steps and documentation links

Usage:
```bash
opensaas migrate           # Analyze current project
opensaas migrate --with-ai # Enable AI-guided migration
opensaas migrate --type prisma # Force project type
```
