# A throwing `afterTransaction` hook is reported, never propagated

Status: accepted

An `afterTransaction` hook, list or field level, that throws never changes the result of the write or of `context.transaction()`. Its error goes to the config's `onAfterTransactionError({ error, status, listKey, operation })`, once per failed hook, or to `console.error` when no callback is set or the callback itself throws. A rejection therefore always means the write did not persist. This amends the ADR-0028 consequence "a rejected `context.transaction()` no longer implies rollback".

## Context

ADR-0028 accepted that a deferred hook throwing after a commit rejects the call with `AfterTransactionError` over already-final data. Callers read that rejection as failure: a retry duplicates the row (#1342), and a compensation undoes something the committed row depends on (#1748).

## Consequences

- Every hook still runs when one throws, on both the committed and the rolled-back path.
- On the rolled-back path the caller still receives the transaction's or callback's own error, with ADR-0028's precedence unchanged. Hook errors raised there, previously dropped, now reach the reporting channel too.
- The rule is the same at a top-level write, a joined write's deferred bracket and `context.transaction()`'s settle.
- `AfterTransactionError` is removed. `beforeTransaction` errors still abort and reject.
- Hook authors no longer need a blanket `try/catch` to protect the caller, though one remains good practice for local handling.
