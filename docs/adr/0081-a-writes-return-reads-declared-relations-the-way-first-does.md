# A write's return reads declared relations the way `first()` does

Status: accepted

Extends [ADR-0051](0051-declared-dependencies-are-an-emitted-one-hop-set.md) to the write path.

## Context

A write's return ran Field Visibility over the row the write produced. That row carries no relations, so a computed field with `needs: ['lineItems']` found nothing on `item`: an unguarded hook threw and rolled the write back, and a guarded one returned a value `first()` on the same row contradicted (#2159).

## Decision

On a list where a computed field declares a relation, a write's return is the row read through the same plan and the same `visibleRows` a `first()` of that identity uses. There is no second assembly path, so the shapes cannot drift: the session's Access Filter scopes the row and the dependency, the dependency is stripped before the caller sees it, and a row the session cannot `query` still comes back as its system fields with nothing computed (ADR-0058, Silent failure).

The read runs on the write's own handle. It sees the write, including what `afterOperation` hooks wrote, takes no lock, and needs no second connection, so a pool of one cannot wait on itself.

For `create` and `update` the read follows the after-operation hooks, where the queryability check it replaces already ran.

For `delete` no row is left to read afterwards, so the read happens first: inside the transaction, after the row lock, **before any hook runs**. Reading just before the `DELETE` instead would be wrong for the common case. The default foreign key restricts, so a `beforeOperation` that clears the children is how such a row gets deleted, and the return would then compute over nothing. `delete` therefore returns what `first()` gave at the lock, the same row hooks receive as `item` and `afterOperation` as `originalItem`. The cost is that a `beforeOperation` writing the row it is about to delete does not show in the return, on these lists alone.

## Costs

A list that declares a relation pays one more `SELECT` per write, unless its `query` rule is a filter, where this read replaces the one the write already ran. A list that declares none takes the path it always did, with no extra query.
