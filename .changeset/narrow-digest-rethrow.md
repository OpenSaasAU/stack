---
'@opensaas/stack-core': minor
'create-opensaas-app': patch
---

`checkFieldAccess` and `isListQueryStaticallyDenied` are gone from core's entry points, nav counts read the Session vocabulary, and the vocabulary rethrows only real framework control flow

The admin reads the Session vocabulary instead of evaluating access rules itself, so the field-access evaluator leaves `@opensaas/stack-core/internal`, and `isListQueryStaticallyDenied` leaves the root entry point.

`resolveNavCounts` counts a list only where the session's vocabulary does not deny `query`. A `query` rule returning `null` or `undefined` now shows no nav count instead of a `0`, and a context that resolves no vocabulary counts nothing.

A rule that throws while the vocabulary or MCP decides what to advertise is rethrown only when it is framework control flow: a string `digest` starting with one of Next.js's control-flow prefixes (`NEXT_REDIRECT`, `NEXT_HTTP_ERROR_FALLBACK`, `NEXT_NOT_FOUND`, `DYNAMIC_SERVER_USAGE`, `BAILOUT_TO_CLIENT_SIDE_RENDERING`, `HANGING_PROMISE_REJECTION`, `NEXT_PRERENDER_INTERRUPTED`), or React's postpone. As Next's `unstable_rethrow` does, an `Error` whose `cause` chain reaches one of those has that cause rethrown, so a rule wrapping `redirect()` in `new Error(message, { cause })` still redirects. Any other throw, including one carrying an unrelated `digest` or an unrelated `cause`, denies that answer and logs a warning.

`isHookOnlyField(field)` is added to `@opensaas/stack-core/internal`, so the admin marks a Hook-only field without reading its `access` itself.
