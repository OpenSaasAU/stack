---
'@opensaas/stack-rag': patch
---

Fix flaky `RateLimiter` under-limit test: assert no throttling delay was scheduled instead of asserting wall-clock duration.
