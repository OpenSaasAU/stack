---
'@opensaas/stack-core': patch
---

Make the secured-surface distinct, cursor and indistinguishability tests falsifiable — no runtime change. The `distinct` case now composes a caller `where` whose answers differ from the unfiltered ones on both the scoped and unscoped sides, and every refusal message is pinned to the literal `unqueryableKey` text beside its `ValidationError` class check.
