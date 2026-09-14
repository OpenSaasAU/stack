---
'@opensaas/stack-core': patch
---

Fix three MCP query-tool argument residuals: root `take`/`skip` are now type-checked like the nested selector, root `take: 0` is honoured as zero rows instead of falling back to 10, and the count-only projection path falls back to `0` instead of an unrecognised shape that could carry rows.
