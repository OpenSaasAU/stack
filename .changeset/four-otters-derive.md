---
'@opensaas/stack-auth': patch
---

`deriveAuthLists` now derives the Auth lists (User/Session/Account/Verification/RateLimit) from better-auth's own `getAuthTables()` output instead of a hand-written transcription, closing the drift class behind #935/#937/#921/#986. Generated schema output is unchanged for existing projects — no migration needed.
