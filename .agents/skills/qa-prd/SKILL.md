---
name: qa-prd
description: Independently QA an implemented PRD against its issue spec before sign-off — verify acceptance criteria, required tests, user-story coverage, and out-of-scope guarantees against the real merged code, then post a sign-off comment. Use when the user wants a QA pass on delivered work, an acceptance review of a PRD or spec, or a sign-off before closing a PRD. Distinct from /review (per-PR diff) and /verify (runs the app) — this checks a whole spec against the codebase.
---

# QA a Delivered PRD

Independently confirm that a PRD (or spec) was implemented correctly on the integration branch — verifying against the **spec**, not against the PRs' own claims. Verify only; do not implement, push, or merge. Do **not** rubber-stamp: if an acceptance criterion is unmet, say so plainly.

This sits at a different altitude from the per-change skills:

- `/review` checks one PR's diff. `/verify` runs the app to confirm a change behaves. **`/qa-prd` checks a whole spec against the merged codebase** — acceptance criteria, required tests, user stories, and out-of-scope guarantees.

## Process

### 1. Set up a clean verification checkout

- Fetch and check out the integration branch (the merged state to verify), ideally in an isolated worktree.
- Install dependencies.

### 2. Read the spec and orient on the delivery

- Read the PRD in full: problem statement, solution, user stories, implementation decisions, testing decisions, out-of-scope.
- Note the PRs/issues that delivered it for orientation — but **verify against the actual code**, not the PR descriptions. The PRs are claims; the code is the evidence.

### 3. Verify against the real codebase

For each implementation decision / acceptance criterion, confirm it in the code and cite the evidence (file path or grep result). In particular:

- The promised modules/seams exist with the agreed interfaces.
- Duplication that was meant to be removed is actually gone — grep for stale imports and deleted paths.
- The **testing decisions** are honoured: the modules the PRD required tests for have meaningful tests with real branch coverage (not placeholder tests).
- The **out-of-scope guarantees** were respected — nothing forbidden was changed (e.g. no schema/migration where none was intended; relevant ADRs preserved; dead/forbidden states not introduced). Where a change looks suspicious, diff it against history (`git show`/`git log`) to confirm it was a faithful move, not new behaviour.
- Each **user story** maps to where it is satisfied in the code — flag any gaps.

### 4. Run the quality gates

Run the repo's lint, typecheck, and full test suite on the integration branch, in the prescribed order. Report exact pass/fail and the test counts. A green suite is necessary but not sufficient — it does not replace the criterion-by-criterion check above.

### 5. Deliver the sign-off

Produce a structured QA report:

- **Overall verdict**: PASS / PASS WITH NOTES / FAIL.
- A per-criterion checklist with PASS/FAIL and brief evidence.
- Test / lint / typecheck results with counts.
- Confirmation that out-of-scope items were respected.
- Any defects, gaps, or unmet criteria, called out explicitly.

Post the report as a comment on the PRD issue, clearly labelled as a **QA sign-off** (via the GitHub MCP tools). Return the verdict and a concise summary.

## The verdict is a real gate

Only sign off PASS if the spec is actually met. If you find a defect or an unmet criterion, report FAIL with specifics — the value of this pass is that it is independent and honest, not that it closes the ticket. The EM closes the PRD only on PASS; on FAIL the work re-enters the implementation lifecycle.
