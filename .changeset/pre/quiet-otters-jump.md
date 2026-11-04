---
'@opensaas/stack-cli': patch
---

Fix `opensaas dev` deleting a newly-declared extension pack's ref when a config edit both adds the pack and carries a destructive change together, which stranded the pack refless and made `db update --confirm` fail.
