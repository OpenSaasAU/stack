# Release security advisory audit

`pnpm release` runs two steps before building or publishing:

1. **The advisory audit**, in report-only mode (`scripts/security-audit.mjs --report-only`).
   It audits the whole workspace lockfile, including development and optional dependencies,
   against the public npm registry and writes `security-audit.json`. Findings do not block
   publication; an **unavailable** audit does.
2. **The published range check** (`pnpm check:published-ranges`). It reads that report and
   blocks publication when a published manifest declares a dependency range that intersects an
   advisory's vulnerable versions but excludes every patched version.

The release workflow installs the committed lockfile with `--frozen-lockfile` and uses the pnpm
version pinned in `package.json`. ADR-0080 records why the gate checks published ranges rather
than the lockfile: the packages ship no lockfile, so a consumer resolves its own tree, and only a
range we declare can keep them off a fix.

## What the range check covers

- `dependencies`, `optionalDependencies` and `peerDependencies` of every non-private package
  under `packages/`.
- `examples/starter` and `examples/starter-auth`, whose ranges ship as the scaffolder's
  templates.
- Ranges that are not semver (`workspace:`, `npm:` aliases, git URLs) are skipped.
- An advisory with no patched version is reported as a warning, not a failure.
- `devDependencies` and transitive dependencies never block. They are Dependabot and triage
  concerns.

## Environment dependency

The audit requires live DNS and HTTPS access to
`https://registry.npmjs.org/-/npm/v1/security/audits` (POST), including through any
outbound proxy. Installed packages or a warm package cache cannot provide an
offline advisory audit. A registry mirror serving packages is insufficient if
it does not implement npm's advisory API; the command explicitly selects npm.

Issue #1604 was reproduced on 2026-09-20: the restricted agent environment
returned `ENOTFOUND registry.npmjs.org`, while the same command and lockfile in
the network-enabled environment retrieved advisories successfully. The release
workflow also had no advisory audit step. This establishes the local network
constraint; it does not imply that GitHub-hosted runners share that restriction.

No npm or GitHub credential is required to query the public advisory endpoint.
The existing `NPM_TOKEN`/`NODE_AUTH_TOKEN`, GitHub write permissions and OIDC
permission remain publishing requirements, not audit requirements. No additional
secret or repository permission is needed. A 401/403 from a proxy, DNS failure,
TLS failure, timeout, or malformed response is an unavailable audit, never a
clean bill of health. Configure the runner's approved proxy and CA trust if
needed; do not disable TLS verification. Requests use bounded retries and a
two-minute overall process deadline.

## Results

Run from the repository root:

```bash
pnpm check:security-audit
```

```bash
pnpm check:published-ranges
```

`pnpm check:security-audit` (without `--report-only`) still exits 1 on any finding, for anyone
who wants the whole-lockfile view locally.

| Command                  | Exit | Output        | Meaning                                                               |
| ------------------------ | ---- | ------------- | --------------------------------------------------------------------- |
| `check:security-audit`   | 0    | `PASS`        | A complete advisory report contains no known vulnerabilities.         |
| `check:security-audit`   | 1    | `FAIL`        | Advisories were found (0 with `--report-only`).                       |
| `check:security-audit`   | 2    | `UNAVAILABLE` | Coverage could not be established; release is blocked.                |
| `check:published-ranges` | 0    | `PASS`        | Every published range admits a patched version of each advisory.      |
| `check:published-ranges` | 1    | `FAIL`        | A published range excludes every patched version; release is blocked. |
| `check:published-ranges` | 2    | `UNAVAILABLE` | No complete audit report to check against; release is blocked.        |

Every completed command writes `security-audit.json`, containing the status,
registry and full pnpm report (or diagnostic). It prints the result and writes it
to the GitHub Actions job summary. The release workflow retains the report as a
commit-labelled artifact for 30 days even if publication fails. A changeset PR
creation run does not publish and therefore produces no audit artifact.

A failing range check names the manifest, field, dependency, declared range and advisory. Fix it
by widening or bumping that range (with a changeset), then rerun both commands. Lockfile-only
findings in the report are triaged as ordinary issues. Counts change as the advisory database
changes, even for an unchanged lockfile.

## Recovery and fallback

For `UNAVAILABLE`, repair DNS/HTTPS/proxy access or retry after a registry outage,
then rerun the failed release job. If a local release environment cannot reach
npm, use the network-enabled GitHub release runner or an approved connected
checkout of the **same commit and lockfile**, with the pinned pnpm version, and
run the same command. Preserve its report with the commit SHA in the release
validation record. A successful connected diagnostic does not bypass the gate:
publication must run where `pnpm release` can obtain a fresh successful audit.

Never use `--ignore-registry-errors`, `continue-on-error`, `|| true`, or cached
reports to treat missing advisory coverage as success. If no connected runner
can complete the audit, keep the release blocked. See
[pnpm audit documentation](https://pnpm.io/10.x/cli/audit) for the upstream API.

The deterministic command tests run on PRs with only the external pnpm process
substituted. Live registry access remains a release check, consistent with
[ADR-0002](../docs/adr/0002-testing-and-ci-strategy.md).
