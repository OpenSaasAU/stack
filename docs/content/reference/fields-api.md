# Field Types API Reference

Complete API reference for all built-in field types in Stack. For usage examples and guides, see the [Field Types guide](/docs/concepts/field-types).

Reads in the examples below use the composed read described in [Queries](/docs/concepts/queries); every terminal on it can answer `null` or `[]` for an access denial, so results are null-checked before use ([Access Control](/docs/concepts/access-control)). List- and config-level schema options — `db.timestamps`, `db.indexes`, `db.idField` — are in the [Config API](/docs/reference/config-api).

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
  db?: {
    map?: string
  }
  ui?: {
    displayMode?: 'input' | 'textarea'
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
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

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

**Example:**

```typescript
email: text({
  isIndexed: 'unique',
  validation: { isRequired: true },
})
```

##### `db.map`

Custom database column name.

**Type:** `string`

**Purpose:**

Rename the underlying column without changing the field name. Useful for:

- **Legacy databases**: Match existing column names
- **Naming conventions**: Use snake_case in database, camelCase in code
- **Migration compatibility**: Maintain existing column names

**Example:**

```typescript
firstName: text({
  db: { map: 'first_name' },
})

emailAddress: text({
  isIndexed: 'unique',
  db: { map: 'email' },
})
```

**Generated contract module:**

```typescript
firstName: field.text().optional().column('first_name')
emailAddress: field.text().optional().column('email').unique()
```

The field names in your code (`firstName`, `emailAddress`) remain unchanged, and so do the keys the Where vocabulary accepts. Only the database columns use the mapped names.

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

#### Database column

Postgres `text` (`field.text()`).

#### TypeScript Type

`string`, or `string | null` when the column is nullable.

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
  isIndexed?: boolean | 'unique'
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
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

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

**Example:**

```typescript
rank: integer({
  isIndexed: true,
})
```

#### Database column

Postgres `int4` (`field.int()`) — a 32-bit integer. Use [`bigInt()`](#bigint) beyond that range.

#### TypeScript Type

`number`, or `number | null` when the column is nullable.

---

### `bigInt()`

64-bit integer field for values that overflow `integer()`'s 32-bit `Int` — e.g. a millisecond epoch (`Date.now()`), a Snowflake ID, or any value beyond `Number.MAX_SAFE_INTEGER`.

```typescript
import { bigInt } from '@opensaas/stack-core/fields'

bigInt(options?: {
  validation?: {
    isRequired?: boolean
    min?: bigint
    max?: bigint
  }
  defaultValue?: bigint | number | string
  db?: {
    map?: string
    isNullable?: boolean
    nativeType?: string
  }
  isIndexed?: boolean | 'unique'
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
})
```

#### Options

##### `validation`

Validation rules for the bigInt field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create
- `min?: bigint` - Minimum value (inclusive)
- `max?: bigint` - Maximum value (inclusive)

**Example:**

```typescript
occurredAtMs: bigInt({
  validation: {
    isRequired: true,
    min: 0n,
  },
})
```

##### `defaultValue`

Default value when creating new items.

**Type:** `bigint | number | string`

**Example:**

```typescript
sequence: bigInt({ defaultValue: 0n })
```

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

#### Database column

Postgres `int8` (`field.bigint()`).

#### TypeScript Type

`bigint`, or `bigint | null` when the column is nullable.

#### Write coercion

Create/update accept `bigint`, an integer `number`, or a numeric `string`, and always coerce to `bigint`:

- A non-integer value (e.g. `1.5`) is rejected.
- A `number` above `Number.MAX_SAFE_INTEGER` is rejected rather than silently coerced — by the time a `number` reaches that range it has already lost precision, so accepting it would reintroduce the exact defect this field exists to prevent. Pass a `bigint` literal or a numeric string for values beyond that range.

A `bigint` literal is always safe; a `number` is safe below `Number.MAX_SAFE_INTEGER`; a numeric string is safe at any size.

```typescript
const event = await context.db.Event.create({
  data: { occurredAtMs: 9007199254740993n },
})

if (!event) throw new Error('Not permitted to create an Event')
```

#### Wire representation over MCP

`bigint` is not JSON-serialisable, so an MCP CRUD tool result renders a `bigInt` field's value as a **decimal string**, not a bare `bigint`. This is deliberate (see [ADR-0029](https://github.com/OpenSaasAU/stack/blob/main/docs/adr/0029-a-field-may-serialise-differently-from-its-typescript-type.md)): the field's TypeScript type stays `bigint` in application code, and the MCP wire form is the closest JSON-compatible representation an MCP client can consume.

```json
{ "id": "1", "occurredAtMs": "9007199254740993" }
```

---

### `decimal()`

Precise decimal field for currency, financial calculations, and measurements.

```typescript
import { decimal } from '@opensaas/stack-core/fields'

decimal(options?: {
  precision?: number
  scale?: number
  validation?: {
    isRequired?: boolean
    min?: string
    max?: string
  }
  defaultValue?: string
  db?: {
    map?: string
    isNullable?: boolean
  }
  isIndexed?: boolean | 'unique'
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
})
```

#### Options

##### `precision`

Maximum number of digits in the decimal number.

**Type:** `number`
**Default:** `18`

**Example:**

```typescript
price: decimal({
  precision: 10, // Max 10 digits total
  scale: 2, // 2 decimal places
})
// Can store: 12345678.90 (10 digits, 2 decimals)
```

##### `scale`

Maximum number of decimal places.

**Type:** `number`
**Default:** `4`

**Example:**

```typescript
coordinates: decimal({
  precision: 18,
  scale: 8, // 8 decimal places for GPS precision
})
```

##### `validation`

Validation rules for the decimal field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create
- `min?: string` - Minimum value (as string for precision)
- `max?: string` - Maximum value (as string for precision)

**Example:**

```typescript
price: decimal({
  precision: 10,
  scale: 2,
  validation: {
    isRequired: true,
    min: '0',
    max: '999999.99',
  },
})
```

{% callout type="warning" %}
Always use string values for `min`, `max`, and `defaultValue` to maintain precision. Using JavaScript numbers may introduce floating-point errors.
{% /callout %}

##### `defaultValue`

Default value when creating new items.

**Type:** `string`

**Example:**

```typescript
balance: decimal({
  defaultValue: '0.0000',
  precision: 18,
  scale: 4,
})
```

##### `db.map`

Custom database column name.

**Type:** `string`

**Example:**

```typescript
latitude: decimal({
  db: { map: 'lat' },
  precision: 18,
  scale: 8,
})
```

##### `db.isNullable`

Override nullability independent of `isRequired`.

**Type:** `boolean`
**Default:** Based on `validation.isRequired`

**Example:**

```typescript
price: decimal({
  validation: { isRequired: true },
  db: { isNullable: false }, // Enforce NOT NULL at database level
})
```

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

**Example:**

```typescript
accountNumber: decimal({
  isIndexed: 'unique',
  precision: 20,
  scale: 0,
})
```

#### Database column

Postgres `numeric` carrying the declared precision and scale.

**Generated contract module:**

```typescript
price: field.column(numericColumn(10, 2))
```

#### TypeScript Type

A **decimal string**, in both directions — the exact digits, never a JavaScript `number`. Reading `19.99` back gives `'19.99'`.

#### Usage Example

Arithmetic is the caller's, with a decimal library constructed from the string. `decimal.js` is one such library; the stack does not depend on it and does not return its type.

```typescript
import { Decimal } from 'decimal.js'

const product = await context.db.Product.create({
  data: { name: 'Widget', price: '19.99' },
})

if (product) {
  const subtotal = new Decimal(product.price).times(3)
  const total = subtotal.plus(subtotal.times('0.1')).toDecimalPlaces(2)
  await context.db.Order.create({ data: { total: total.toFixed(2) } })
}
```

The `create` returns `null` on an access denial, so the result is checked before the value is read.

{% callout type="warning" %}
The write face is a string. Passing a JavaScript `number` where a price belongs reintroduces exactly the rounding error this field exists to prevent — the literal `19.99` is already inexact before the field sees it.
{% /callout %}

#### Key Features

1. **Precision**: No floating-point errors — the value never becomes a JavaScript `number`
2. **Configurable**: Set precision and scale for your use case
3. **Validation**: String-based min/max for precise bounds
4. **Database-native**: A real Postgres `numeric` column, not a text approximation

#### Use Cases

- **Currency**: Prices, balances, payments
- **Financial**: Interest rates, exchange rates, percentages
- **Measurements**: GPS coordinates, scientific data
- **Accounting**: Monetary calculations requiring precision

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
  hooks?: FieldHooks<TTypeInfo>
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

#### Database column

Postgres `bool` (`field.boolean()`).

#### TypeScript Type

`boolean`, or `boolean | null` when the column is nullable (a `defaultValue` makes it non-nullable).

---

### `timestamp()`

Date/time field stored as a Postgres `timestamptz`.

```typescript
import { timestamp } from '@opensaas/stack-core/fields'

timestamp(options?: {
  defaultValue?: { kind: 'now' } | Date
  isIndexed?: boolean | 'unique'
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
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
openedAt: timestamp({
  defaultValue: { kind: 'now' },
})

publishedAt: timestamp()
```

There is no `db.updatedAt` option — a field never maintains itself on write. Automatic `createdAt`/`updatedAt` columns come from `db.timestamps` on the list or the config; see the [Config API](/docs/reference/config-api).

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

`timestamp` does not default to indexed — an explicit `isIndexed: true` is required, even for a field commonly used as a sort key, so an existing config's generated schema never changes without an intentional edit.

**Example:**

```typescript
publishedAt: timestamp({
  isIndexed: true,
})
```

#### Database column

Postgres `timestamptz` (`field.column(timestamptzStringColumn)`).

#### TypeScript Type

An **ISO 8601 string**, not a `Date`. The column's codec renders `timestamptz` as text in both directions, so a value survives the round trip byte for byte instead of through a local-timezone `Date`. Nullable unless `defaultValue: { kind: 'now' }` is set.

```typescript
const post = await context.db.Post.where({ id }).first()

if (post?.publishedAt) {
  const when = new Date(post.publishedAt)
}
```

#### Validation

The declared write type is the ISO 8601 string. The runtime validator also accepts a `Date` object, so a value that reaches a write through untyped code still passes.

---

### `calendarDay()`

Date-only field (no time component) stored in ISO8601 format (YYYY-MM-DD).

```typescript
import { calendarDay } from '@opensaas/stack-core/fields'

calendarDay(options?: {
  validation?: {
    isRequired?: boolean
  }
  defaultValue?: string
  isIndexed?: boolean | 'unique'
  db?: {
    map?: string
    isNullable?: boolean
  }
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
})
```

#### Options

##### `validation`

Validation rules for the calendar day field.

**Type:** `object`

**Properties:**

- `isRequired?: boolean` - Field is required on create

**Example:**

```typescript
birthDate: calendarDay({
  validation: { isRequired: true },
})
```

##### `defaultValue`

Default date value in ISO8601 format (YYYY-MM-DD).

**Type:** `string`

**Format:** `YYYY-MM-DD` (e.g., `'2025-01-15'`)

**Example:**

```typescript
startDate: calendarDay({
  defaultValue: '2025-01-01',
})
```

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster date queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction.

**Example:**

```typescript
eventDate: calendarDay({
  isIndexed: true,
})
```

##### `db.map`

Custom database column name.

**Type:** `string`

**Example:**

```typescript
publishDate: calendarDay({
  db: { map: 'publish_date' },
})
```

##### `db.isNullable`

Override nullability independent of `isRequired`.

**Type:** `boolean`

**Default:** Based on `validation.isRequired` (required fields are non-nullable)

**Example:**

```typescript
endDate: calendarDay({
  db: { isNullable: false },
})
```

#### Database column

A native Postgres `date` — the date only, with no time and no timezone.

**Generated contract module:**

```typescript
birthDate: field.column(dateStringColumn)
startDate: field.column(dateStringColumn).optional().default('2025-01-01')
```

#### TypeScript Type

A `YYYY-MM-DD` **string** in both directions, nullable if not required. Passing a `Date` is a compile error, deliberately: a `Date` carries a time and a timezone a calendar day does not have, and the conversion between them is where off-by-one bugs live.

```typescript
const person = await context.db.Person.where({ id }).first()

if (person) {
  const birthDate: string = person.birthDate
}
```

#### Validation

**Format:** ISO8601 date string (YYYY-MM-DD)

**Validation Rules:**

- Must match regex: `/^\d{4}-\d{2}-\d{2}$/`
- Examples: `'2025-01-15'`, `'2024-12-31'`, `'2023-07-04'`

**Error Messages:**

- Invalid format: "Field name must be in YYYY-MM-DD format"
- Required but missing: "Field name is required"

#### Use Cases

- Birth dates, anniversaries, or other personal dates
- Event dates (conferences, meetings, deadlines)
- Publication dates or scheduled dates
- Any date where the time component is not relevant

#### Comparison with `timestamp()`

| Feature             | `calendarDay()`     | `timestamp()`            |
| ------------------- | ------------------- | ------------------------ |
| **Time component**  | No (date only)      | Yes (date + time + zone) |
| **Database column** | `date`              | `timestamptz`            |
| **TypeScript type** | `YYYY-MM-DD` string | ISO 8601 string          |
| **Use case**        | Birth dates, events | Points in time           |
| **Storage size**    | Smaller (date only) | Larger (includes time)   |

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
  hooks?: FieldHooks<TTypeInfo>
})
```

#### Security Features

1. **Automatic Hashing**: Plaintext passwords are automatically hashed using bcrypt with cost factor 10
2. **Idempotent**: Already-hashed passwords are not re-hashed
3. **Secure Output**: Query results return `HashedPassword` instances with a `compare()` method
4. **No Exposure**: Only sends `{ isSet: boolean }` to client (not the hash)
5. **Excluded from default admin columns**: sets `ui.listView.defaultColumn: false` by default (a presentation default, not an access control — see [`ui.listView`](/docs/reference/config-api#ui)); override with `ui: { listView: { defaultColumn: true } }` to show it anyway

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

#### Database column

Postgres `text` (`field.text()`), holding the hash.

#### TypeScript Type

`string` for input, `HashedPassword` for output — declared with the field's `outputType`, since the column's own codec would type it as a plain `string`.

#### Usage Example

The write is hashed by the field's own `resolveInput`; the read is wrapped by its `resolveOutput`. Neither is something the caller arranges.

```typescript
await context.db.User.create({
  data: { email: 'user@example.com', password: 'plaintextPassword' },
})

const user = await context.db.User.where({ email: 'user@example.com' }).first()

if (user && (await user.password.compare('plaintextPassword'))) {
  // the password matches
}
```

`.first()` answers `null` both for a row that does not exist and for one this session cannot read, so the result is checked before `password` is touched.

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
  isIndexed?: boolean | 'unique'
  ui?: {
    displayMode?: 'select' | 'segmented-control' | 'radio'
    [key: string]: unknown
  }
  access?: FieldAccess
  hooks?: FieldHooks<TTypeInfo>
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
  options: [/* ... */],
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

##### `isIndexed`

Database index configuration.

**Type:** `boolean | 'unique'`

**Values:**

- `true` - Create non-unique index for faster queries
- `'unique'` - Create unique index (enforces uniqueness)
- `false` or omitted - No index

`isIndexed` is sugar for an unnamed single-column index or unique constraint. For a named constraint (e.g. adopting a live table's existing constraint name), or one spanning more than one field, use the list's [`db.indexes`](/docs/reference/config-api#dbindexes) instead — the two must not both target the same column. An index column carries no sort direction. Well-defined under both the default string column and a native-enum column (`db: { type: 'enum' }`).

**Example:**

```typescript
status: select({
  options: [/* ... */],
  isIndexed: true,
})
```

#### Database column

Postgres `text` by default. With `db: { type: 'enum' }`, a native Postgres enum type named `<List><Field>` (override with `db.enumName`) whose values must be valid identifiers.

#### TypeScript Type

Union of option values (e.g., `'draft' | 'published' | 'archived'`), declared through the field's `outputType`/`inputType` so it holds under either column type.

---

### `relationship()`

Foreign key relationship to another list.

```typescript
import { relationship } from '@opensaas/stack-core/fields'

relationship(options: {
  ref: string
  many?: boolean
  isIndexed?: boolean | 'unique'
  db?: {
    foreignKey?: boolean | { map?: string }
    isNullable?: boolean
    onDelete?: ReferentialAction
    onUpdate?: ReferentialAction
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

**Generated contract module:**

```typescript
accountId: field.uuidNative().optional().unique()
account: rel.belongsTo(() => models.Account, { from: 'accountId', to: 'id' })
```

`Account` gets the matching `rel.hasOne(() => models.User, { by: 'accountId' })` and no column of its own.

**Default behavior:** If `db.foreignKey` is not specified on either side, the foreign key is placed on the alphabetically first list. For example:

- `User ↔ Profile`: Profile stores `userId`
- `Account ↔ Billing`: Account stores `billingId`

{% callout type="info" %}
The `db.foreignKey` option is only needed for one-to-one relationships where you want explicit control over foreign key placement. One-to-many and many-to-one relationships automatically place the foreign key on the correct side.
{% /callout %}

{% callout type="warning" %}
Setting `db.foreignKey: true` on both sides of a one-to-one relationship will cause a validation error. Only one side can store the foreign key.
{% /callout %}

##### `db.isNullable`

Controls DB-level nullability of the foreign key column and its relation field, together — they can never disagree.

**Type:** `boolean`
**Default:** `true` (nullable, matching every relationship generated before this option existed)

**Constraints:**

- Only valid on the FK-owning (single) side of a relationship — the many side has no foreign key column of its own and rejects this option

**Example:**

Every session genuinely belongs to a user, so the foreign key is made required:

```typescript
Session: list({
  fields: {
    user: relationship({
      ref: 'User.sessions',
      db: { isNullable: false },
    }),
  },
})
```

**Generated contract module:**

```typescript
userId: field.uuidNative()
user: rel.belongsTo(() => models.User, { from: 'userId', to: 'id' })
```

##### `db.onDelete` / `db.onUpdate`

What the database does to this row when the referenced row is deleted, or when its id changes.

**Type:** `ReferentialAction`

```typescript
type ReferentialAction = 'cascade' | 'restrict' | 'noAction' | 'setNull' | 'setDefault'
```

**Constraints:**

- Only meaningful on the foreign-key-owning side — the many side owns no foreign key to act on
- `'setNull'` writes NULL into the foreign key column, so it describes a constraint Postgres cannot satisfy alongside `db: { isNullable: false }`

**Example:**

```typescript
Profile: list({
  fields: {
    user: relationship({
      ref: 'User.profile',
      db: { foreignKey: true, onDelete: 'cascade' },
    }),
  },
})
```

**Generated contract module:**

```typescript
constraints.foreignKey(cols.userId, model_User.refs.id, { index: false, onDelete: 'cascade' })
```

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

#### Database column

A `uuid` foreign key column on the owning side, plus a relation on both sides. The many side contributes no column.

#### TypeScript Type

**Arity decides what a read hands back, not foreign-key nullability**:

- `many: false` — the related row or `null`, once the read names it with `.include()`
- `many: true` — an array of related rows, empty when there are none

A relation is not on the row unless the read asked for it, and the arity above decides the face's nullability rather than the foreign key's — see [what an include costs](/docs/reference/context-api).

#### Write face

A relationship is written by connecting an id, on the foreign-key-owning side only:

```typescript
await context.db.Post.create({
  data: { title: 'Hello', author: { connect: { id: authorId } } },
})

await context.db.Post.update({
  where: { id: postId },
  data: { author: null },
})
```

`null` clears the edge — there is no `disconnect`, and nested `create`/`update`/`delete`/`connectOrCreate`/`set` are refused. Spelling one edge both ways (`author` and `authorId` in the same write) is an error. A `connect` target the caller cannot read makes the whole write return `null`, one indistinguishable answer. See [Queries](/docs/concepts/queries).

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
  hooks?: FieldHooks<TTypeInfo>
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
```

A write takes a JSON value; a read returns the parsed value, not a string.

```typescript
await context.db.Item.create({
  data: {
    metadata: {
      tags: ['tag1', 'tag2'],
      settings: { theme: 'dark', notifications: true },
    },
  },
})

const item = await context.db.Item.where({ id: itemId }).first()

if (item && typeof item.metadata === 'object' && item.metadata !== null) {
  // narrow the JSON value before reading into it
}
```

#### Database column

Postgres `jsonb` (`field.json()`).

#### TypeScript Type

A JSON value — object, array, string, number, boolean or `null`. It is deliberately not narrowed to your shape, so narrow it with a type guard or a schema at the point of use rather than asserting.

A required `json` field means non-null: an update may omit the key, but may not set it to `null`.

---

### `virtual()`

Computed field that is not stored in the database.

```typescript
import { virtual } from '@opensaas/stack-core/fields'

virtual(options: {
  type: TypeDescriptor
  needs?: string[]
  hooks: FieldHooks<TTypeInfo> & {
    resolveOutput: NonNullable<FieldHooks<TTypeInfo>['resolveOutput']>
  }
  ui?: {
    [key: string]: unknown
  }
  access?: FieldAccess
})
```

`type` is converted into the field's `outputType`; a virtual field has no column for the contract to type it from, so it is required. `resolveOutput` is required too — `virtual()` throws at config time without it.

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

##### `needs`

The columns and relations the computation reads. See [`needs`](#needs) under Field Builder Contract for the full rules; on a virtual field it is the ordinary way to widen the read.

**Type:** `string[]`

**Example:**

```typescript
byline: virtual({
  type: 'string',
  needs: ['title', 'author'],
  hooks: {
    resolveOutput: ({ item }) => `${item.title} by ${item.author?.name ?? 'unknown'}`,
  },
})
```

`opensaas generate` refuses an entry that names nothing on the list, names a computed field, or reaches through a relation with a dotted path — and refuses a `needs` on a field with no `resolveOutput` hook.

##### `hooks.resolveOutput` (required)

Compute the field value.

**Type:** Function

**Parameters:**

- `operation` - Always `'query'` for virtual fields
- `value` - Database value (always `undefined` for virtual fields)
- `item` - Exactly this field's declared dependency set plus the list's system fields. Reading a column the field did not declare in `needs` is a compile error
- `listKey` - The list name (e.g., `'User'`)
- `fieldName` - The field name (e.g., `'fullName'`)
- `context` - The access context

**Returns:** Computed value of the type specified in `type` option

**Example:**

```typescript
displayName: virtual({
  type: 'string',
  needs: ['name', 'email'],
  hooks: {
    resolveOutput: ({ item }) => `${item.name} (${item.email})`,
  },
})
```

##### `hooks.resolveInput` (optional)

Perform side effects during create/update operations. The return value is ignored — a virtual field stores nothing.

**Type:** Function (optional)

**Parameters:** the ordinary field `resolveInput` arguments — `{ listKey, fieldKey, operation, inputData, item, resolvedData, context }`. See [Hooks](/docs/concepts/hooks).

**Use cases:**

- Sync data to external API
- Trigger webhooks
- Update related records

**Example:**

```typescript
syncToExternal: virtual({
  type: 'boolean',
  hooks: {
    resolveInput: async ({ operation, item }) => {
      if (operation === 'update') {
        await syncToExternalAPI(item)
      }
      return undefined
    },
    resolveOutput: () => true,
  },
})
```

#### Key Characteristics

1. **No database storage**: a virtual field contributes no column — its contract descriptor is `kind: 'computed'`
2. **Computed wherever it is returned**: at the root of a read and at every nested level alike, not only when named
3. **Type safety**: the TypeScript face comes from `type`, which becomes the field's `outputType`
4. **Explicit dependencies**: `needs` is the only way the computation widens the read it runs inside

#### Usage Examples

##### Read-Only Computed Field

```typescript
User: list({
  fields: {
    firstName: text(),
    lastName: text(),
    fullName: virtual({
      type: 'string',
      needs: ['firstName', 'lastName'],
      hooks: {
        resolveOutput: ({ item }) => `${item.firstName} ${item.lastName}`,
      },
    }),
  },
})
```

Reading it back:

```typescript
const user = await context.db.User.where({ id }).first()

if (user) {
  console.log(user.fullName)
}
```

##### Computed From a Relation

```typescript
Order: list({
  fields: {
    lineItems: relationship({ ref: 'LineItem.order', many: true }),
    itemCount: virtual({
      type: 'number',
      needs: ['lineItems'],
      hooks: {
        resolveOutput: ({ item }) => item.lineItems.length,
      },
    }),
  },
})
```

`lineItems` is fetched because `itemCount` declared it, scoped by the Access Filter exactly as a caller-named include would be, and stripped from the result unless the caller named it too.

##### Write Side Effects

```typescript
Post: list({
  fields: {
    title: text(),
    content: text(),
    searchIndexSync: virtual({
      type: 'boolean',
      hooks: {
        resolveInput: async ({ operation, item }) => {
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

#### Database column

None — a virtual field creates no column.

#### TypeScript Type

The type given in `type`, which the builder converts into the field's `outputType`.

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

**See:** [Access Control guide](/docs/concepts/access-control) for details

---

### `hooks`

Field-level hooks for data transformation and side effects.

**Type:** `FieldHooks<TTypeInfo, TFieldKey>` — the field's slot is typed from the generated `Lists.<List>.TypeInfo`, so `item` and `resolvedData` are the real shapes for that list.

```typescript
type FieldHooks<TTypeInfo, TFieldKey> = {
  resolveInput?: (args: FieldResolveInputHookArgs<TTypeInfo, TFieldKey>) => ValueOrUndefined
  validate?: (args: FieldValidateHookArgs<TTypeInfo, TFieldKey>) => Promise<void> | void
  beforeOperation?: (
    args: FieldBeforeOperationHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void
  afterOperation?: (args: FieldAfterOperationHookArgs<TTypeInfo, TFieldKey>) => Promise<void> | void
  beforeTransaction?: (
    args: FieldBeforeTransactionHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void
  afterTransaction?: (
    args: FieldAfterTransactionHookArgs<TTypeInfo, TFieldKey>,
  ) => Promise<void> | void
  resolveOutput?: (args: FieldResolveOutputHookArgs<TTypeInfo, TFieldKey>) => ValueOrUndefined
}
```

Every write-side hook receives `{ listKey, fieldKey, operation, inputData, item, resolvedData, context }` — the field's own value is at `resolvedData[fieldKey]`, not a separate `inputValue` argument. `resolveOutput` receives `{ operation, value, item, listKey, fieldName, context }`. Execution order, the transaction-boundary pair, and what each argument holds per operation are in [Hooks](/docs/concepts/hooks).

#### Hook Types

##### `resolveInput`

Transform field value before database write.

**When called:** During `create` and `update` operations, after list-level `resolveInput`

**Use cases:** Hash passwords, normalize data, compute derived values

**Example:**

Deriving a slug from the title when the write did not supply one:

```typescript
slug: text({
  hooks: {
    resolveInput: ({ resolvedData, fieldKey }) => {
      const value = resolvedData[fieldKey]
      if (value) return value
      return resolvedData.title?.toLowerCase().replace(/\s+/g, '-')
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
    resolveOutput: ({ value }) => (value ? `https://cdn.example.com/${value}` : null),
  },
})
```

##### `beforeOperation`

Side effects before the database operation. Does NOT modify data.

**When called:** Before `create`, `update`, or `delete`, after validation, inside the write's transaction

**Use cases:** Logging, pre-operation checks

The argument is a union discriminated by `operation` — `create` carries no `item`, `delete` carries no `resolvedData` — so narrow before destructuring:

```typescript
status: select({
  options: [{ label: 'Draft', value: 'draft' }],
  hooks: {
    beforeOperation: async (args) => {
      if (args.operation !== 'update') return
      const { fieldKey, item, resolvedData } = args
      const next = resolvedData[fieldKey]
      if (item[fieldKey] !== next) {
        await auditLog.record({ event: 'status_change', from: item[fieldKey], to: next })
      }
    },
  },
})
```

##### `afterOperation`

Side effects after the database operation. Does NOT modify data.

**When called:** After `create`, `update` or `delete`, inside the write's transaction

**Use cases:** Cache invalidation, webhooks, cleanup

Also a union discriminated by `operation`: `create` carries no `originalItem`, `delete` carries no `item`. Cleaning up a replaced file by comparing the row before and after:

```typescript
thumbnail: text({
  hooks: {
    afterOperation: async (args) => {
      if (args.operation === 'delete') {
        await deleteFromCDN(args.originalItem[args.fieldKey])
        return
      }
      if (args.operation === 'update') {
        const previous = args.originalItem[args.fieldKey]
        if (previous && previous !== args.item[args.fieldKey]) {
          await deleteFromCDN(previous)
        }
      }
    },
  },
})
```

`beforeTransaction` and `afterTransaction` are the pair that run outside the write's transaction, for side effects that must not hold one open and cannot be rolled back with it.

**See:** [Hooks guide](/docs/concepts/hooks) for execution order and patterns

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

**See:** [Custom Fields guide](/docs/how-to/custom-fields) for creating custom components

---

### `defaultValue`

Default value when creating new items.

**Type:** Varies by field type

**Example:**

```typescript
status: select({
  options: [/* ... */],
  defaultValue: 'draft',
})

score: integer({ defaultValue: 0 })

isPublished: checkbox({ defaultValue: false })

createdAt: timestamp({ defaultValue: { kind: 'now' } })
```

---

## Field Builder Contract

Every field configuration object declares what the generators and validators delegate to it for. `opensaas generate` refuses a config where a field leaves out a member it owes, naming the list, the field and the member.

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

### `getContractField(fieldName, listKey, config)`

Describes what the field contributes to the generated contract (ADR-0040, ADR-0049): its stored column or columns, its relation and foreign key, or nothing at all.

**Signature:**

```typescript
getContractField(
  fieldName: string,
  listKey: string,
  config: OpenSaasConfig,
): ContractFieldDescriptor
```

**Parameters:**

- `fieldName` - The field's config key
- `listKey` - The owning list's key
- `config` - The full config (a relationship resolves its target and foreign-key ownership from it)

**Returns:** one of four descriptor shapes:

| `kind`       | For                                   | Carries                                  |
| ------------ | ------------------------------------- | ---------------------------------------- |
| `'column'`   | a stored field backed by one column   | the column descriptor, inline            |
| `'columns'`  | one field spanning several columns    | `columns: ContractColumnDescriptor[]`    |
| `'relation'` | a relationship                        | the relation and the foreign key it owns |
| `'computed'` | a virtual field, which stores nothing | nothing                                  |

A column descriptor carries `name`, a pack-qualified `type` (`{ pack, type, args? }`), `nullable`, and optionally `nativeType`, `map`, `unique`, `index`, `default` and `enum`.

**Example implementation:**

```typescript
getContractField: (fieldName) => ({
  kind: 'column',
  name: fieldName,
  type: { pack: 'pg', type: 'text' },
  nullable: !options?.validation?.isRequired,
})
```

---

### `outputType`

The field's TypeScript read face, when it differs from the type its contract column's codec already gives it (ADR-0052). Not a method — a value on the field config, a `TypeDescriptor`.

**Signature:**

```typescript
outputType?: TypeDescriptor
```

`TypeDescriptor` is itself `string | { value: SomeClass; from: 'pkg'; name?: 'Exported' }`. A type string is used as written; `import('pkg').Name` is inlined, so no separate import declaration is needed. The object form is normalised to the same thing.

**Required** on a virtual field and on a field whose descriptor is `kind: 'columns'`: neither has a single column to be typed from, so without it the field would type its consumers as `unknown`. `opensaas generate` refuses a config where one is missing, naming the list and field.

**Optional** on a single-column stored field, where it is an override of the codec's own type.

**Example:**

```typescript
outputType: "import('@opensaas/stack-storage').ImageMetadata | null"
```

---

### `inputType`

The field's TypeScript write face, when it differs from the read face — an `image()` accepts a `File` but reads back metadata.

**Signature:**

```typescript
inputType?: TypeDescriptor
```

`opensaas generate` never requires it. On a single-column field, absence means the column's own input type, which is correct for every field that reads and writes the same shape. A `kind: 'columns'` field has no single column for that to name, so declare `inputType` alongside `outputType` there.

---

### `needs`

The immediate columns and relations this field's `resolveOutput` hook cannot compute without.

**Signature:**

```typescript
needs?: string[]
```

Entries are **column keys** on the same list: stored columns and immediate relationship fields, spelled by their config key.

**The rules:**

- **Same list only.** No dotted paths, no reaching through a relation, and never a computed field. `opensaas generate` refuses an entry that names none of the above.
- **Requires a `resolveOutput` hook.** A `needs` on a field without one is dead config and is refused at generate time, since nothing could consume the declaration.
- **One hop, non-transitive.** A declared relation is fetched; what that relation's own computed fields need is that relation's business.
- **Private plumbing, not an implicit include.** Each dependency is fetched wherever the field is computed — at the root of a read and at every nested level alike — and then stripped from the result unless the caller named it too. Adding or removing one changes the field's implementation, never the shape of every read of the list.
- **Scoped like any other read.** A relation dependency goes through the Access Filter exactly as a caller-named include does. A session that cannot query it does not get it fetched, and the hook sees nothing in its place.

The generated `Lists.<List>.TypeInfo` narrows the `item` a `resolveOutput` receives to exactly the declared set plus the list's system fields, so reading an undeclared column is a compile error in a config annotated with it.

**Example:**

```typescript
lineItems: relationship({ ref: 'LineItem.order', many: true }),
itemCount: virtual({
  type: 'number',
  needs: ['lineItems'],
  hooks: {
    resolveOutput: ({ item }) => item.lineItems.length,
  },
}),
```

---

### Multi-column members

A field whose descriptor is `kind: 'columns'` owes three more members, because the engine cannot derive the mapping between one logical value and several physical columns:

| Member                            | Direction | Purpose                                                                   |
| --------------------------------- | --------- | ------------------------------------------------------------------------- |
| `getColumnNames(fieldName)`       | —         | The physical columns this field owns, so the read can strip the raw parts |
| `assembleColumns(fieldName, row)` | read      | Build the logical value from the row's per-part columns                   |
| `splitColumns(fieldName, value)`  | write     | Split the logical value back into per-part columns for the write payload  |

Both transforms must stay pure. `assembleColumns` runs before field visibility; `splitColumns` runs after `resolveInput`.

---

### `getVectorColumn(fieldName)`

The opt-in that makes a field reachable by `nearest()`: it describes the field's stored vector column, its dimensions, and the distance function a search measures with. A field that does not answer this is not searchable, which is what makes `nearest('title', …)` a refusal rather than a query the database rejects.

---

### `getFilterSpec(fieldName, listKey, config)`

Optional and additive: the field's filtering capability for the admin UI's filter builder. A field that omits it is simply not filterable and is never suggested — `password`, `json` and `virtual` all omit it. The returned `toCondition` mapper must stay pure; its output is ANDed with the access filter.

---

## Creating Custom Field Types

Custom field types must implement the `BaseFieldConfig` interface:

```typescript
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
} from '@opensaas/stack-core/extend'
import { z } from 'zod'

export type EmailField = BaseFieldConfig<TypeInfo> & {
  type: 'email'
  validation?: { isRequired?: boolean }
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

    getContractField: (fieldName): ContractFieldDescriptor => ({
      kind: 'column',
      name: fieldName,
      type: { pack: 'pg', type: 'text' },
      nullable: !options?.validation?.isRequired,
    }),
  }
}
```

**Key principles:**

1. Extend `BaseFieldConfig` with your field's options
2. Implement `getZodSchema` and `getContractField`; add `outputType` when the field has no single column to be typed from
3. Use field-level hooks for data transformation
4. Field types are self-contained (no switch statements in core)

**See:** [Custom Fields guide](/docs/how-to/custom-fields) for complete tutorial

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

**See:** [Tiptap package documentation](/docs/reference/tiptap)

---

### Image & File (`@opensaas/stack-storage`)

`storage` names a provider declared in the config's `storage` block, not a provider type.

```typescript
import { image, file } from '@opensaas/stack-storage/fields'

avatar: image({
  storage: 'images',
  validation: {
    maxFileSize: 5 * 1024 * 1024,
    acceptedMimeTypes: ['image/jpeg', 'image/png'],
  },
  transformations: {
    thumbnail: { width: 150, height: 150 },
    large: { width: 1200, height: 1200 },
  },
})

document: file({
  storage: 'documents',
  validation: {
    maxFileSize: 10 * 1024 * 1024,
    acceptedMimeTypes: ['application/pdf', 'text/plain'],
  },
})
```

Both write a `File` and read back metadata, so they declare their own `outputType` and `inputType`. In multi-column mode their descriptor is `kind: 'columns'` and they carry the three multi-column members above.

**See:** [Storage package documentation](/docs/reference/storage)

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

1. List-level and field-level `resolveInput` hooks
2. List-level and field-level `validate` hooks
3. Field-level Zod schema validation (from `getZodSchema()`)
4. Field-level access control (filter writable fields)

**See:** [Hooks](/docs/concepts/hooks) for the full order, including the transaction-boundary pair.

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
// ✅ Good: normalise in a field hook, where every write path goes through it
email: text({
  hooks: {
    resolveInput: ({ resolvedData, fieldKey }) => resolvedData[fieldKey]?.toLowerCase().trim(),
  },
})

// ❌ Bad: normalise at each call site, where one path will eventually forget
```

### 6. Declare What a Computed Field Reads

```typescript
// ✅ Good: the read fetches the dependency wherever the field is computed
itemCount: virtual({
  type: 'number',
  needs: ['lineItems'],
  hooks: { resolveOutput: ({ item }) => item.lineItems.length },
})

// ❌ Bad: works in the admin UI, returns nothing from a narrowed read
itemCount: virtual({
  type: 'number',
  hooks: { resolveOutput: ({ item }) => item.lineItems.length },
})
```

---

## Next Steps

- **[Field Types Guide](/docs/concepts/field-types)** - Usage examples and patterns
- **[Queries](/docs/concepts/queries)** - Reading and writing field values
- **[Hooks System](/docs/concepts/hooks)** - Field-level data transformation
- **[Access Control](/docs/concepts/access-control)** - Field-level security
- **[Custom Fields Guide](/docs/how-to/custom-fields)** - Create custom field types
- **[Config API](/docs/reference/config-api)** - Complete configuration reference
