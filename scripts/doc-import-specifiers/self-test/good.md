# Doc-import-specifiers checker self-test fixture (good)

Read by `node scripts/check-doc-import-specifiers.mjs --self-test`. Every
import here is real.

```ts
import { getContext } from '@opensaas/stack-core'
import { config, list } from '@opensaas/stack-core'
import { text, timestamp } from '@opensaas/stack-core/fields'
import type { AccessControl } from '@opensaas/stack-core'
```

A namespace import and a bare side-effect import are never wrong once the
subpath resolves:

```ts
import * as core from '@opensaas/stack-core'
import '@opensaas/stack-ui/styles'
```

A non-`@opensaas` specifier is out of scope for this checker and never
flagged:

```ts
import { useState } from 'react'
import { getContext } from '@/.opensaas/context'
```
