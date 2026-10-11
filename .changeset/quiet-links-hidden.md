---
'@opensaas/stack-core': patch
---

`removeRelated` with a `parentId` now answers `denied` for a link the session cannot see, whether or not the guess matches, closing an existence oracle.
