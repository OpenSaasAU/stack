---
'@opensaas/stack-core': minor
'@opensaas/stack-cli': minor
---

Move field-config types to `@opensaas/stack-core/fields`, beside their builders

The concrete field-config types (`TextField`, `IntegerField`, `CheckboxField`,
`TimestampField`, `PasswordField`, `SelectField`, `RelationshipField`,
`JsonField`, `VirtualField`, plus `DecimalField`, `CalendarDayField`, and
`PrismaRelationResult`) now live on the `/fields` entry point alongside the
builders that produce them, instead of the root barrel. One concept, one import
path:

```typescript
import { text, decimal } from '@opensaas/stack-core/fields'
import type { TextField, DecimalField } from '@opensaas/stack-core/fields'
```

`DecimalField` and `CalendarDayField` were previously defined but exported from
nowhere — they are now public, and the CLI's lists generator maps `decimal`/
`calendarDay` fields to their precise types instead of the generic
`BaseFieldConfig` fallback. The umbrella `FieldConfig` stays on the root entry
point and `BaseFieldConfig` stays on `/extend`.
