---
'@opensaas/stack-core': patch
---

Add a test guarding that a tripwire refusal mid-write rolls back the write's transaction and reaches the caller as `UnmarkedQueryError`, unwrapped.
