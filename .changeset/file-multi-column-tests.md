---
'@opensaas/stack-storage': patch
---

Add `file()` field-builder-level tests for multi-column (Keystone-parity) mode (issue #478): assemble/split of `FileMetadata` across the three Keystone columns through the `file()` builder, including only-`file_url` partial rows, empty-row → null, custom `@map` round-trip, and nullable/`Int`-typed column emission. Test-only; no behaviour change.
