---
'@opensaas/stack-core': patch
---

Fix `removeRelated`/`createRelated`/`linkRelated` refusing a non-owning back-reference (the inverse half of a one-to-one, or a synthetic `from_<List>_<field>` back-relation) by checking `many === true` instead of foreign-key ownership.
