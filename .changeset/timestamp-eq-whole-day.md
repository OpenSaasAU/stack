---
'@opensaas/stack-core': patch
'@opensaas/stack-ui': patch
---

A timestamp `is <date>` filter now matches the whole day: core treats a date-only `eq` value as that UTC day, and the Filter builder turns any date-only input (e.g. `8/4/2026`) into the same local-day range as `YYYY-MM-DD` (fixes #2310).
