---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
'create-opensaas-app': minor
---

Delete the Node build; the Generated bundle loads under plain Node from the committed contract

The `.opensaas/` bundle is erasable TypeScript by contract and loads natively under Node 22.18+, so the compiled twin that existed to serve bundler-less consumers is gone (ADR-0054, withdrawing ADR-0011). Removed:

- `output.buildTarget` from the config surface. A config that sets it is now a compile error; delete the `output` block (or the key) — nothing replaces it, because `.opensaas/context.ts` is the one specifier both a bundler and plain Node load.

  ```typescript
  // Before
  export default config({
    output: { buildTarget: 'node' },
    // ...
  })

  // After
  export default config({
    // ...
  })
  ```

  A plain-Node consumer imports the bundle entry directly:

  ```typescript
  const { rawOpensaasContext } = await import('./.opensaas/context.ts')
  ```

- The CLI's Node build step, its `.opensaas/dist/` layout, and `@typescript/native` as a runtime dependency of `@opensaas/stack-cli` (it stays a devDependency, the compiler the package builds and type-checks its own tests with).

The CLI's tests now run the real `node` binary over a generated bundle with no flags and no loader, and type-check generator output under `erasableSyntaxOnly` and `verbatimModuleSyntax` so a non-erasable construct fails a CLI test before it fails a user's Node.

`create-opensaas-app` no longer accepts `--db`, and its SQLite-to-PostgreSQL transform is deleted. The scaffolded project uses the database its template declares; change it by editing `db` in the generated `opensaas.config.ts`. The scaffolded `tsconfig.json` now carries `erasableSyntaxOnly` and `verbatimModuleSyntax`, so the type-checker reports a non-erasable config before Node does.
