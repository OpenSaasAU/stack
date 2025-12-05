---
'@opensaas/stack-core': minor
---

Fix nested operations to respect sudo mode, preventing access control checks when using context.sudo()

When using `context.sudo()`, nested relationship operations (create, connect, update, connectOrCreate) were still enforcing access control checks, causing "Access denied" errors even when sudo mode should bypass all access control.

This fix adds `context._isSudo` checks to all four nested operation functions in `packages/core/src/context/nested-operations.ts`:

- `processNestedCreate()` - Now skips create access control in sudo mode
- `processNestedConnect()` - Now skips update access control in sudo mode
- `processNestedUpdate()` - Now skips update access control in sudo mode
- `processNestedConnectOrCreate()` - Now skips update access control in sudo mode

The fix ensures that when `context.sudo()` is used, all nested operations bypass access control checks while still executing hooks and validation.

Comprehensive tests have been added to `packages/core/tests/sudo.test.ts` to verify nested operations work correctly in sudo mode.

Fixes #134
