---
'@opensaas/stack-core': patch
---

Fix `calendarDay` writing and filtering a JS `Date` against its now-string-codec column, which could silently drift the stored date by a day under a negative-UTC-offset server timezone.
