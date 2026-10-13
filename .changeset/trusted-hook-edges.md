---
'@opensaas/stack-core': minor
---

A relationship edge a list or field `resolveInput` hook introduces is now trusted: the reachability query runs over the edges the caller supplied in `inputData`, so a hook can assign a relationship to a row the session cannot query without `sudo()`. A caller-supplied unreachable `connect` still returns `null`, even if a hook overwrites it (ADR-0075).
