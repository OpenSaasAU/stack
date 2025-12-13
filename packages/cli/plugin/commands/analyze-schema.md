---
description: Analyze the current project schema and provide a detailed breakdown
---

Analyze the current project schema and provide a detailed breakdown.

## Instructions

1. Read `.claude/opensaas-project.json` to determine the project type
2. Use `opensaas_introspect_prisma` or `opensaas_introspect_keystone` based on project type
3. Present the results in a clear, organized format
4. Highlight:
   - All models and their fields
   - Relationships between models
   - Potential access control patterns
   - Any issues or warnings

## Output Format

Present like this:

### Models Summary

| Model | Fields | Has Relations | Suggested Access |
|-------|--------|---------------|------------------|
| ... | ... | ... | ... |

### Detailed Analysis

[For each model, show fields and relationships]

### Recommendations

[Based on the schema, suggest access control patterns]
