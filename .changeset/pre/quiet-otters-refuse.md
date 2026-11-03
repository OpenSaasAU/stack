---
'@opensaas/stack-core': patch
---

Refuse, at `pnpm generate` time, an explicit `defaultValue` a field's own create validation would reject (e.g. `text({ defaultValue: '', validation: { isRequired: true } })`). Previously the value was written onto the contract column unconditionally, so the column's default dropped the field from `CreateInput`'s required half while the create validator still rejected it — an omitted create type-checked and then threw `ValidationError` at runtime.
