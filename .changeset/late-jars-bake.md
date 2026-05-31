---
'@opensaas/stack-cli': patch
---

Emit `BaseFieldConfig` from `@opensaas/stack-core/extend` in generated `.opensaas/lists.ts`

The lists generator falls back to `BaseFieldConfig` for field types it doesn't
map explicitly (e.g. plugin-contributed fields like `embedding`, and the
`calendarDay`/`decimal` built-ins). That symbol now lives on the `/extend`
authoring entry point, so generated code imports it from there instead of the
root, fixing a `has no exported member 'BaseFieldConfig'` type error.
