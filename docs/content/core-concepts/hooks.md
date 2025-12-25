# Hooks System

The hooks system provides data transformation and side effects during database operations.

## Overview

Hooks allow you to:

- Transform data before it's saved to the database
- Transform data before it's returned to the user
- Perform validation beyond basic field rules
- Trigger side effects (logging, notifications, etc.)

## Hook Types

### List-Level Hooks

Defined at the list level, these hooks run for all operations on the list:

```typescript
Post: list({
  fields: {
    /* ... */
  },
  hooks: {
    resolveInput: async ({ resolvedData, operation, context }) => {
      // Transform input data before database operation
      if (operation === 'create' && resolvedData.status === 'published') {
        resolvedData.publishedAt = new Date()
      }
      return resolvedData
    },
    validateInput: async ({ operation, resolvedData, addValidationError }) => {
      if (operation === 'delete') return
      // Custom validation logic
      if (resolvedData.title?.includes('spam')) {
        addValidationError('Title cannot contain spam')
      }
    },
    beforeOperation: async ({ operation, resolvedData, context }) => {
      // Side effects before database operation
      console.log(`About to ${operation} a post`)
    },
    afterOperation: async ({ operation, item, originalItem, context }) => {
      // Side effects after database operation
      if (operation === 'create') {
        // Send notification, invalidate cache, etc.
      }
      if (operation === 'update' && originalItem) {
        // Compare previous and new values
        console.log('Changed from:', originalItem, 'to:', item)
      }
    },
  },
})
```

### Field-Level Hooks

Defined on individual fields:

```typescript
fields: {
  password: password({
    hooks: {
      resolveInput: async ({ resolvedData, fieldKey }) => {
        // Hash password before saving
        const plaintext = resolvedData[fieldKey]
        if (plaintext) {
          return await bcrypt.hash(plaintext, 10)
        }
      },
      resolveOutput: async ({ item, fieldKey }) => {
        // Wrap with HashedPassword class
        return new HashedPassword(item[fieldKey])
      },
    },
  }),
}
```

## Hook Execution Order

### Write Operations (create/update)

1. **List-level `resolveInput`** - Transform input data at list level
2. **Field-level `resolveInput`** - Transform individual field values
3. **List-level `validateInput`** - Custom validation logic
4. **Field validation** - Built-in rules (isRequired, length, min/max)
5. **Field-level access control** - Filter writable fields
6. **Field-level `beforeOperation`** - Side effects for individual fields
7. **List-level `beforeOperation`** - Side effects at list level
8. **Database operation**
9. **List-level `afterOperation`** - Side effects at list level
10. **Field-level `afterOperation`** - Side effects for individual fields

### Read Operations (query)

1. **Database operation**
2. **Field-level access control** - Filter readable fields
3. **Field-level `resolveOutput`** - Transform individual field values
4. **Field-level `afterOperation`** - Side effects for individual fields

## Hook Context

All hooks receive a context object with relevant information:

```typescript
interface HookContext {
  operation: 'create' | 'update' | 'delete' | 'query'
  session: Session | null
  context: Context
  listKey: string
  resolvedData?: any // For input hooks
  item?: any // Current item (after operation)
  originalItem?: any // Original item before operation (for update/delete)
  originalInput?: any // Original input before transformations
}
```

## Common Use Cases

### Auto-Set Timestamps

```typescript
resolveInput: async ({ resolvedData, operation }) => {
  if (operation === 'create') {
    resolvedData.createdAt = new Date()
  }
  if (operation === 'update') {
    resolvedData.updatedAt = new Date()
  }
  return resolvedData
}
```

### Slug Generation

```typescript
fields: {
  slug: text({
    hooks: {
      resolveInput: async ({ resolvedData, item, operation }) => {
        // Generate slug from title if not provided
        if (!resolvedData.slug && resolvedData.title) {
          return resolvedData.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        }
      },
    },
  }),
}
```

### Password Hashing

```typescript
password: password({
  hooks: {
    resolveInput: async ({ resolvedData, fieldKey }) => {
      const plaintext = resolvedData[fieldKey]
      if (plaintext) {
        return await bcrypt.hash(plaintext, 10)
      }
    },
  },
})
```

### Cache Invalidation

```typescript
afterOperation: async ({ operation, item, originalItem, context }) => {
  if (['create', 'update', 'delete'].includes(operation)) {
    // Invalidate cache
    await redis.del(`post:${item.id}`)

    // For updates, you can compare previous and new values
    if (operation === 'update' && originalItem) {
      if (originalItem.status !== item.status) {
        console.log(`Status changed from ${originalItem.status} to ${item.status}`)
      }
    }
  }
}
```

### Audit Logging

```typescript
beforeOperation: async ({ operation, resolvedData, context }) => {
  await context.db.auditLog.create({
    data: {
      operation,
      userId: context.session?.userId,
      timestamp: new Date(),
      data: resolvedData,
    },
  })
}
```

## Best Practices

### 1. Keep Hooks Pure

Avoid side effects in `resolveInput` and `resolveOutput`. Use `beforeOperation` and `afterOperation` for side effects:

```typescript
// ✅ Good: Pure transformation
resolveInput: ({ resolvedData }) => {
  resolvedData.title = resolvedData.title.trim()
  return resolvedData
}

// ❌ Bad: Side effects in resolveInput
resolveInput: async ({ resolvedData, context }) => {
  await sendEmail() // Don't do this here!
  return resolvedData
}
```

### 2. Use Async When Needed

All hooks can be async:

```typescript
resolveInput: async ({ resolvedData }) => {
  const result = await someAsyncOperation()
  resolvedData.field = result
  return resolvedData
}
```

### 3. Return Modified Data

Always return the modified data from `resolveInput`:

```typescript
// ✅ Good: Returns modified data
resolveInput: ({ resolvedData }) => {
  resolvedData.slug = generateSlug(resolvedData.title)
  return resolvedData
}

// ❌ Bad: Doesn't return
resolveInput: ({ resolvedData }) => {
  resolvedData.slug = generateSlug(resolvedData.title)
  // Missing return!
}
```

## Next Steps

- **[Access Control](/docs/core-concepts/access-control)** - Secure your data
- **[Field Types](/docs/core-concepts/field-types)** - Available field types
- **[Custom Fields](/docs/guides/custom-fields)** - Create custom field types
