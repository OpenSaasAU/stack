---
'@opensaas/stack-core': minor
---

Add support for custom scalar types in virtual fields

Virtual fields now support custom scalar types (like Decimal for financial precision) through three approaches:

**1. Primitive type strings (existing, unchanged):**

```typescript
fields: {
  fullName: virtual({
    type: 'string',
    hooks: {
      resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
    },
  })
}
```

**2. Import strings:**

```typescript
fields: {
  totalPrice: virtual({
    type: "import('decimal.js').Decimal",
    hooks: {
      resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
    },
  })
}
```

**3. Type descriptor objects (recommended):**

```typescript
import Decimal from 'decimal.js'

fields: {
  totalPrice: virtual({
    type: { value: Decimal, from: 'decimal.js' },
    hooks: {
      resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
    },
  })
}
```

The TypeScript type generator automatically collects and generates the necessary import statements. This enables precise financial calculations and integration with third-party types while maintaining full type safety.
