---
'@opensaas/stack-cli': patch
---

Fix MCP configuration and add agent/skill support to migration wizard

**MCP Configuration:**

- Fixed MCP server configuration to use correct `.mcp.json` format at project root
- Added `type: 'stdio'` field and proper structure
- Added `-y` flag to npx command for auto-accepting prompts

**Migration Assistant Agent:**

- Added required YAML frontmatter with `name`, `description`, `model`, and `skills` fields
- Agent is now properly discoverable by Claude Code
- Auto-loads the `opensaas-migration` skill for expert knowledge

**Migration Skill:**

- Created comprehensive `opensaas-migration` skill with migration guidance
- Includes access control patterns, field type mappings, database configs
- Provides migration checklist and best practices
- Stored in `.claude/skills/opensaas-migration/SKILL.md`

When users run `opensaas migrate --with-ai`, they now get a fully configured Claude Code environment with agents, skills, and MCP tools working together.
