---
'@opensaas/stack-core': patch
---

Fix a read naming a list-only ref's synthetic back-relation (`from_<List>_<field>`) in `include`: it now resolves to the declared relationship it stands for and is scoped by that list's `query` access, its field-level `read` gates, and its virtual fields — instead of being returned unscoped. An `include` key that resolves to neither a declared relationship, a synthetic back-relation, nor `_count` is now rejected rather than silently passed through. Responses will shrink for callers relying on either gap — the extra rows and fields they received were never authorised.
