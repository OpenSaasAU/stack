---
'@opensaas/stack-storage-vercel': patch
---

Fix `getUrl()` returning a fabricated host that never resolves. It now derives the store ID from the configured token/store ID (the same way the SDK does internally) and embeds it along with the access mode, matching the real URL the SDK returns at upload time. A token that doesn't yield a store ID now throws a descriptive error instead of producing a silently wrong URL.
