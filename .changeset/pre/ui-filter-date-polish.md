---
'@opensaas/stack-ui': patch
---

`calendarDay` filters accept the viewer-locale date format, date-only timestamp chips say "(UTC)", `2026-8-4` and `8/4` are rejected as timestamp values, and saving an item confirms on the list.
