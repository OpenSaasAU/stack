---
'@opensaas/stack-core': minor
---

Add decimal field type for precise numeric values

You can now use the `decimal()` field type for storing precise decimal numbers, ideal for currency, measurements, and financial calculations:

```typescript
import { decimal } from '@opensaas/stack-core/fields'

fields: {
  price: decimal({
    precision: 10,
    scale: 2,
    validation: {
      isRequired: true,
      min: '0',
      max: '999999.99'
    }
  }),
  latitude: decimal({
    precision: 18,
    scale: 8,
    db: { map: 'lat' }
  })
}
```

Features:

- Configurable precision (default: 18) and scale (default: 4)
- Min/max validation with string values for precision
- Database column mapping via `db.map`
- Nullability control via `db.isNullable`
- Index support (`isIndexed: true` or `isIndexed: 'unique'`)
- Uses Prisma's Decimal type backed by decimal.js for precision
- Generates proper TypeScript types with `import('decimal.js').Decimal`
