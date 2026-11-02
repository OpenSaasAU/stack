---
'@opensaas/stack-core': patch
'@opensaas/stack-cli': patch
'@opensaas/stack-tiptap': patch
'@opensaas/stack-rag': patch
'@opensaas/stack-storage': patch
---

Fix a field-level `resolveOutput`/`resolveInput` hook typing `value` as `unknown` at the real `list<Lists.X.TypeInfo>({...})` instantiation. `BaseFieldConfig` and every field builder now take a second `TKey` type parameter pinning the field's own key, so e.g. a `text()` field's `resolveOutput` sees `string` instead of `unknown`, and a mismatched return type is a compile error (#1306).

Compatibility note: a third-party field builder that hasn't adopted the new `TKey` parameter (the single-parameter `BaseFieldConfig<TTypeInfo>` shape the docs previously showed) now fails to compile — not merely loses hook precision — when mounted inside a `list<Lists.X.TypeInfo>({...})`-typed config, even with no custom `hooks` declared. The no-explicit-`TypeInfo` authoring flow (`list({ fields: {...} })`) is unaffected either way. Every field builder in this monorepo (core, tiptap, rag, storage) is already updated.
