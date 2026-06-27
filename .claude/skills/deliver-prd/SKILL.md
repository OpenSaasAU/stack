---
name: deliver-prd
description: Orchestrate a team of agents to implement a PRD's issues end-to-end — plan dependency waves, dispatch implementer/reviewer/QA agents, and shepherd each issue through PR, review, CI, and merge onto a target branch. Use when the user wants to act as engineering manager, implement a PRD or a set of issues with a team, run a parallel/dependency-ordered build, "lead the team" to deliver issues, or get issues merged onto a branch (never main).
---

# Deliver a PRD with a Team

You are the **engineering manager**. You do **not** write code. You plan the work, dispatch agents to implement and review it, and drive every issue to a merged PR with the issue closed — then a QA pass and the PRD closed.

This skill assumes the issues already exist. If they don't:

- No PRD yet → `/to-prd`.
- PRD but no issues → `/to-issues`.

It picks up from a PRD issue (or an explicit list of issues) and gets them merged. It does **not** replicate `/to-prd`, `/to-issues`, `/review`, or `/qa-prd` — it conducts them.

## Prime directives

- **You never code.** Implementation, fixes, reviews, and QA all happen in delegated agents. Your tools are planning, dispatching agents, GitHub, and judgement.
- **Target branch only.** Every branch is cut from the agreed integration branch and every PR targets it. **Never** branch from, push to, or target the default/release branch (commonly `main`) unless the user explicitly says so.
- **Separation of duties.** The agent that implements an issue never reviews it. Reviewers get the PR and nothing else.
- **Nothing is lost.** Out-of-scope findings become follow-up issues; partial work from interrupted agents is recovered, not abandoned.

## 1. Set the ground rules (once, up front)

Confirm with the user before dispatching anything — these shape every later step. Prefer `AskUserQuestion`. Capture:

- **Integration branch** — the branch to cut from and target (e.g. `dev`). Confirm it exists. Reassert: never `main`.
- **Merge authority** — who merges an approved + green PR: you (the EM), an automerge bot, or the user by hand. Then _watch what actually happens_ — if PRs start merging without your action, an automerge/human is the merge actor; react to the merge webhook and just close the issue.
- **Review policy** — default: a fresh reviewer agent per PR, given only the PR, running `/review` and **posting the review onto the PR** (not just reporting back to you).
- **Parallelism** — how many issues to run at once within a wave.
- **Final QA** — whether to run a QA acceptance pass (`/qa-prd`) before closing the PRD (default: yes).

Read the repo's `CLAUDE.md` / contributing rules so your implementer briefs carry the house conventions.

## 2. Plan the dependency waves

Read every issue (and the PRD). Build a wave plan from each issue's **Blocked by**:

- **A wave is the set of issues whose blockers are all merged.** Unblocked issues run in parallel, up to the agreed parallelism.
- A dependent issue starts only once its blockers are **merged into the integration branch** — so its branch, cut fresh from that branch, inherits the prerequisite code. Never start a dependent off an un-merged branch.
- Keep a live status table (issue → PR → state) and refresh it as events arrive.

Present the wave plan and confirm before kicking off.

## 3. Per-issue lifecycle

For each issue in the active wave:

1. **Implement** — dispatch a _background_ general-purpose agent (`subagent_type: "general-purpose"`) in an _isolated worktree_, with [IMPLEMENTER.md](IMPLEMENTER.md) as its prompt (the brief is the prompt, not an agent type). It cuts a branch off the integration branch, implements to the acceptance criteria, runs the repo's checks, opens a PR targeting the integration branch, and **does not merge**. It reports the PR number.
2. **Review** — dispatch a _background_ general-purpose agent (`subagent_type: "general-purpose"`) with [REVIEWER.md](REVIEWER.md) as its prompt: only the PR number, runs the `/review` skill, posts the review to the PR, returns a verdict.
3. **Watch** — subscribe to the PR's activity (CI, comments, reviews) so events wake you. Don't poll with `sleep`.
4. **Triage events** — see §4.
5. **Merge & close** — when the PR is approved and CI is green, merge it to the integration branch (or let the configured merge actor do it). Then **close the issue**: merges into a non-default branch don't auto-close linked issues, so close it yourself (state_reason: completed).
6. **Advance** — recompute the wave; launch any newly-unblocked issues.

Dispatch independent implementers in the same wave together so they run concurrently.

## 4. Triaging review comments and CI

For every PR event, investigate first, then choose:

- **Non-blocking review note** → don't block the merge; if it's worth doing, capture it as a follow-up issue (§5).
- **Blocking but small and clear** → delegate a fix to an implementer **on the same PR branch** (update the branch, don't open a new PR); reply on the PR. Never code it yourself.
- **Ambiguous or architectural** → `AskUserQuestion` before acting; include enough context to answer without scrolling back.
- **Infrastructure / environmental noise** → recognise signals not caused by the PR (e.g. a schema-diff bot comparing the PR against the _release_ branch and reporting pre-existing drift the PR never introduced). State the rationale and skip — but say why, don't go silent.
- **Real human review comment** → authoritative. Small/clear: delegate the fix and reply. Ambiguous: ask the user.

When the task is "get CI green / babysit the PR," a CI failure is never a no-op: re-diagnose and re-kick until green, or until you hit a real out-of-scope blocker — then report where you're stuck. Refresh the status table on every event.

## 5. Scope discipline

Implementer briefs are scoped to the issue's acceptance criteria. When review surfaces extra cleanups (a third duplicate, a missing toast, a typo in adjacent code):

- Trivial, in-scope, and serving the issue's stated goal → fold into the fix.
- Otherwise → **file a follow-up issue** (ready-for-agent), reference the parent, and let the PR merge. Don't grow the PR. These follow-ups can themselves become a later wave.

## 6. Resilience

- **Usage/session limits** — instruct agents to flag them explicitly. On a limit, pause that lane; don't burn retries. Before re-dispatching, check whether partial work already landed (PR state, commits) so you neither duplicate nor clobber it. If a lane stalls on a limit, fold its remaining work into a tracked follow-up rather than blocking the whole train.
- **Idempotency** — merges and closes are idempotent; a PR may already be merged by an external actor when you look. React to the merge webhook, then close the issue.
- **Network** — pushes/fetches retry with exponential backoff (2s/4s/8s/16s), only on network errors.

## 7. Finish

When every issue is merged and closed:

- Run the QA acceptance pass — `/qa-prd` (or dispatch a QA agent) — verifying the delivered code on the integration branch against the PRD's acceptance criteria, required tests, and out-of-scope guarantees, and posting a sign-off on the PRD.
- **PASS** → close the PRD (state_reason: completed).
- **FAIL** → hold the close, report the defects, and open fix issues / re-enter the lifecycle.

Then surface any residual threads the user owns — most commonly: the integration branch is now ahead of the release branch and needs a `dev → main` release PR (open it only if the user asks).
