---
'@opensaas/stack-core': patch
'create-opensaas-app': patch
---

The Write Pipeline's ownership, singleton and part-column checks ask the List member resolver instead of re-deriving them from the config.

- Writes on a config that `opensaas generate` refuses now throw generate's own error.
- Under sudo, a Synthetic back-relation key whose value is `undefined` is now refused as undeclared, like any other unknown key.
- `RelationTargetMissingError` is removed from `@opensaas/stack-core`: a `connect` to an undeclared list now fails with generate's refusal, so the error could no longer be thrown.
