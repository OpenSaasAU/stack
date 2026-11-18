---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

The Write Pipeline's ownership, singleton and part-column checks ask the List member resolver instead of re-deriving them from the config.

- Writes on a config whose list or member names `opensaas generate` refuses now throw generate's own error.
- Under sudo, a Synthetic back-relation key whose value is `undefined` is now refused as undeclared, like any other unknown key.
- `RelationTargetMissingError` is removed from `@opensaas/stack-core`: a `connect` to an undeclared list now fails with generate's refusal, so the error could no longer be thrown.

**Migrating:** remove any `instanceof RelationTargetMissingError` checks. The same mistake (a relationship whose `ref` names a list that does not exist) is now refused by `pnpm generate`, with a message naming the list and field, before any context is built.
