# Field Types

OpenSaaS Stack provides a comprehensive set of field types for building your schema. Each field type includes validation, access control, and UI configuration options.

## Core Field Types

### Text Field

String field with validation options:

```typescript
import { text } from '@opensaas/stack-core/fields'

fields: {
  title: text({
    validation: {
      isRequired: true,
      length: { min: 3, max: 100 },
    },
    ui: {
      displayMode: 'input', // or 'textarea'
    },
  }),
  description: text({
    ui: {
      displayMode: 'textarea',
    },
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `validation.length.min`: Minimum length
- `validation.length.max`: Maximum length
- `ui.displayMode`: `'input'` or `'textarea'`

### Integer Field

Number field with validation:

```typescript
import { integer } from '@opensaas/stack-core/fields'

fields: {
  age: integer({
    validation: {
      isRequired: true,
      min: 0,
      max: 150,
    },
  }),
  score: integer({
    validation: {
      min: 0,
      max: 100,
    },
    defaultValue: 0,
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `validation.min`: Minimum value
- `validation.max`: Maximum value
- `defaultValue`: Default integer value

### Decimal Field

Precise decimal field ideal for currency, financial calculations, and measurements:

```typescript
import { decimal } from '@opensaas/stack-core/fields'

fields: {
  price: decimal({
    precision: 10,
    scale: 2,
    validation: {
      isRequired: true,
      min: '0',
      max: '999999.99',
    },
  }),
  latitude: decimal({
    precision: 18,
    scale: 8,
    db: {
      map: 'lat',
      isNullable: false,
    },
  }),
  balance: decimal({
    precision: 18,
    scale: 4,
    defaultValue: '0.0000',
    isIndexed: true,
  }),
}
```

**Options:**

- `precision`: Maximum number of digits (default: 18)
- `scale`: Maximum decimal places (default: 4)
- `validation.isRequired`: Boolean
- `validation.min`: Minimum value (as string for precision)
- `validation.max`: Maximum value (as string for precision)
- `defaultValue`: Default value as string
- `db.map`: Custom database column name
- `db.isNullable`: Override nullability (default: based on `isRequired`)
- `isIndexed`: Boolean or `'unique'` for indexing

**Database Type:**

Generates Prisma's `Decimal` type with precision and scale:

```prisma
price Decimal @db.Decimal(10, 2)
```

**TypeScript Type:**

Uses `Decimal` from `decimal.js` for precise arithmetic:

```typescript
import type { Decimal } from 'decimal.js'

// In your types
price: Decimal | null
```

**Usage with Decimal.js:**

```typescript
import { Decimal } from 'decimal.js'

// Creating records
const product = await context.db.product.create({
  data: {
    name: 'Widget',
    price: '19.99', // Can use string
    // price: 19.99,  // or number (converted to Decimal)
  },
})

// Performing calculations
const total = product.price.times(quantity) // Precise multiplication
const withTax = product.price.times('1.1') // Add 10% tax
```

{% callout type="info" %}
The decimal field type uses Prisma's `Decimal` type, which is backed by the `decimal.js` library. This ensures precise decimal arithmetic without floating-point errors, making it ideal for financial applications where accuracy is critical.
{% /callout %}

{% callout type="warning" %}
Always use string values for `validation.min`, `validation.max`, and `defaultValue` to maintain precision. Using JavaScript numbers may introduce floating-point errors.
{% /callout %}

### Checkbox Field

Boolean field:

```typescript
import { checkbox } from '@opensaas/stack-core/fields'

fields: {
  isPublished: checkbox({
    defaultValue: false,
  }),
  emailVerified: checkbox(),
}
```

**Options:**

- `defaultValue`: Boolean default value

### Timestamp Field

Date/time field with auto-now support:

```typescript
import { timestamp } from '@opensaas/stack-core/fields'

fields: {
  publishedAt: timestamp(),
  createdAt: timestamp({
    defaultValue: { kind: 'now' },
  }),
  updatedAt: timestamp({
    db: { updatedAt: true }, // Auto-update on changes
  }),
}
```

**Options:**

- `defaultValue.kind`: `'now'` for current timestamp
- `db.updatedAt`: Boolean - auto-update on record changes

### Password Field

String field automatically excluded from reads:

```typescript
import { password } from '@opensaas/stack-core/fields'

fields: {
  password: password({
    validation: {
      isRequired: true,
      length: { min: 8 },
    },
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `validation.length.min`: Minimum length
- `validation.length.max`: Maximum length

{% callout type="warning" %}
Password fields are automatically excluded from all read operations for security.
{% /callout %}

### Select Field

Enum field with predefined options:

```typescript
import { select } from '@opensaas/stack-core/fields'

fields: {
  status: select({
    options: [
      { label: 'Draft', value: 'draft' },
      { label: 'Published', value: 'published' },
      { label: 'Archived', value: 'archived' },
    ],
    defaultValue: 'draft',
    validation: {
      isRequired: true,
    },
    ui: {
      displayMode: 'select', // or 'radio', 'segmented-control'
    },
  }),
}
```

**Options:**

- `options`: Array of `{ label, value }` pairs
- `defaultValue`: Default selected value
- `validation.isRequired`: Boolean
- `ui.displayMode`: `'select'` | `'radio'` | `'segmented-control'`

### Relationship Field

Foreign key relationship:

```typescript
import { relationship } from '@opensaas/stack-core/fields'

fields: {
  // One-to-many (User has many posts)
  posts: relationship({
    ref: 'Post.author',
    many: true,
  }),

  // Many-to-one (Post belongs to one user)
  author: relationship({
    ref: 'User.posts',
  }),

  // One-to-one with explicit foreign key placement
  account: relationship({
    ref: 'Account.user',
    db: { foreignKey: true }, // This side stores the foreign key
  }),
}
```

**Options:**

- `ref`: String in format `'ListName.fieldName'` (bidirectional) or `'ListName'` (list-only)
- `many`: Boolean - true for one-to-many relationships
- `db.foreignKey`: Boolean - controls which side stores the foreign key in one-to-one relationships

#### One-to-One Relationships

For one-to-one relationships, only one side should store the foreign key. Use `db.foreignKey` to control placement:

```typescript
// Explicit foreign key placement
User: list({
  fields: {
    account: relationship({
      ref: 'Account.user',
      db: { foreignKey: true }, // User stores accountId
    }),
  },
}),
Account: list({
  fields: {
    user: relationship({
      ref: 'User.account', // No foreign key on this side
    }),
  },
}),
```

**Generated Prisma schema:**

```prisma
model User {
  accountId String?  @unique
  account   Account? @relation(fields: [accountId], references: [id])
}

model Account {
  user User?
}
```

**Default behavior:** If `db.foreignKey` is not specified, the foreign key is placed on the alphabetically first list. For example, in a `User ↔ Profile` relationship, `Profile` would store the `userId`.

{% callout type="warning" %}
You cannot set `db.foreignKey: true` on both sides of a one-to-one relationship. The generator will throw an error if you attempt this.
{% /callout %}

### Virtual Field

Computed field that is not stored in the database:

```typescript
import { virtual } from '@opensaas/stack-core/fields'

fields: {
  firstName: text(),
  lastName: text(),
  // Computed from other fields
  fullName: virtual({
    type: 'string', // TypeScript output type
    hooks: {
      resolveOutput: ({ item }) => {
        return `${item.firstName} ${item.lastName}`
      },
    },
  }),

  // External API sync example
  syncStatus: virtual({
    type: 'boolean',
    hooks: {
      resolveInput: async ({ item }) => {
        // Side effect: sync to external API
        await syncToExternalAPI(item)
        return undefined // Don't store anything
      },
      resolveOutput: () => true,
    },
  }),
}
```

**Options:**

- `type`: TypeScript type string, import string, or type descriptor (see Custom Scalar Types below)
- `hooks.resolveOutput`: **Required** - Compute field value from other fields
- `hooks.resolveInput`: Optional - Side effects during create/update

#### Custom Scalar Types

Virtual fields support custom scalar types (like `Decimal` for financial precision) through three approaches:

**1. Primitive type strings** (for built-in JavaScript types):

```typescript
fullName: virtual({
  type: 'string',
  hooks: {
    resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
  },
})
```

**2. Import strings** (for custom types, explicit format):

```typescript
import Decimal from 'decimal.js'

totalPrice: virtual({
  type: "import('decimal.js').Decimal",
  hooks: {
    resolveOutput: ({ item }) => {
      return new Decimal(item.price).times(item.quantity)
    },
  },
})
```

**3. Type descriptor objects** (recommended for custom types):

```typescript
import Decimal from 'decimal.js'

totalPrice: virtual({
  type: { value: Decimal, from: 'decimal.js' },
  hooks: {
    resolveOutput: ({ item }) => {
      return new Decimal(item.price).times(item.quantity)
    },
  },
})
```

{% callout type="info" %}
The TypeScript type generator automatically collects and generates the necessary import statements. This enables precise financial calculations and integration with third-party types while maintaining full type safety.
{% /callout %}

**Use Cases:**

- **Financial calculations**: Use `Decimal` from `decimal.js` for precise currency calculations
- **Custom data structures**: Return domain-specific types from virtual fields
- **Third-party libraries**: Integrate types from any npm package

**Key Features:**

- Does not create a database column
- Only computed when explicitly selected/included in queries
- Can combine data from multiple fields
- Useful for derived values, computed properties, and external sync
- Supports custom scalar types for financial precision

**Usage Example:**

```typescript
// Query with virtual field
const user = await context.db.user.findUnique({
  where: { id },
  select: {
    firstName: true,
    lastName: true,
    fullName: true, // Virtual field is computed on demand
  },
})

console.log(user.fullName) // "John Doe"
```

{% callout type="info" %}
Virtual fields are only computed when explicitly included in `select` or `include` clauses. They are not computed by default to optimize performance.
{% /callout %}

### JSON Field

Field for storing arbitrary JSON data:

```typescript
import { json } from '@opensaas/stack-core/fields'

fields: {
  metadata: json({
    validation: { isRequired: false },
    ui: {
      placeholder: 'Enter JSON data...',
      rows: 10,
      formatted: true,
    },
  }),
  settings: json({
    validation: { isRequired: true },
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `ui.placeholder`: Placeholder text
- `ui.rows`: Number of textarea rows
- `ui.formatted`: Format JSON with indentation

## Third-Party Field Types

### Rich Text Field

From `@opensaas/stack-tiptap`:

```typescript
import { richText } from '@opensaas/stack-tiptap/fields'

fields: {
  content: richText({
    ui: {
      minHeight: 300,
      maxHeight: 800,
    },
  }),
}
```

See the [Tiptap package documentation](/docs/packages/tiptap) for more details.

### Image Field

From `@opensaas/stack-storage`:

```typescript
import { image } from '@opensaas/stack-storage/fields'

fields: {
  avatar: image({
    storage: 's3',
    validation: {
      isRequired: true,
    },
  }),
}
```

See the [Storage package documentation](/docs/packages/storage) for more details.

## Common Field Options

All field types support these common options:

### Access Control

```typescript
text({
  access: {
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session, item }) => session?.userId === item.authorId,
  },
})
```

### Hooks

```typescript
text({
  hooks: {
    resolveInput: async ({ resolvedData, fieldKey }) => {
      // Transform input data
      return resolvedData[fieldKey]?.toLowerCase()
    },
    resolveOutput: async ({ item, fieldKey }) => {
      // Transform output data
      return item[fieldKey]?.toUpperCase()
    },
  },
})
```

### UI Configuration

```typescript
text({
  ui: {
    label: 'Custom Label',
    description: 'Help text shown below the field',
    placeholder: 'Enter text here...',
    // Field-type-specific options
  },
})
```

## Creating Custom Field Types

You can create custom field types by implementing the `BaseFieldConfig` interface:

```typescript
import type { BaseFieldConfig } from '@opensaas/stack-core'
import { z } from 'zod'

export type SlugField = BaseFieldConfig & {
  type: 'slug'
  from?: string // Field to generate slug from
}

export function slug(options?: Omit<SlugField, 'type'>): SlugField {
  return {
    type: 'slug',
    ...options,
    getZodSchema: (fieldName, operation) => {
      return z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .optional()
    },
    getPrismaType: (fieldName) => {
      return { type: 'String', modifiers: '?' }
    },
    getTypeScriptType: () => {
      return { type: 'string', optional: true }
    },
  }
}
```

See the [Custom Fields guide](/docs/guides/custom-fields) for a complete tutorial.

## Field Validation

Validation rules are defined in the `validation` object:

```typescript
text({
  validation: {
    isRequired: true,
    length: { min: 3, max: 100 },
  },
})

integer({
  validation: {
    isRequired: true,
    min: 0,
    max: 100,
  },
})
```

Validation errors are thrown during create/update operations and include:

- Field name
- Error type
- Validation rule that failed

## Field Methods

Every field config object provides these methods used by the generator:

### `getZodSchema(fieldName, operation)`

Returns a Zod schema for validation:

```typescript
getZodSchema: (fieldName, operation) => {
  let schema = z.string()

  if (validation?.length) {
    if (validation.length.min) schema = schema.min(validation.length.min)
    if (validation.length.max) schema = schema.max(validation.length.max)
  }

  return validation?.isRequired ? schema : schema.optional()
}
```

### `getPrismaType(fieldName)`

Returns the Prisma type and modifiers:

```typescript
getPrismaType: (fieldName) => {
  return { type: 'String', modifiers: '?' }
}
```

### `getTypeScriptType()`

Returns the TypeScript type and optionality:

```typescript
getTypeScriptType: () => {
  return { type: 'string', optional: true }
}
```

## Best Practices

### 1. Use Appropriate Field Types

```typescript
// ✅ Good: Use integer for whole numbers
age: integer({ validation: { min: 0, max: 150 } })

// ✅ Good: Use decimal for currency and precise values
price: decimal({
  precision: 10,
  scale: 2,
  validation: { min: '0' }
})

// ❌ Bad: Don't use text for numbers
age: text({ validation: { length: { max: 3 } } })

// ❌ Bad: Don't use integer for currency (loses precision)
price: integer()
```

### 2. Add Validation Rules

```typescript
// ✅ Good: Validate email format
email: text({
  validation: {
    isRequired: true,
    length: { max: 255 },
  },
})

// ❌ Bad: No validation
email: text()
```

### 3. Use Relationships for Foreign Keys

```typescript
// ✅ Good: Use relationship field
author: relationship({ ref: 'User.posts' })

// ❌ Bad: Don't use text for IDs
authorId: text()
```

## Next Steps

- **[Hooks System](/docs/core-concepts/hooks)** - Transform field data
- **[Custom Fields Guide](/docs/guides/custom-fields)** - Create custom field types
- **[API Reference](/docs/api-reference/fields)** - Complete field API
