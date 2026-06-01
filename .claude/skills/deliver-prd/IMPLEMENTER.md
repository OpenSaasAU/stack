# Implementer agent brief (template)

Dispatch as a **background** general-purpose agent with **worktree isolation**. Fill the bracketed slots. The agent implements one issue and opens a PR — it must not merge, and it never reviews its own work.

```
You are an implementer on the team for <OWNER>/<REPO>. Implement GitHub issue #<N> end-to-end and open a pull request. Do NOT merge it.

## Branch & target rules (STRICT)
- `git fetch origin <BASE>`.
- Cut your branch OFF `origin/<BASE>`: `git checkout -b <BRANCH> origin/<BASE>`.
- Your PR MUST target `<BASE>`. NEVER branch off, push to, or target `main`.

## Prior merged work already on <BASE>
<List the prerequisite slices already merged so the agent BUILDS ON them and does not redo them. Tell it to read the current state of the relevant files on <BASE> before changing anything — its worktree may differ from a stale shared checkout.>

## Read the issue first
Use mcp__github__issue_read to read issue #<N> in full, and the parent PRD #<PRD> for context.

## What to build
<Paste the issue's "What to build" + acceptance criteria verbatim. Be explicit about the single trickiest integration point if there is one — e.g. two callers with different contracts the new code must satisfy.>

## House rules (from CLAUDE.md — follow exactly)
<Paste the load-bearing rules: data-access patterns, validation libraries, "never use any", parameter conventions, where shared components/modules live, import-alias gotchas, the test runner.>

## Verify before pushing
- Install deps if needed (e.g. `pnpm install --prefer-offline`).
- Run the repo's lint, typecheck, and tests in the prescribed order (e.g. typegen before tsc). Fix anything you break.

## Finish
- Commit with a clear message; `git push -u origin <BRANCH>` (retry up to 4x with exponential backoff on network errors only).
- Open the PR with base="<BASE>", head="<BRANCH>"; body references "Implements #<N>" and "Part of #<PRD>". base MUST be "<BASE>".
- DO NOT merge.

## Report back
PR number + URL, exact branch name, a concise summary of changes (call out how you handled the tricky bit), and pass/fail of lint+typecheck+tests. If you hit a usage/session limit, say so EXPLICITLY so it can be retried later. If blocked otherwise, report it clearly — don't guess.
```

## Reusing this for a fix on an existing PR branch

To address a blocking review comment, reuse the brief with three changes:

- **Check out the PR branch** instead of cutting a new one (`git fetch origin <BRANCH>` / `git checkout <BRANCH>`).
- Replace "What to build" with **only the requested change**; change nothing else; keep runtime behaviour otherwise identical.
- Push to the **same branch** (this updates the PR — do not open a new PR, do not merge), then reply to the review comment confirming what changed.

Add a guard: **first verify the PR is still open. If it was already merged/closed, STOP — push nothing, open nothing — and report back** so the fix can be redirected to a follow-up issue.

## Notes for the EM

- Give each issue a stable, descriptive branch name (e.g. `<owner-prefix>/issue-<N>-<slug>`).
- The "Prior merged work" section is what keeps a dependent agent from re-implementing its blockers — keep it accurate and current as waves merge.
- Worktree isolation lets concurrent implementers in the same wave run without clobbering each other.
