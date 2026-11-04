---
'@opensaas/stack-ui': patch
---

Type `CellComponentProps.value` (and the newly-exported `CellValue`) instead of leaving it as `unknown`, so a relationship Cell's null handling is a compile-time guarantee rather than only a runtime one.
