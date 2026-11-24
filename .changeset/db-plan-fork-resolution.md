---
'@opensaas/stack-cli': patch
---

`opensaas db plan` treats a fork as resolved once a later package exists, so following the `--from` remedy no longer leads to an un-appliable plan.
