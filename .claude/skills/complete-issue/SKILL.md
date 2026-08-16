---
name: complete-issue
description: Pick up and complete a GitHub issue end-to-end with TDD, linting, PR creation, and CI review cycle. Use when the user says "complete issue #N", "pick up issue", "work on issue #N", or similar. Args: the GitHub issue number.
---

# Complete GitHub Issue

Pick up a GitHub issue, implement it using /TDD where appropriate, and shepherd it through to a reviewed PR.

## Workflow

Make a todo list for all the tasks below and work through them one at a time, marking each done as you go.

### 1. Read the Issue

- Fetch the issue details using the GitHub MCP tools (`mcp__github__issue_read`) OR using gh cli if MCP is not available
- Understand the requirements, acceptance criteria, and any linked context
- If args were provided, use that as the issue number; otherwise ask the user

### 2. Setup

- Create a new branch off `main`:
- Branch name should be short and relate to the issue (e.g. `feat/issue-42-add-login`)

### 3. Implement with /TDD

- Use the `/tdd` skill for any non-trivial logic
- Write failing tests first, then implement to make them pass
- Keep changes focused on what the issue requires — no scope creep
- **Write few comments.** See the "Comments" section of `CLAUDE.md` for the rule; the failure mode to watch for is specific to working this way. You will finish an issue holding a great deal of hard-won reasoning — why a threshold is 3 and not 5, which two options you weighed, what broke when you tried the obvious thing. The pull to write all of it down next to the code is strong, and it is the wrong destination. **That reasoning is what the PR body, the issue, the changeset and an ADR are for.** They are dated and reviewable; a docblock is neither, and it rots fastest beside the values most likely to change. If you catch yourself writing a paragraph to justify a line, move it to the PR body and leave the line bare.

  Concretely, do not ship: a file header longer than a couple of lines, a docblock on a self-describing constant, a comment restating the line beneath it, or a note explaining why something is _absent_. If a comment would become false when someone edits the code below it, and no test would catch that, delete it. TSDoc on an exported config option, field builder, or plugin surface is the exception — that is the consumer's editor documentation, not narration.

### 4. Commit and Push

- Commit with a clear message describing the change
- Push to the feature branch:
  ```bash
  git push -u origin <branch-name>
  ```

### 5. Create the PR

- Create a PR targeting `main`
- PR title: short and descriptive
- PR body MUST include `Closes #<issue-number>` so the issue auto-closes on merge
- Example body structure:

  ```
  ## Summary
  - <bullet points of what changed>

  ## Test plan
  - [ ] Tests added/updated
  - [ ] pnpm lint passes

  Closes #<issue-number>
  ```

### 6. CI Review Cycle

- Complete a full review with a subagent using the /review skill.
- Post a comment on the PR with the review results and any requested changes.

### 7. Address Review Feedback

- If changes are requested, make them in the branch, commit, and push.
- Resolve any relevant issues raised (bug fixes, style, correctness)
- Re-run `pnpm format` after changes, commit, and push

### 8. Done

- Confirm CI is green and review concerns are addressed
- Report back to the user with the PR URL
