Fixtures for `pnpm check:client-side-effect-imports --self-test`.

`bad/` holds the three shapes the checker must report; `good/` holds the shapes it must leave alone. The
checker asserts both counts, so a regression in the checker — or a deleted fixture — fails the self-test
rather than passing quietly.

Nothing else in the repository compiles or lints these files; the checker reads them exactly as it reads a
real example.
