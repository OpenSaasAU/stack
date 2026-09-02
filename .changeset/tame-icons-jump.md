---
'@opensaas/stack-core': patch
---

Fix a query fragment read (`{ query: fragment }`) skipping the Access Filter's scoping walk, so a related list's `query` access, row filters, and the read-include depth cap were never enforced. Fragment reads may now return fewer related rows — those rows were never authorised.
