---
'@opensaas/stack-core': minor
---

Add `db.isNullable` and `db.nativeType` support to all field types

All field types now support two new `db` configuration options that were previously only available in Keystone 6:

### `db.isNullable`

Controls DB-level nullability independently of `validation.isRequired`. This allows you to:
- Make a field non-nullable at the DB level without making it API-required
- Explicitly mark a field as nullable regardless of other settings

```typescript
fields: {
  // DB non-nullable, but API optional (relies on a default value or hook)
  phoneNumber: text({
    db: { isNullable: false }
    // Generates: phoneNumber String (non-nullable)
  }),

  // DB nullable, explicitly set
  lastMessagePreview: text({
    db: { isNullable: true }
    // Generates: lastMessagePreview String? (nullable)
  }),

  // DB non-nullable without API validation (field must always be set via hooks or defaults)
  internalCode: integer({
    db: { isNullable: false }
    // Generates: internalCode Int (non-nullable)
  })
}
```

### `db.nativeType`

Overrides the native database column type. Generates a `@db.<nativeType>` attribute in the Prisma schema. Available types depend on your database provider.

```typescript
fields: {
  // PostgreSQL: use TEXT instead of VARCHAR for long content
  medical: text({
    db: { isNullable: true, nativeType: 'Text' }
    // Generates: medical String? @db.Text
  }),

  // PostgreSQL: use SMALLINT for small numbers
  score: integer({
    db: { nativeType: 'SmallInt' }
    // Generates: score Int? @db.SmallInt
  }),

  // PostgreSQL: use TIMESTAMPTZ for timezone-aware timestamps
  scheduledAt: timestamp({
    db: { nativeType: 'Timestamptz' }
    // Generates: scheduledAt DateTime? @db.Timestamptz
  })
}
```

Both options are supported on `text`, `integer`, `password`, `json`, `timestamp`, `checkbox` (isNullable only), `decimal`, and `calendarDay` fields.
