# The release gate checks published ranges, not the lockfile

Status: accepted

`pnpm release` blocks only when a **published manifest declares a dependency range that excludes every patched version** of a known advisory. The whole-lockfile advisory audit still runs on every release and is kept as evidence, but its findings no longer block publication.

## Context

The original gate (`specs/release-security-audit.md`, issue #1604) failed the release on any advisory anywhere in `pnpm-lock.yaml`, at any severity. The packages ship no lockfile: a consumer's install resolves its own tree from the published `package.json` ranges, so a patched transitive version reaches them regardless of what this repo's lockfile pins. The gate therefore measured the monorepo's own dev environment. On 2 November 2026 it was blocking the release over vite, launch-editor, happy-dom, minimatch and docs-only undici, none of which reach a user. Because the audit is live, it also turned red overnight on an unchanged lockfile (#1967, #2065). 0.44.0-alpha.0 was versioned but never published because of it.

The case a consumer cannot fix for themselves is a range we declare that rules out the fix: `@opensaas/stack-cli` declaring `glob ^13` when the fix is in 14.0.2.

## Considered options

- **Block on declared ranges that exclude a patch (chosen).** Covers `dependencies`, `optionalDependencies` and `peerDependencies` of every non-private package under `packages/`, plus `examples/starter` and `examples/starter-auth`, whose ranges ship as the scaffolder's templates. Dev dependencies never block.
- **Keep the whole-lockfile gate.** Rejected: high cost, and almost all of what it blocks never reaches a consumer.
- **`pnpm audit --prod` or a severity floor.** Rejected: both still audit our resolved versions rather than the ranges a consumer resolves, so a dev-environment pin still blocks and a range that excludes a fix can still pass.
- **No gate.** Rejected: nothing would catch a published range that keeps users off a fix.

## Consequences

- An advisory on a transitive dependency never blocks, even when a direct dependency's range is what holds it back. That stays a Dependabot and triage concern.
- An advisory with no patched version is reported as a warning, not a failure, because no range bump can fix it.
- An unavailable audit still blocks: the range check needs the advisory data.
- Lockfile hygiene moves to Dependabot and ordinary issues rather than the release.
