---
name: migrate-imports
description: Find and replace all @keystone-6 import paths across every file in the project. Invoke as a forked subagent, passing the project root path.
context: fork
agent: general-purpose
---

Find and replace all KeystoneJS import paths with their OpenSaaS Stack equivalents across the project described below. This is a mechanical find-and-replace across every TypeScript/JavaScript file.

$ARGUMENTS

## Import Mapping

| Keystone import (remove/replace)         | OpenSaaS import                            |
| ---------------------------------------- | ------------------------------------------ |
| `@keystone-6/core`                       | `@opensaas/stack-core`                     |
| `@keystone-6/core/fields`                | `@opensaas/stack-core/fields`              |
| `@keystone-6/auth`                       | `@opensaas/stack-auth`                     |
| `@keystone-6/fields-document`            | `@opensaas/stack-tiptap/fields` (see note) |
| `.keystone/types` or `'.keystone/types'` | `@opensaas/stack-core`                     |
| `@keystone-6/core/session`               | Remove entirely (handled by authPlugin)    |

**Note on `@keystone-6/fields-document`**: Replace with `@opensaas/stack-tiptap/fields` and change `document()` → `richText()`. If document field migration is complex, note it for the user and leave a `// TODO: migrate document field` comment.

**Note on `.keystone/types`**: Common imports to update:

```typescript
// Before
import type { Session } from '.keystone/types'
import type { KeystoneContext } from '.keystone/types'
import type { Lists } from '.keystone/types'

// After
import type { AccessControl } from '@opensaas/stack-core'
// KeystoneContext and Lists are no longer needed — use context from getContext()
```

## Config File Rename

If the project has `keystone.ts` or `keystone.config.ts`, it should be renamed to `opensaas.config.ts`. Check if it has already been renamed before doing so.

## Steps

1. Use Glob to find all `.ts` and `.tsx` files in the project (exclude `node_modules`, `.next`, `dist`)
2. Use Grep to identify which files contain `@keystone-6` or `.keystone/types` imports
3. For each affected file:
   a. Read the file
   b. Apply the import replacements from the table above
   c. For `.keystone/types` imports, update the specific type names (Session → AccessControl, etc.)
   d. Edit the file with the changes
4. Check if `keystone.ts` or `keystone.config.ts` exists and rename to `opensaas.config.ts` if needed (and if not already done)
5. Report: list every file changed and what was replaced
