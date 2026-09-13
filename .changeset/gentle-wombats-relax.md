---
'@opensaas/stack-auth': patch
---

Fix `deriveAuthLists` deriving a relation that collided with its own foreign-key column for a better-auth reference field whose name doesn't end in `Id`; it now falls back to a plain scalar column, same as a non-`id`-target reference.
