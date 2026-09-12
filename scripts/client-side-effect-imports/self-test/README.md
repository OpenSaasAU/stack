Fixtures for `pnpm check:client-side-effect-imports --self-test`.

`bad/` holds the six shapes the checker must report (a bare side-effect import three ways — relative, `@/`
alias, and with a leading comment — plus a trailing-comment import, a star re-export, and a standalone
dynamic import); `good/` holds the shapes it must leave alone, including the consumed form of each new bad
shape. The checker asserts both counts, so a regression in the checker — or a deleted fixture — fails the
self-test rather than passing quietly.

Nothing else in the repository compiles or lints these files; the checker reads them exactly as it reads a
real example.
