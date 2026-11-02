---
'@opensaas/stack-core': minor
'@opensaas/stack-ui': minor
---

Hook-only fields: `access: { write: 'hooks' }`

No caller, `sudo()` included, may name the field in a create or update; only the list's own `resolveInput` sets it. The admin form renders it read-only and MCP omits it from write tools.

```typescript
state: select({ options, defaultValue: 'new', access: { write: 'hooks' } })
```
