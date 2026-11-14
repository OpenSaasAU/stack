---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

`checkFieldAccess` is no longer exported from `@opensaas/stack-core/internal`, and the Session vocabulary rethrows only real framework control flow

The admin reads the Session vocabulary instead of evaluating field rules itself, so the field-access evaluator leaves the internal entry point. A rule that throws while the vocabulary or MCP decides what to advertise is rethrown only when its string `digest` starts with one of Next.js's control-flow prefixes (`NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK`, `NEXT_NOT_FOUND`, `DYNAMIC_SERVER_USAGE`, `BAILOUT_TO_CLIENT_SIDE_RENDERING`, `HANGING_PROMISE_REJECTION`) or it is React's postpone. Any other throw, including one carrying an unrelated `digest`, denies that answer and logs a warning.
