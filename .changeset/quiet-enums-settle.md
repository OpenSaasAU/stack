---
'@opensaas/stack-cli': patch
---

Fix multi-schema mode (db.schemas): emit @@schema on generated native enum blocks so an enum-backed select() no longer produces an invalid schema (P1012). Enums inherit their owning model's schema, defaulting to public; greenfield output is unchanged.
