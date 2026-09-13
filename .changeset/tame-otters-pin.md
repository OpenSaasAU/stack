---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-tiptap': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-storage': patch
---

Fix a field-level `resolveOutput`/`resolveInput` hook typing `value` as `unknown` at the real `list<Lists.X.TypeInfo>({...})` instantiation. `BaseFieldConfig` and every field builder now take a second `TKey` type parameter pinning the field's own key, so e.g. a `text()` field's `resolveOutput` sees `string` instead of `unknown`, and a mismatched return type is a compile error (#1306).
