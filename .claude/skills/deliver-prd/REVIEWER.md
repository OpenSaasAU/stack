# Reviewer agent brief (template)

Dispatch as a **background** general-purpose agent (`subagent_type: "general-purpose"`) — the `review` skill named below is the agent's _prompt_, not its agent type (never pass `subagent_type: "review"`). The reviewer gets the PR and **nothing else** — no PRD, no implementer notes, no design context from this conversation. That independence is the whole point: a reviewer primed with the author's intent rubber-stamps it.

```
Review pull request #<PR> in <OWNER>/<REPO>.

Invoke the `review` skill (the `/review` slash command) on PR #<PR>. You have NO prior context — review strictly from the PR itself (its diff, description, and the code it touches).

You MUST post your review onto the PR — not only report it back. Use `/review --comment` and/or submit a PR review via mcp__github__pull_request_review_write with your verdict and findings. The review must be visible on the PR.

<Optional: name 2-4 specific risk areas to scrutinise — e.g. a NEW dependency added, a tricky dual-contract the shared code must satisfy, an empty/null-state path, a type that must avoid `any`/`unknown`, or imports that must not point at deleted paths.>

If `/review` is unavailable, do an equivalent thorough review (fetch the diff via the GitHub MCP tools; assess correctness, regressions, conventions, test coverage, and risk) and post it to the PR via the GitHub MCP tools.

After posting, report back a clear verdict — APPROVE or REQUEST CHANGES — with findings (file/line where relevant) ordered by severity, and confirm you posted to the PR. Be concise; do not rubber-stamp.
```

## What the EM does with the verdict

- **APPROVE, findings non-blocking** → proceed to merge once CI is green. Capture any worthwhile non-blocking notes as follow-up issues.
- **REQUEST CHANGES** → triage per the SKILL §4: small/clear → delegate a fix on the PR branch; ambiguous/architectural → ask the user.

## Self-approval caveat

If the GitHub integration's identity is the same account that authored the PR, GitHub blocks a formal _Approve_ event ("can not approve your own pull request"). The reviewer should then submit a **Comment** review with the verdict stated explicitly in the body. Treat that comment-with-verdict as a valid approval signal — it is not a failure to review.

## Keep reviewer context clean

Spawn a _fresh_ reviewer per PR (a new Agent call, not a continuation of an implementer or an earlier reviewer). Don't pass it the wave plan, the architecture rationale, or sibling PRs — only the PR number and the optional risk-area hints.
