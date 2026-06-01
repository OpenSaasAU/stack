# Tests guard the security-critical core; demos and networked checks stay off the PR gate

The access-control engine is the project's defining feature, so CI's job is to keep _that_ behaviour from regressing — not to chase uniform coverage across every package. We gate the PR on a few high-value guards and deliberately keep slower, lower-signal checks out of the fast feedback loop.

## Decisions

- **Coverage is gated only on the security-critical core paths** — `src/access/**`, `src/context/**` (the read/write path, including the Write Pipeline, Hook Pipeline, and nested-operation registry), and `src/validation/**` — via Vitest per-glob, per-file thresholds set at current levels (a ratchet). Other packages (`storage`, `rag`, `auth`, `ui`) remain **report-only**. Gating is enforced by Vitest during the existing `test:coverage` run; the separate `coverage` job stays a reporter.
- **Vitest test discovery excludes `**/dist/**`.** The `test` turbo task depends on `build` (so cross-package imports resolve against built `dist`), which otherwise causes Vitest to also run the compiled `dist/**/*.test.js` duplicates and inflate counts/coverage.
- **`examples/*` are excluded from the default build/CI gate.** Each example needs a developer-created `.env` (gitignored) to `generate`, so building them on a clean checkout fails; they are demos, and the template flows are exercised instead by the `e2e` job's starter-auth production build and by the scaffold guard. Running an example is documented as `cp .env.example .env` first.
- **The first-run guard does not do a networked install on the PR.** It invokes the real `create-opensaas-app` binary against local templates and runs `generate` + `db:push` via the workspace toolchain in an isolated temp dir. A fully published `npm create opensaas-app` → `npx` → real-install end-to-end, and the full `examples/*` build, run in a separate **nightly** workflow.

## Why not the obvious alternatives

- _Blanket per-package coverage thresholds_ would immediately fail on `storage`/`rag`/`auth`/`ui` (40–76%) and pull in coverage work unrelated to the change at hand; the ratchet protects what matters (already ~90–100%) without that drag.
- _Building examples in CI_ or _running a published `npm create` e2e on every PR_ tests environment/registry state more than our code and is slow and flaky; both are better as nightly signals.

These are recorded because a future reader will otherwise wonder why `dist` is excluded from tests, why `examples/*` aren't built in CI, and why coverage gates only part of `core`.
