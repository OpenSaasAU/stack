---
'@opensaas/stack-core': patch
---

Fix multi-column fields (e.g. storage `image()`/`file()` in Keystone-parity mode) writing an unrecognised value silently instead of failing validation. The column split now runs after `validateFieldRules`, not before, at the top-level and nested write paths.
