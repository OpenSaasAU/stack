# Spike: per-boot password on the Dev database (#1758)

**Recommendation: a small interception layer is feasible (outcome 2).** Not shipped here; scoped for a follow-up issue.

Versions tested: `@electric-sql/pglite@0.5.8`, `@electric-sql/pglite-socket@0.2.11` (both are the newest published as of 2026-10-10), `pg`, `psql`.

## Findings

1. **No upstream support.** PGlite runs in single-user mode: there is no postmaster, `pg_hba.conf` or role password check, so `md5`/`scram-sha-256` cannot be enabled. `PGLiteSocketServer` options are `db, port, host, path, inspect, debug, idleTimeout, maxConnections`; there is no auth hook. The handler answers `SSLRequest` with `N`, ignores `CancelRequest`, and forwards every other message to `execProtocolRawStream`. `QueryQueueManager` is not exported, so the stack cannot attach its own sockets to a handler after authenticating them.
2. **Interception works.** `proxy-auth.mjs` puts a ~40-line `net` server in front of the `PGLiteSocketServer`, which now listens on a unix socket in a dedicated directory created `0700` and `chmod`ed explicitly (the existing data directory is not relied on, since `mkdirSync` under a `0002` umask can leave it group-writable), so the unauthenticated hop is unreachable by other uids and is not port-scannable). The front server answers `SSLRequest` with `N`, sends `AuthenticationCleartextPassword`, compares the `PasswordMessage` in constant time, and on success replays the original startup message to the inner socket and pipes bytes both ways. PGlite itself then sends `AuthenticationOk`, `ParameterStatus` and `ReadyForQuery`. Cleartext is acceptable on loopback; SCRAM would be more code for no gain here.
3. **Clients tested** (run, not assumed): `pg` `Client` (good password connects and queries; wrong and missing password fail with `28P01`), `pg` `Pool` with 6 concurrent queries over `max: 5`, a `postgres://postgres:<pw>@127.0.0.1:<port>/postgres` connection string, `psql` with good password, wrong password (`FATAL: password authentication failed`), and `PGSSLMODE=prefer`. Prisma's driver is constructed over a `pg` Pool, so the `pg` result covers it.
4. **State-file consumers.** The URL is an opaque string handed to `pg`/the Prisma client; `startDevDatabase` already builds it as `postgres://<db>@host:port/<db>`. Adding `:<password>` to the userinfo needs no parser change in `resolveDatabaseUrl`, `findDatabaseUrl()`, `pnpm dev -- tsx …` or the Auth adapter. The password must be percent-encoded if it is not hex; a 32-char hex token needs none. The state file is already planned at `0600` (#1659), which is what makes the secret private.

## Scope of the follow-up

- New `startDevDatabase` internals: inner server on a unix socket in a dedicated directory created `0700` and chmodded explicitly, front TCP server with the handshake above, `url` gains the password. About 60 lines plus tests.
- Windows: PGlite-socket's `path` option uses a named pipe there; needs a check before committing to the inner hop. Fallback is the inner server on an ephemeral loopback port, which leaves it scannable and only half-solves the problem.
- Cancel requests are forwarded unauthenticated (they carry no secret in PGlite, which ignores them anyway).
- Costs: one extra copy of every byte on the loopback; `maxConnections` still applies at the inner server.

## Reproducing

From this directory: `npm install && node proxy-auth.mjs` (needs `psql` on `PATH`). Exits non-zero if a good-password probe fails or a bad-password probe connects.

## Limits of this evidence

Linux only. Prisma's driver was not exercised directly. Throughput was not measured.
