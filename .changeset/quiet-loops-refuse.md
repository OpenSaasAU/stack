---
'@opensaas/stack-cli': patch
---

`opensaas generate` now refuses to write live artifacts while an `opensaas dev` loop is running for the project, so a parked destructive change is no longer promoted over the loop's database.
