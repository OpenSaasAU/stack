---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
---

Fix `decimal({ defaultValue })` failing schema apply: the default is now emitted in the normalised SQL form the verifier compares against.
