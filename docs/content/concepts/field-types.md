# Field Types

Stack provides a comprehensive set of field types for building your schema. Each field type includes validation, access control, and UI configuration options.

A field is the unit the whole stack delegates to. It decides its own validation schema, the column (or columns) it contributes to the generated contract, and the TypeScript faces a read and a write see — so adding a field type never means editing core. The exact members it owes are in [The Field Builder Contract](#the-field-builder-contract) below, and described member by member in the [Fields API reference](/docs/reference/fields-api).

Field values are read through the composed read described in [Queries](/docs/concepts/queries) and gated by [Access Control](/docs/concepts/access-control); options that shape the generated schema at the list or config level live in the [Config API reference](/docs/reference/config-api).

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
  rank: integer({
    isIndexed: true,
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `validation.min`: Minimum value
- `validation.max`: Maximum value
- `defaultValue`: Default integer value
- `isIndexed`: Boolean or `'unique'` for indexing

### BigInt Field

64-bit integer field for values that overflow `integer()`'s 32-bit `Int` — a millisecond epoch (`Date.now()`), a Snowflake ID, or anything beyond `Number.MAX_SAFE_INTEGER`:

```typescript
import { bigInt } from '@opensaas/stack-core/fields'

fields: {
  occurredAtMs: bigInt({
    validation: { isRequired: true, min: 0n },
  }),
  sequence: bigInt({ defaultValue: 0n }),
}
```

**Options:**

- `validation.isRequired`: Boolean
- `validation.min`: Minimum value (as `bigint`)
- `validation.max`: Maximum value (as `bigint`)
- `defaultValue`: Default value (`bigint | number | string`)
- `isIndexed`: Boolean or `'unique'` for indexing

Create/update accept a `bigint`, an integer `number`, or a numeric `string`, and always coerce to `bigint`. A `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than coerced — pass a `bigint` or a string for values beyond that range.

TypeScript type is `bigint`; `bigint` isn't JSON-serialisable, so an MCP CRUD tool renders the value as a decimal string instead (see [ADR-0029](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0029-a-field-may-serialise-differently-from-its-typescript-type.md)).

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

**Database column:**

A Postgres `numeric` column carrying the declared precision and scale. In the generated contract module that is:

```typescript
price: field.column(numericColumn(10, 2))
```

**TypeScript type:**

A **decimal string**, in both directions. The value never passes through JavaScript's `number`, which is the whole point of the field: `0.1 + 0.2` is a rounding error, `'0.1'` is not. Arithmetic is yours to do with a decimal library, constructed from the string the read hands back:

```typescript
import { Decimal } from 'decimal.js'

const product = await context.db.Product.create({
  data: { name: 'Widget', price: '19.99' },
})

if (product) {
  const unit = new Decimal(product.price)
  const withTax = unit.times('1.1').toDecimalPlaces(2)
}
```

The `create` returns `null` when access is denied, so the value is null-checked before it is read — see [Access Control](/docs/concepts/access-control).

{% callout type="warning" %}
Always use string values for `validation.min`, `validation.max`, and `defaultValue`. A JavaScript number literal has already lost precision before the field sees it.
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

Date/time field, stored as a Postgres `timestamptz`:

```typescript
import { timestamp } from '@opensaas/stack-core/fields'

fields: {
  publishedAt: timestamp(),
  openedAt: timestamp({
    defaultValue: { kind: 'now' },
  }),
  scheduledAt: timestamp({
    isIndexed: true,
  }),
}
```

**Options:**

- `defaultValue`: `{ kind: 'now' }` for a database-side current timestamp, or a fixed `Date`
- `isIndexed`: Boolean or `'unique'` for indexing (not indexed by default)

Reads and writes exchange an **ISO 8601 string**, not a `Date` — the column's codec renders `timestamptz` as text so the value survives a round trip unchanged. Pass `new Date().toISOString()` where you would have passed a `Date`.

#### Automatic `createdAt` / `updatedAt`

There is no per-field auto-update option. A list gets both timestamps together, from `db.timestamps` in the [Config API](/docs/reference/config-api) — set at config level for every list, or per list to override it. It is off by default. `createdAt` takes a database `now()` default; `updatedAt` is maintained by the stack on write. Declaring your own `createdAt` or `updatedAt` field replaces the automatic column of that name.

### Calendar Day Field

Date-only field (no time component) stored in ISO8601 format:

```typescript
import { calendarDay } from '@opensaas/stack-core/fields'

fields: {
  birthDate: calendarDay({
    validation: { isRequired: true },
  }),
  startDate: calendarDay({
    defaultValue: '2025-01-01',
    db: { map: 'start_date' },
  }),
  eventDate: calendarDay({
    isIndexed: true,
  }),
  endDate: calendarDay({
    db: { isNullable: false },
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean - require the field
- `defaultValue`: Default date string in ISO8601 format (YYYY-MM-DD)
- `db.map`: Custom database column name
- `db.isNullable`: Override nullability (default: based on `isRequired`)
- `isIndexed`: Boolean or `'unique'` for indexing

**Database column:**

A native Postgres `date` column — the date only, with no time and no timezone. In the generated contract module:

```typescript
birthDate: field.column(dateStringColumn)
```

**TypeScript type:**

A `YYYY-MM-DD` **string**, in both directions. Passing a `Date` is a compile error, which is deliberate: a `Date` carries a time and a timezone that a calendar day does not have, and converting one is where off-by-one bugs come from.

**Usage Example:**

```typescript
const event = await context.db.Event.create({
  data: {
    name: 'Annual Conference',
    startDate: '2025-06-15',
    endDate: '2025-06-17',
  },
})

const upcoming = await context.db.Event.where({ startDate: { gte: '2025-01-01' } })
  .orderBy({ startDate: 'asc' })
  .limit(20)
  .all()
```

`create` returns `null` when access is denied and `.all()` returns `[]` — see [Queries](/docs/concepts/queries) for the full set of terminals and what each returns on denial.

{% callout type="info" %}
The calendarDay field is ideal for dates without time components like birth dates, event dates, deadlines, or publish dates. Use the `timestamp` field when you need both date and time information.
{% /callout %}

{% callout type="warning" %}
Always use ISO8601 date format (YYYY-MM-DD) when setting values. The field validates the format and will reject invalid dates.
{% /callout %}

**When to use:**

- Birth dates, anniversaries, or other personal dates
- Event dates (conferences, meetings, deadlines)
- Publication dates or scheduled dates
- Any date where the time component is not relevant

**When not to use:**

- Timestamps with specific times (use `timestamp` field instead)
- Date ranges that need precise time boundaries
- Audit trails that need exact timestamps

### Password Field

String field that hashes on write and never serialises its hash:

```typescript
import { password } from '@opensaas/stack-core/fields'

fields: {
  password: password({
    validation: {
      isRequired: true,
    },
  }),
}
```

**Options:**

- `validation.isRequired`: Boolean

That is the whole of `PasswordField.validation`. There is no `length` here — a
minimum password length is an auth concern, set through
[`authPlugin({ emailAndPassword: { minPasswordLength } })`](/docs/reference/auth#emailandpassword).

A read returns a `HashedPassword` — a string subclass with a `compare(plaintext)` method — and serialisation (`JSON.stringify`, the admin UI) redacts it to `{ isSet: boolean }`, so the hash never reaches a browser.

{% callout type="warning" %}
Redaction on serialisation is not an access denial. A `password` field is still readable by any caller `context.db` lets through; if the hash should never reach application code either, deny it with field-level `access.read` — see [Access Control](/docs/concepts/access-control).
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
  category: select({
    options: [{ label: 'News', value: 'news' }],
    isIndexed: true,
  }),
}
```

**Options:**

- `options`: Array of `{ label, value }` pairs
- `defaultValue`: Default selected value
- `validation.isRequired`: Boolean
- `ui.displayMode`: `'select'` | `'radio'` | `'segmented-control'`
- `isIndexed`: Boolean or `'unique'` for indexing — well-defined under both the default string column and a native-enum column (`db: { type: 'enum' }`)

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
- `db.foreignKey`: Boolean, or `{ map }` to rename the foreign key column — controls which side stores the foreign key in one-to-one relationships
- `db.isNullable`: Boolean - makes the foreign key column required (FK-owning side only)
- `db.onDelete` / `db.onUpdate`: `ReferentialAction` - what the database does to this row when the referenced row is deleted or its id changes

A relationship is written by connecting an id, not by nesting a create: `{ author: { connect: { id } } }` on the foreign-key-owning side, or `null` to clear the edge. See [Queries](/docs/concepts/queries).

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

`User` gets a `accountId` column and a `belongsTo` relation; `Account` gets the matching `hasOne`.

**Default behavior:** If `db.foreignKey` is not specified, the foreign key is placed on the alphabetically first list. For example, in a `User ↔ Profile` relationship, `Profile` would store the `userId`.

{% callout type="warning" %}
You cannot set `db.foreignKey: true` on both sides of a one-to-one relationship. `opensaas generate` refuses the config if you do.
{% /callout %}

#### Referential Actions

What the database does when the referenced row goes is declared on the foreign-key-owning side, as a typed `db.onDelete` / `db.onUpdate` — there is no escape hatch that edits generated schema text. A self-referential parent link that should detach its children rather than take them with it:

```typescript
fields: {
  parent: relationship({
    ref: 'Category.children',
    db: { foreignKey: true, onDelete: 'setNull', onUpdate: 'cascade' },
  }),
  children: relationship({ ref: 'Category.parent', many: true }),
}
```

The five actions are `'cascade'`, `'restrict'`, `'noAction'`, `'setNull'` and `'setDefault'`, and they are re-emitted verbatim onto the generated foreign key. `'setNull'` writes NULL into the foreign key column, so pairing it with `db: { isNullable: false }` describes a constraint Postgres cannot satisfy.

Constraints spanning more than one field — a unique pair, a composite index — are a list-level concern rather than a field one: see `db.indexes` in the [Config API](/docs/reference/config-api).

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
- `needs`: The columns and relations the computation reads (see Declared Dependencies below)
- `hooks.resolveOutput`: **Required** - Compute field value from other fields
- `hooks.resolveInput`: Optional - Side effects during create/update

#### Declared Dependencies (`needs`)

A `resolveOutput` hook only sees what the read actually fetched. `needs` is how a computed field says what that must include, so the computation does not silently work in the admin UI (which reads everything) and return `undefined` from a narrowed read.

```typescript
fields: {
  title: text({ validation: { isRequired: true } }),
  lineItems: relationship({ ref: 'LineItem.order', many: true }),
  summary: virtual({
    type: 'string',
    needs: ['title', 'lineItems'],
    hooks: {
      resolveOutput: ({ item }) => `${item.title} (${item.lineItems.length} items)`,
    },
  }),
}
```

The rules are narrow on purpose:

- Entries are **column keys** on this same list — stored columns and immediate relationship fields. No dotted paths, no reaching through a relation, never another computed field. `opensaas generate` refuses an entry that names none of those, and refuses a `needs` on a field with no `resolveOutput` hook, since nothing could consume it.
- One hop, and **non-transitive**. A declared relation is fetched; what that relation's own computed fields need is that relation's business.
- A dependency is **private plumbing, not an implicit include**. It is fetched wherever the field is computed — at the root of a read and at every nested level alike — and then **stripped from the result** unless the caller named it too. Adding or removing one changes this field's implementation, never the shape of every read of the list.
- A relation dependency is scoped by the Access Filter exactly like a caller-named one. A session that cannot query the relation does not get it fetched, and the hook sees nothing in its place — so write the hook to tolerate that.

The cost of computing on every read, and the shape of the item a hook is handed, are covered in [Hooks](/docs/concepts/hooks).

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
- Computed via `resolveOutput` on every read
- Can combine data from multiple fields
- Useful for derived values, computed properties, and external sync
- Supports custom scalar types for financial precision

**Usage Example:**

```typescript
const user = await context.db.User.where({ id }).first()

if (user) {
  console.log(user.fullName)
}
```

`.first()` returns `null` when the row does not exist or the session cannot read it — one indistinguishable answer, so the result is null-checked before the computed value is read.

{% callout type="info" %}
`.select()` narrows a read to named fields of this list, computed ones included, and the engine honours it exactly — selecting a computed field widens the underlying query to fetch that field's declared dependencies, then strips them back out. Relations are not selectable; they arrive through `.include()`. See [Queries](/docs/concepts/queries).
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

Stored in a Postgres `jsonb` column; reads and writes exchange a JSON value (object, array, string, number, boolean or `null`). A required `json` field means non-null: an update may omit the key, but may not set it to `null`.

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

See the [Tiptap package documentation](/docs/reference/tiptap) for more details.

### Image Field

From `@opensaas/stack-storage`:

```typescript
import { image } from '@opensaas/stack-storage/fields'

fields: {
  avatar: image({
    storage: 'images',
    validation: {
      maxFileSize: 5 * 1024 * 1024,
      acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    },
  }),
}
```

`storage` names a provider declared in the config's `storage` block, not a provider type. See the [Storage package documentation](/docs/reference/storage) for more details.

## Common Field Options

All field types support these common options:

### Database Configuration

Control how fields are mapped to database columns:

```typescript
text({
  db: {
    map: 'custom_column_name', // Custom database column name
  },
})
```

The `db.map` option renames the underlying column without touching the field name. This is useful for:

- **Legacy database compatibility**: Match existing column naming conventions
- **Database naming standards**: Use snake_case in the database while using camelCase in code

**Example:**

```typescript
fields: {
  firstName: text({
    validation: { isRequired: true },
    db: { map: 'first_name' }, // Database column: first_name
  }),
  emailAddress: text({
    isIndexed: 'unique',
    db: { map: 'email' }, // Database column: email
  }),
}
```

**Generated contract module:**

```typescript
firstName: field.text().column('first_name')
emailAddress: field.text().optional().column('email').unique()
```

{% callout type="info" %}
The `db.map` option affects only the database column name. Your application code continues to use the field name defined in the config (e.g., `firstName`, `emailAddress`), and so does the Where vocabulary.
{% /callout %}

#### Relationship Foreign Key Mapping

For relationship fields, use `db.foreignKey` to control foreign key placement and column naming:

```typescript
author: relationship({
  ref: 'User.posts',
  db: {
    foreignKey: { map: 'author_user_id' }, // Custom foreign key column name
  },
})
```

**Generated contract module:**

```typescript
authorId: field.uuidNative().optional().column('author_user_id')
```

The relation field stays `author` in your code and in the Where vocabulary; only the physical column moves.

**Default behavior:** When `db.foreignKey` is `true` (without `map`), the foreign key column defaults to the field name:

```typescript
author: relationship({
  ref: 'User.posts',
  db: { foreignKey: true },
})
```

**Generated contract module:**

```typescript
authorId: field.uuidNative().optional().column('author')
```

{% callout type="info" %}
For list-only relationships (ref without field name), the foreign key column automatically maps to the field name for consistency with Keystone's behavior.
{% /callout %}

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
    // `resolveOutput` names the field `fieldName`; every other field hook
    // names it `fieldKey`.
    resolveOutput: async ({ item, fieldName }) => {
      // Transform output data
      return item[fieldName]?.toUpperCase()
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
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
} from '@opensaas/stack-core/extend'
import { z } from 'zod'

export type SlugField = BaseFieldConfig<TypeInfo> & {
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
    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: true,
    }),
  }
}
```

See the [Custom Fields guide](/docs/how-to/custom-fields) for a complete tutorial.

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

## The Field Builder Contract

Every field config object declares what the generator delegates to it for.

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

### `getContractField(fieldName, listKey, config)`

Returns what the field contributes to the generated contract — its column, its columns, its relation, or nothing:

```typescript
getContractField: (fieldName) => ({
  kind: 'column',
  name: fieldName,
  type: { pack: 'pg', type: 'text' },
  nullable: true,
})
```

The four descriptor kinds are `'column'` (one stored column, inline), `'columns'` (several), `'relation'` (a relationship and the foreign key it owns), and `'computed'` (a virtual field, which stores nothing).

### `outputType`

The field's TypeScript read face, when its contract column's codec does not already give it the right one. A value, not a method — either a type string or a `TypeDescriptor`:

```typescript
outputType: "import('@opensaas/stack-storage').ImageMetadata | null"
```

Required on a virtual field and on a `kind: 'columns'` field: neither has a single column to be typed from, so `opensaas generate` refuses one that omits it. Optional everywhere else, where it is an override.

`inputType` follows the same shape for the write face. `opensaas generate` never requires it: on a single-column field, absence means the column's own input type. A `kind: 'columns'` field has no single column for that to name, so declare it alongside `outputType` — every multi-column field in this repo does.

### `needs`

The column keys this field's `resolveOutput` hook cannot compute without — stored columns and immediate relations on the same list, one hop, non-transitive, and stripped from the result unless the caller named them too. It is the only supported way for a field to widen the read it is computed inside. Declaring it without a `resolveOutput` hook is a refusal at generate time, because nothing would consume the declaration. See [Declared Dependencies](#declared-dependencies-needs) above.

## Best Practices

### 1. Use Appropriate Field Types

```typescript
// ✅ Good: Use integer for whole numbers
age: integer({ validation: { min: 0, max: 150 } })

// ✅ Good: Use decimal for currency and precise values
price: decimal({
  precision: 10,
  scale: 2,
  validation: { min: '0' },
})

// ✅ Good: Use bigInt for whole numbers beyond Number.MAX_SAFE_INTEGER
occurredAtMs: bigInt({ validation: { isRequired: true } })

// ❌ Bad: Don't use text for numbers
age: text({ validation: { length: { max: 3 } } })

// ❌ Bad: Don't use integer for currency (loses precision)
price: integer()

// ❌ Bad: Don't use integer for a millisecond epoch (overflows 32-bit Int)
occurredAtMs: integer()
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

- **[Hooks System](/docs/concepts/hooks)** - Transform field data
- **[Custom Fields Guide](/docs/how-to/custom-fields)** - Create custom field types
- **[API Reference](/docs/reference/fields-api)** - Complete field API
