---
'@opensaas/stack-auth': minor
---

`authPlugin` no longer hardcodes `uuid7` on every list it injects. It now resolves the Auth lists' id strategy from an explicit `authPlugin({ idField })`, else the app's own `db.idField` default, else `uuid7` — so an app already on a non-uuid7 default (adopting a live better-auth install whose ids are text, say) keeps its Auth lists on it without a separate override:

```typescript
authPlugin({
  ...adoptBetterAuthTables({ idField: 'cuid2' }),
  emailAndPassword: { enabled: true },
})
```

Only `'uuid7'` and `'cuid2'` are accepted (never `'int autoincrement'`, since the Auth adapter treats every id as a string) — a resolution to `'int autoincrement'` now throws a config-time error naming the fix. An app-declared list under one of the derived keys whose own `db.idField` disagrees with the resolved strategy also throws, naming both values, instead of silently diverging. The adapter's `supportsUUIDs`/`supportsNumericIds` are now derived from the resolved strategy rather than hardcoded, so they can never contradict the emitted column type.
