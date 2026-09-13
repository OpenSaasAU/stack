# Doc-import-specifiers checker self-test fixture (bad)

Read by `node scripts/check-doc-import-specifiers.mjs --self-test`. Every block
here is wrong on purpose — none of it is documentation.

A subpath the package does not export at all:

```ts
import { getContext } from '@opensaas/stack-core/context'
```

A subpath that exists, but a name it does not export:

```ts
import { list, notARealExport } from '@opensaas/stack-core'
```

A name that belongs on a different subpath, imported from the root instead:

```ts
import { text } from '@opensaas/stack-core'
```

A default import from a package with no default export:

```ts
import Core from '@opensaas/stack-core'
```

A named import from an opaque subpath — one whose export has no `.d.ts`
entry to enumerate, so it has no exports at all:

```ts
import { globalCss } from '@opensaas/stack-ui/styles'
```
