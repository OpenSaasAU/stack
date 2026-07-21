---
'@opensaas/stack-storage': patch
---

Add integration-style tests proving image()/file() reject unrecognised write value shapes end-to-end in both `db.columns: 'keystone'` (multi-column) and default single-column (JSON) modes, pinning the #789 fix as a regression guard.
