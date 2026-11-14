---
'@opensaas/stack-core': patch
---

Classify a deadlock victim (SQLSTATE `40P01`) as `SerializationFailure`, so `isSerializationFailure` matches it and a retry loop can act on it.
