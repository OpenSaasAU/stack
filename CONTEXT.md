# OpenSaas Stack

Config-first stack for admin-heavy Next.js applications, whose defining feature is an access-control engine that automatically secures every database operation.

## Language

### Access control

**Operation-level access**:
A check that gates whether a session may perform an action (query/create/update/delete) on a list, returning either a boolean or a Prisma filter that scopes which rows are visible.
_Avoid_: list access, row access

**Field-level access**:
A check that gates whether a session may read or write a single field, returning a boolean only. Cannot scope rows — a denied field is removed, not used to exclude records.
_Avoid_: column access, property access

**Access Filter** (pre-query phase):
The first pass of a read, run before the database is hit. Uses operation-level access to build the access-scoped `include`/`where` so the database only returns rows and relations the session is allowed to see.
_Avoid_: query builder, include builder

**Field Visibility** (post-query phase):
The second pass of a read, run on the returned rows. Removes fields the session cannot read, runs `resolveOutput` hooks, and computes virtual fields.
_Avoid_: result filter, output filter, field stripper

**Silent failure**:
The convention that an access-denied operation returns `null` (single) or `[]` (many) rather than throwing, so callers cannot distinguish "denied" from "does not exist".
_Avoid_: access error, permission error

**Write Pipeline**:
The single module that runs the canonical, secured write sequence (hooks → validation → operation-level access → writable-field filtering → nested operations → persistence → after-hooks → Field Visibility) for one create/update/delete. Owns the phase order in one place; per-operation differences (target resolution, which input phases run, the database verb and returned row) are supplied by a per-operation strategy.
_Avoid_: operation handler, mutation service
