# Field Types API Reference

Complete API reference for all built-in field types in OpenSaaS Stack. For usage examples and guides, see the [Field Types guide](/docs/core-concepts/field-types).

## Core Field Types

### `text()`

String field with validation and indexing options.

```typescript
import { text } from '@opensaas/stack-core/fields'

text(options?: {
  validation?: {
    isRequired?: boolean
    length?: { min?: number; max?: number }
  }
  isIndexed?: boolean | 'unique'
  ui?: {
    displayMode?: 'input' | 'textarea'
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<string, string>
  defaultValue?: string
})
```

#### Options

##### `validation`

Validation rules for the text field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create
- `length?: object` - Length constraints
  - `min?: number` - Minimum character length (default: 1 when required)
  - `max?: number` - Maximum character length

**Example:**

```typescript
title: text({
  validation: {
    isRequired: true,
    length: { min: 3, max: 100 },
  },
})
```

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

**Example:**

```typescript
email: text({
  isIndexed: 'unique',
  validation: { isRequired: true },
})
```

##### `ui.displayMode`

UI display mode for the field.

**Type:** `'input' | 'textarea'`
**Default:** `'input'`

**Example:**

```typescript
description: text({
  ui: { displayMode: 'textarea' },
})
```

#### Database Type

Prisma: `String`

#### TypeScript Type

`string` (optional if not required)

---

### `integer()`

Numeric field for whole numbers.

```typescript
import { integer } from '@opensaas/stack-core/fields'

integer(options?: {
  validation?: {
    isRequired?: boolean
    min?: number
    max?: number
  }
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<number, number>
  defaultValue?: number
})
```

#### Options

##### `validation`

Validation rules for the integer field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create
- `min?: number` - Minimum value (inclusive)
- `max?: number` - Maximum value (inclusive)

**Example:**

```typescript
age: integer({
  validation: {
    isRequired: true,
    min: 0,
    max: 150,
  },
})
```

##### `defaultValue`

Default value when creating new items.

**Type:** `number`

**Example:**

```typescript
score: integer({ defaultValue: 0 })
```

#### Database Type

Prisma: `Int`

#### TypeScript Type

`number` (optional if not required)

---

### `checkbox()`

Boolean field for true/false values.

```typescript
import { checkbox } from '@opensaas/stack-core/fields'

checkbox(options?: {
  defaultValue?: boolean
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<boolean, boolean>
})
```

#### Options

##### `defaultValue`

Default boolean value.

**Type:** `boolean`

**Example:**

```typescript
isPublished: checkbox({ defaultValue: false })
emailVerified: checkbox({ defaultValue: true })
```

#### Database Type

Prisma: `Boolean`

#### TypeScript Type

`boolean` (optional if no default value)

---

### `timestamp()`

Date/time field with automatic timestamp support.

```typescript
import { timestamp } from '@opensaas/stack-core/fields'

timestamp(options?: {
  defaultValue?: { kind: 'now' } | Date
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<Date, Date>
})
```

#### Options

##### `defaultValue`

Default timestamp value.

**Type:** `{ kind: 'now' } | Date`

**Values:**

- `{ kind: 'now' }` - Automatically set to current time on create
- `Date` - Specific date/time value

**Example:**

```typescript
createdAt: timestamp({
  defaultValue: { kind: 'now' },
})

publishedAt: timestamp()
```

#### Database Type

Prisma: `DateTime`

#### TypeScript Type

`Date` (optional if no default value)

#### Validation

Accepts:

- `Date` objects
- ISO 8601 datetime strings

---

### `password()`

String field with automatic bcrypt hashing and secure handling.

```typescript
import { password } from '@opensaas/stack-core/fields'

password(options?: {
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<string, HashedPassword>
})
```

#### Security Features

1. **Automatic Hashing**: Plaintext passwords are automatically hashed using bcrypt with cost factor 10
2. **Idempotent**: Already-hashed passwords are not re-hashed
3. **Secure Output**: Query results return `HashedPassword` instances with a `compare()` method
4. **No Exposure**: Only sends `{ isSet: boolean }` to client (not the hash)

#### Options

##### `validation`

Validation rules for the password field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create

**Example:**

```typescript
password: password({
  validation: { isRequired: true },
})
```

#### Database Type

Prisma: `String`

#### TypeScript Type

`string` for input, `HashedPassword` for output

#### Usage Example

```typescript
// Creating a user - password is automatically hashed
const user = await context.db.user.create({
  data: {
    email: 'user@example.com',
    password: 'plaintextPassword', // Hashed before storage
  },
})

// Authenticating - use the compare() method
const user = await context.db.user.findUnique({
  where: { email: 'user@example.com' },
})

if (user && (await user.password.compare('plaintextPassword'))) {
  // Password is correct
}
```

#### HashedPassword API

```typescript
class HashedPassword extends String {
  /**
   * Compare plaintext password with hashed password
   * @param plaintext - The plaintext password to verify
   * @returns Promise resolving to true if password matches
   */
  compare(plaintext: string): Promise<boolean>
}
```

**Important:**

- Never compare password strings directly
- Always use `await password.compare(input)` for verification
- Empty strings and undefined values skip hashing (allows partial updates)

---

### `select()`

Enum-like field with predefined options.

```typescript
import { select } from '@opensaas/stack-core/fields'

select(options: {
  options: Array<{ label: string; value: string }>
  validation?: {
    isRequired?: boolean
  }
  defaultValue?: string
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<string, string>
})
```

#### Options

##### `options` (required)

Array of available options.

**Type:** `Array<{ label: string; value: string }>`

**Properties:**

- `label` - Display text shown to users
- `value` - Actual value stored in database

**Example:**

```typescript
status: select({
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
    { label: 'Archived', value: 'archived' },
  ],
})
```

##### `defaultValue`

Default selected value (must match one of the option values).

**Type:** `string`

**Example:**

```typescript
status: select({
  options: [
    /* ... */
  ],
  defaultValue: 'draft',
})
```

##### `validation.isRequired`

Whether the field is required.

**Type:** `boolean`

##### `ui.displayMode`

UI component to use for selection.

**Type:** `'select' | 'segmented-control' | 'radio'`
**Default:** `'select'`

**Values:**

- `'select'` - Dropdown select menu
- `'segmented-control'` - Button group (good for 2-4 options)
- `'radio'` - Radio button group

#### Database Type

Prisma: `String`

#### TypeScript Type

Union of option values (e.g., `'draft' | 'published' | 'archived'`)

---

### `relationship()`

Foreign key relationship to another list.

```typescript
import { relationship } from '@opensaas/stack-core/fields'

relationship(options: {
  ref: string
  many?: boolean
  db?: {
    foreignKey?: boolean
  }
  ui?: {
    displayMode?: 'select' | 'cards'
    [key: string]: unknown
  }
  access?: FieldAccess
})
```

#### Options

##### `ref` (required)

Reference to related list in format `'ListName.fieldName'` (bidirectional) or `'ListName'` (list-only).

**Type:** `string`

**Format:** `'ListName.fieldName'` where:

- `ListName` - The target list (PascalCase)
- `fieldName` - The field on the target list that references back (optional)

**Example:**

```typescript
// Bidirectional relationship
User: list({
  fields: {
    posts: relationship({
      ref: 'Post.author',
      many: true,
    }),
  },
})

Post: list({
  fields: {
    author: relationship({
      ref: 'User.posts',
    }),
  },
})

// List-only relationship
Post: list({
  fields: {
    category: relationship({
      ref: 'Category', // No field specified - creates synthetic field
    }),
  },
})
```

##### `many`

Whether this is a one-to-many relationship.

**Type:** `boolean`
**Default:** `false`

**Values:**

- `true` - One-to-many (e.g., User has many Posts)
- `false` - Many-to-one or one-to-one (e.g., Post has one Author)

##### `db.foreignKey`

Controls which side stores the foreign key in one-to-one relationships.

**Type:** `boolean`
**Default:** `undefined` (uses alphabetical ordering)

**Constraints:**

- Only valid on single relationships (`many: false` or undefined)
- Only valid on bidirectional relationships (ref includes target field)
- Cannot be `true` on both sides of a one-to-one relationship

**Example:**

```typescript
// Explicit foreign key placement
User: list({
  fields: {
    account: relationship({
      ref: 'Account.user',
      db: { foreignKey: true }, // User table stores accountId
    }),
  },
}),
Account: list({
  fields: {
    user: relationship({
      ref: 'User.account', // No foreign key on this side
    }),
  },
})
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

**Default behavior:** If `db.foreignKey` is not specified on either side, the foreign key is placed on the alphabetically first list. For example:

- `User ↔ Profile`: Profile stores `userId`
- `Account ↔ Billing`: Account stores `billingId`

{% callout type="info" %}
The `db.foreignKey` option is only needed for one-to-one relationships where you want explicit control over foreign key placement. One-to-many and many-to-one relationships automatically place the foreign key on the correct side.
{% /callout %}

{% callout type="warning" %}
Setting `db.foreignKey: true` on both sides of a one-to-one relationship will cause a validation error. Only one side can store the foreign key.
{% /callout %}

##### `ui.displayMode`

UI component for selecting related items.

**Type:** `'select' | 'cards'`
**Default:** `'select'`

**Values:**

- `'select'` - Dropdown select for choosing related items
- `'cards'` - Card-based UI for managing relationships

#### Relationship Patterns

##### One-to-Many

```typescript
User: list({
  fields: {
    posts: relationship({ ref: 'Post.author', many: true }),
  },
})

Post: list({
  fields: {
    author: relationship({ ref: 'User.posts' }),
  },
})
```

##### Many-to-One

```typescript
Post: list({
  fields: {
    author: relationship({ ref: 'User.posts' }),
  },
})

User: list({
  fields: {
    posts: relationship({ ref: 'Post.author', many: true }),
  },
})
```

##### One-to-One

```typescript
User: list({
  fields: {
    profile: relationship({ ref: 'Profile.user' }),
  },
})

Profile: list({
  fields: {
    user: relationship({ ref: 'User.profile' }),
  },
})
```

#### Database Type

Prisma: Foreign key relationship with `@relation` directive

#### TypeScript Type

- `many: false` - `string` (ID of related item, optional)
- `many: true` - `string[]` (array of IDs, optional)

---

### `json()`

Field for storing arbitrary JSON data.

```typescript
import { json } from '@opensaas/stack-core/fields'

json(options?: {
  validation?: {
    isRequired?: boolean
  }
  ui?: {
    placeholder?: string
    rows?: number
    formatted?: boolean
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<unknown, unknown>
  defaultValue?: unknown
})
```

#### Options

##### `validation`

Validation rules for the JSON field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create

##### `ui.placeholder`

Placeholder text for the JSON input.

**Type:** `string`

##### `ui.rows`

Number of rows for textarea display.

**Type:** `number`

##### `ui.formatted`

Whether to format JSON with indentation.

**Type:** `boolean`
**Default:** `true`

#### Usage Example

```typescript
metadata: json({
  validation: { isRequired: false },
  ui: {
    placeholder: 'Enter JSON data...',
    rows: 10,
    formatted: true,
  },
})

// Creating with JSON data
const item = await context.db.item.create({
  data: {
    metadata: {
      tags: ['tag1', 'tag2'],
      settings: { theme: 'dark', notifications: true },
    },
  },
})

// Querying returns parsed JSON
const item = await context.db.item.findUnique({
  where: { id: '...' },
})
console.log(item.metadata.tags) // ['tag1', 'tag2']
```

#### Database Type

Prisma: `Json` (native JSON in PostgreSQL/MySQL, TEXT in SQLite)

#### TypeScript Type

`unknown` (requires type assertion or type guard when using)

---

### `virtual()`

Computed field that is not stored in the database.

```typescript
import { virtual } from '@opensaas/stack-core/fields'

virtual(options: {
  type: string
  hooks: {
    resolveOutput: (args: {
      operation: 'query'
      value: unknown
      item: TItem
      listKey: string
      fieldName: string
      context: AccessContext
    }) => unknown
    resolveInput?: (args: {
      operation: 'create' | 'update'
      inputValue: unknown
      item?: TItem
      listKey: string
      fieldName: string
      context: AccessContext
    }) => Promise<unknown> | unknown
  }
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
})
```

#### Options

##### `type` (required)

TypeScript type for the virtual field output. Supports three formats:

**Type:** `string | TypeDescriptor`

**Format 1: Primitive type strings** (for built-in JavaScript types):

```typescript
fullName: virtual({
  type: 'string', // or 'number', 'boolean', 'Date', etc.
  hooks: {
    resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
  },
})
```

**Format 2: Import strings** (for custom types):

```typescript
import Decimal from 'decimal.js'

totalPrice: virtual({
  type: "import('decimal.js').Decimal",
  hooks: {
    resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
  },
})
```

**Format 3: Type descriptor objects** (recommended for custom types):

```typescript
import Decimal from 'decimal.js'

totalPrice: virtual({
  type: { value: Decimal, from: 'decimal.js' },
  hooks: {
    resolveOutput: ({ item }) => new Decimal(item.price).times(item.quantity),
  },
})

// With custom name (when constructor name doesn't match export)
customField: virtual({
  type: {
    value: MyClass,
    from: '@myorg/types',
    name: 'MyExportedType', // Optional
  },
  hooks: {
    resolveOutput: ({ item }) => new MyClass(item.data),
  },
})
```

**TypeDescriptor interface:**

```typescript
type TypeDescriptor =
  | string // Primitive or import string
  | {
      value: new (...args: any[]) => any // Constructor/class
      from: string // Import path
      name?: string // Optional custom name
    }
```

**Examples:**

- `'string'` - For string values
- `'number'` - For numeric values
- `'boolean'` - For boolean values
- `'string[]'` - For arrays
- `"import('decimal.js').Decimal"` - For Decimal type
- `{ value: Decimal, from: 'decimal.js' }` - Type descriptor for Decimal

{% callout type="info" %}
The TypeScript type generator automatically collects and generates the necessary import statements when using import strings or type descriptors.
{% /callout %}

**Use cases:**

- **Financial calculations**: Use `Decimal` from `decimal.js` for precise currency calculations
- **Custom data structures**: Return domain-specific types from virtual fields
- **Third-party libraries**: Integrate types from any npm package

##### `hooks.resolveOutput` (required)

Compute the field value from other fields in the item.

**Type:** Function

**Parameters:**

- `operation` - Always `'query'` for virtual fields
- `value` - Database value (always `undefined` for virtual fields)
- `item` - The full item with all selected fields
- `listKey` - The list name (e.g., `'User'`)
- `fieldName` - The field name (e.g., `'fullName'`)
- `context` - Access context with session and db

**Returns:** Computed value of the type specified in `type` option

**Example:**

```typescript
displayName: virtual({
  type: 'string',
  hooks: {
    resolveOutput: ({ item }) => {
      return `${item.name} (${item.email})`
    },
  },
})
```

##### `hooks.resolveInput` (optional)

Perform side effects during create/update operations.

**Type:** Function (optional)

**Parameters:**

- `operation` - Either `'create'` or `'update'`
- `inputValue` - Input value provided (if any)
- `item` - Existing item (undefined for create)
- `listKey` - The list name
- `fieldName` - The field name
- `context` - Access context

**Returns:** `undefined` (return value is ignored, use for side effects only)

**Use cases:**

- Sync data to external API
- Trigger webhooks
- Update related records

**Example:**

```typescript
syncToExternal: virtual({
  type: 'boolean',
  hooks: {
    resolveInput: async ({ item, operation }) => {
      // Side effect: sync to external API
      if (operation === 'update') {
        await syncToExternalAPI(item)
      }
      return undefined // Return value is ignored
    },
    resolveOutput: () => true,
  },
})
```

#### Key Characteristics

1. **No Database Storage**: Virtual fields do not create database columns
2. **On-Demand Computation**: Only computed when explicitly selected/included
3. **Type Safety**: TypeScript type is generated from `type` option
4. **Performance**: Efficient - only computed for requested fields
5. **Flexible**: Can combine multiple fields or perform complex computations

#### Usage Examples

##### Read-Only Computed Field

```typescript
User: list({
  fields: {
    firstName: text(),
    lastName: text(),
    fullName: virtual({
      type: 'string',
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    }),
  },
})

// Usage
const user = await context.db.user.findUnique({
  where: { id },
  select: { firstName: true, lastName: true, fullName: true },
})
console.log(user.fullName) // "John Doe"
```

##### Complex Computed Value

```typescript
Order: list({
  fields: {
    items: json(), // Array of { price: number, quantity: number }
    total: virtual({
      type: 'number',
      hooks: {
        resolveOutput: ({ item }) => {
          if (!item.items || !Array.isArray(item.items)) return 0
          return item.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
        },
      },
    }),
  },
})
```

##### Write Side Effects

```typescript
Post: list({
  fields: {
    title: text(),
    content: text(),
    searchIndexSync: virtual({
      type: 'boolean',
      hooks: {
        resolveInput: async ({ item, operation }) => {
          // Update search index when post is created or updated
          if (operation === 'create' || operation === 'update') {
            await updateSearchIndex(item)
          }
          return undefined
        },
        resolveOutput: () => true,
      },
    }),
  },
})
```

#### Important Notes

{% callout type="warning" %}
Virtual fields must be explicitly selected in queries. They are not included by default.
{% /callout %}

```typescript
// ❌ Virtual field NOT computed
const user = await context.db.user.findUnique({
  where: { id },
})
// user.fullName is undefined

// ✅ Virtual field IS computed
const user = await context.db.user.findUnique({
  where: { id },
  select: { firstName: true, lastName: true, fullName: true },
})
// user.fullName is "John Doe"
```

{% callout type="info" %}
The `resolveOutput` hook must be provided. Virtual fields cannot exist without a computation function.
{% /callout %}

#### Database Type

None - virtual fields do not create database columns

#### TypeScript Type

Type specified in `type` option

#### Validation

Virtual fields do not accept input and cannot be validated. The `getZodSchema` method returns `z.never()`.

---

## Common Field Options

All field types support these common options:

### `access`

Field-level access control rules.

**Type:** `FieldAccess`

```typescript
type FieldAccess = {
  read?: AccessControl
  create?: AccessControl
  update?: AccessControl
}

type AccessControl = (args: {
  session: Session
  item?: T
  context: AccessContext
}) => boolean | Promise<boolean>
```

**Example:**

```typescript
internalNotes: text({
  access: {
    read: ({ session }) => session?.role === 'admin',
    create: ({ session }) => session?.role === 'admin',
    update: ({ session }) => session?.role === 'admin',
  },
})
```

**See:** [Access Control guide](/docs/core-concepts/access-control) for details

---

### `hooks`

Field-level hooks for data transformation and side effects.

**Type:** `FieldHooks<TInput, TOutput>`

```typescript
type FieldHooks<TInput, TOutput> = {
  resolveInput?: (args: {
    operation: 'create' | 'update'
    inputValue: TInput | undefined
    item?: TItem
    listKey: string
    fieldName: string
    context: AccessContext
  }) => Promise<TInput | undefined> | TInput | undefined

  resolveOutput?: (args: {
    operation: 'query'
    value: TInput | undefined
    item: TItem
    listKey: string
    fieldName: string
    context: AccessContext
  }) => TOutput | undefined

  beforeOperation?: (args: {
    operation: 'create' | 'update' | 'delete'
    resolvedValue: TInput | undefined
    item?: TItem
    listKey: string
    fieldName: string
    context: AccessContext
  }) => Promise<void> | void

  afterOperation?: (args: {
    operation: 'create' | 'update' | 'delete' | 'query'
    value: TInput | TOutput | undefined
    item: TItem
    listKey: string
    fieldName: string
    context: AccessContext
  }) => Promise<void> | void
}
```

#### Hook Types

##### `resolveInput`

Transform field value before database write.

**When called:** During `create` and `update` operations, after list-level `resolveInput`

**Use cases:** Hash passwords, normalize data, compute derived values

**Example:**

```typescript
slug: text({
  hooks: {
    resolveInput: async ({ inputValue, item }) => {
      // Auto-generate slug from title if not provided
      if (!inputValue && item?.title) {
        return item.title.toLowerCase().replace(/\s+/g, '-')
      }
      return inputValue
    },
  },
})
```

##### `resolveOutput`

Transform field value after database read.

**When called:** During `query` operations, after field-level access control

**Use cases:** Wrap sensitive data, format values, compute client-safe representations

**Example:**

```typescript
profileImage: text({
  hooks: {
    resolveOutput: ({ value }) => {
      // Add CDN prefix to image URLs
      return value ? `https://cdn.example.com/${value}` : null
    },
  },
})
```

##### `beforeOperation`

Side effects before database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete` operations, after validation

**Use cases:** Logging, validation, pre-operation checks

**Example:**

```typescript
status: select({
  options: [
    /* ... */
  ],
  hooks: {
    beforeOperation: async ({ operation, resolvedValue, item }) => {
      // Log status changes
      if (operation === 'update' && item.status !== resolvedValue) {
        await auditLog.record({
          event: 'status_change',
          from: item.status,
          to: resolvedValue,
        })
      }
    },
  },
})
```

##### `afterOperation`

Side effects after database operation. Does NOT modify data.

**When called:** After `create`, `update`, `delete`, or `query` operations

**Use cases:** Cache invalidation, webhooks, cleanup

**Example:**

```typescript
thumbnail: text({
  hooks: {
    afterOperation: async ({ operation, value, item }) => {
      if (operation === 'delete' && value) {
        // Delete file from storage
        await deleteFromCDN(value)
      } else if (operation === 'update' && value) {
        // Invalidate CDN cache
        await invalidateCDNCache(value)
      }
    },
  },
})
```

**See:** [Hooks guide](/docs/core-concepts/hooks) for execution order and patterns

---

### `ui`

UI-specific configuration passed to field components.

**Type:** `object`

**Common properties:**

- `component?: React.Component` - Custom field component (per-field override)
- `fieldType?: string` - Reference to globally registered field type
- `valueForClientSerialization?: (args) => unknown` - Transform value before sending to browser
- Additional field-type-specific options

**Example:**

```typescript
content: text({
  ui: {
    displayMode: 'textarea',
    placeholder: 'Enter your content...',
    rows: 10,
    // Custom UI options
    spellcheck: true,
    autocomplete: 'off',
  },
})
```

**Custom Component Example:**

```typescript
import { SlugField } from './components/SlugField'

slug: text({
  ui: {
    component: SlugField, // Use custom component for this field only
  },
})
```

**See:** [Custom Fields guide](/docs/guides/custom-fields) for creating custom components

---

### `defaultValue`

Default value when creating new items.

**Type:** Varies by field type

**Example:**

```typescript
status: select({
  options: [
    /* ... */
  ],
  defaultValue: 'draft',
})

score: integer({ defaultValue: 0 })

isPublished: checkbox({ defaultValue: false })

createdAt: timestamp({ defaultValue: { kind: 'now' } })
```

---

## Field Builder Methods

Every field configuration object implements these methods used by generators and validators:

### `getZodSchema(fieldName, operation)`

Returns Zod schema for input validation.

**Signature:**

```typescript
getZodSchema(
  fieldName: string,
  operation: 'create' | 'update'
): z.ZodTypeAny
```

**Parameters:**

- `fieldName` - Field name (used in error messages)
- `operation` - Whether this is a create or update operation

**Returns:** Zod schema for validating input

**Example implementation:**

```typescript
getZodSchema: (fieldName, operation) => {
  const baseSchema = z.string({
    message: `${fieldName} must be text`,
  })

  const withValidation = options?.validation?.isRequired
    ? baseSchema.min(1, { message: `${fieldName} is required` })
    : baseSchema.optional()

  return withValidation
}
```

---

### `getPrismaType(fieldName)`

Returns Prisma type and modifiers for schema generation.

**Signature:**

```typescript
getPrismaType(fieldName: string): {
  type: string
  modifiers?: string
}
```

**Parameters:**

- `fieldName` - Field name (used for generating field-specific modifiers)

**Returns:** Object with:

- `type` - Prisma scalar type (`String`, `Int`, `Boolean`, `DateTime`, `Json`)
- `modifiers` - Optional Prisma modifiers (`?`, `@default(...)`, `@unique`, `@index`)

**Example implementation:**

```typescript
getPrismaType: (fieldName) => {
  return {
    type: 'String',
    modifiers: options?.validation?.isRequired ? undefined : '?',
  }
}
```

---

### `getTypeScriptType()`

Returns TypeScript type information for type generation.

**Signature:**

```typescript
getTypeScriptType(): {
  type: string
  optional: boolean
}
```

**Returns:** Object with:

- `type` - TypeScript type string (e.g., `'string'`, `'number'`, `'boolean'`, `'Date'`)
- `optional` - Whether the field is optional in TypeScript

**Example implementation:**

```typescript
getTypeScriptType: () => {
  return {
    type: 'string',
    optional: !options?.validation?.isRequired,
  }
}
```

---

### `getTypeScriptImports()`

Returns TypeScript imports needed for this field's type (optional).

**Signature:**

```typescript
getTypeScriptImports(): Array<{
  names: string[]
  from: string
  typeOnly?: boolean
}>
```

**Returns:** Array of import specifications

**Example implementation:**

```typescript
getTypeScriptImports: () => {
  return [
    {
      names: ['HashedPassword'],
      from: '@opensaas/stack-core',
      typeOnly: false,
    },
  ]
}
```

---

## Creating Custom Field Types

Custom field types must implement the `BaseFieldConfig` interface:

```typescript
import type { BaseFieldConfig } from '@opensaas/stack-core'
import { z } from 'zod'

export type EmailField = BaseFieldConfig & {
  type: 'email'
  requireVerification?: boolean
}

export function email(options?: Omit<EmailField, 'type'>): EmailField {
  return {
    type: 'email',
    ...options,

    getZodSchema: (fieldName, operation) => {
      const schema = z.string().email({
        message: `${fieldName} must be a valid email`,
      })
      return options?.validation?.isRequired ? schema : schema.optional()
    },

    getPrismaType: (fieldName) => {
      return {
        type: 'String',
        modifiers: options?.validation?.isRequired ? undefined : '?',
      }
    },

    getTypeScriptType: () => {
      return {
        type: 'string',
        optional: !options?.validation?.isRequired,
      }
    },
  }
}
```

**Key principles:**

1. Extend `BaseFieldConfig` with your field's options
2. Implement all three generator methods
3. Use field-level hooks for data transformation
4. Field types are self-contained (no switch statements in core)

**See:** [Custom Fields guide](/docs/guides/custom-fields) for complete tutorial

---

## Third-Party Field Types

### Rich Text (`@opensaas/stack-tiptap`)

```typescript
import { richText } from '@opensaas/stack-tiptap/fields'

content: richText({
  ui: {
    minHeight: 300,
    maxHeight: 800,
    placeholder: 'Write your content...',
  },
})
```

**See:** [Tiptap package documentation](/docs/packages/tiptap)

---

### Image & File (`@opensaas/stack-storage`)

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

avatar: image({
  storage: 's3',
  validation: { isRequired: true },
  transformations: {
    thumbnail: { width: 150, height: 150 },
    large: { width: 1200, height: 1200 },
  },
})

document: file({
  storage: 'local',
  validation: {
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ['application/pdf', 'text/plain'],
  },
})
```

**See:** [Storage package documentation](/docs/packages/storage)

---

## Validation System

### Validation Rules

Field validation is defined in the `validation` object:

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

### Validation Errors

Validation errors include:

- Field name (formatted for display)
- Error message
- Validation rule that failed

**Example error:**

```
{
  "field": "title",
  "message": "Title must be at least 3 characters"
}
```

### Validation Execution Order

1. Field-level Zod schema validation (from `getZodSchema()`)
2. List-level `validateInput` hook
3. Field-level access control (filter writable fields)

---

## Best Practices

### 1. Choose Appropriate Field Types

```typescript
// ✅ Good: Use integer for numbers
age: integer({ validation: { min: 0, max: 150 } })

// ❌ Bad: Don't use text for numbers
age: text({ validation: { length: { max: 3 } } })
```

### 2. Always Add Validation

```typescript
// ✅ Good: Validate required fields and constraints
email: text({
  isIndexed: 'unique',
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

// ❌ Bad: Don't manually manage IDs with text
authorId: text()
```

### 4. Add Indexes for Query Performance

```typescript
// ✅ Good: Index fields used in queries
email: text({
  isIndexed: 'unique',
  validation: { isRequired: true },
})

slug: text({
  isIndexed: true,
})
```

### 5. Use Hooks for Transformation

```typescript
// ✅ Good: Use hooks for data transformation
email: text({
  hooks: {
    resolveInput: async ({ inputValue }) => {
      return inputValue?.toLowerCase().trim()
    },
  },
})

// ❌ Bad: Don't transform in application code
```

---

## Next Steps

- **[Field Types Guide](/docs/core-concepts/field-types)** - Usage examples and patterns
- **[Hooks System](/docs/core-concepts/hooks)** - Field-level data transformation
- **[Access Control](/docs/core-concepts/access-control)** - Field-level security
- **[Custom Fields Guide](/docs/guides/custom-fields)** - Create custom field types
- **[Config API](/docs/api-reference/config)** - Complete configuration reference
