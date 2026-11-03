---
'@opensaas/stack-rag': patch
---

Fix the `semantic_search_<list>` MCP tool spreading every embedding column's vector and metadata into each result, burning context and leaking a column that may carry its own read restriction.
