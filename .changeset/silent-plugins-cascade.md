---
'@opensaas/stack-auth': minor
---

Better-auth plugin tables (e.g. the MCP plugin's `oauthApplication`/`oauthAccessToken`/`oauthConsent`) are now derived through the same registry as the four base Auth models, instead of a separate converter that dropped every reference to a bare column. Reference fields now become real `relationship()` foreign keys with the correct `onDelete` cascade, index, uniqueness and nullability, closing a data-integrity defect where deleting a user left their OAuth rows orphaned (neither the database nor better-auth's own `deleteUser` cleaned them up). Plugin-table scalar fields now also honour `fieldName` column maps and `index: true`, and list keys are PascalCased with `db.map` restoring the original physical table name. A reference whose target field isn't the target's `id` (e.g. `oauthAccessToken.clientId` → `oauthApplication.clientId`) is left as a plain scalar column, since `relationship()` only supports `id`-based foreign keys.

No config changes are required — `authPlugin()`/`getAuthLists()` are unchanged. If your app already had an MCP-enabled config generated with an older version, regenerate and diff your schema: the OAuth tables' `userId` columns gain a foreign key, cascade and index they didn't have before.
