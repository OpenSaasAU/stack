---
'@opensaas/stack-core': minor
---

Update hooks API to comply with Keystone hooks specification

The hooks system now fully complies with Keystone's hooks API specification. Hook arguments have been updated to include additional context and follow consistent naming conventions.

**List-level hooks now receive:**

- `listKey` - The name of the list being operated on
- `inputData` - The original data passed to the operation (before transformations)
- `resolvedData` - The data after transformations
- `validate` hook replaces `validateInput` (backward compatible via alias)

**Field-level hooks now receive:**

- `listKey` - The name of the list
- `fieldKey` - The name of the field (replaces `fieldName` in most hooks)
- `inputData` - The original input data
- `resolvedData` - The transformed data
- All hooks now support `validate` hook for field-level validation

**Migration for existing hooks:**

```typescript
// Before - List-level resolveInput
resolveInput: async ({ resolvedData, item }) => {
  return { ...resolvedData, updatedAt: new Date() }
}

// After - List-level resolveInput
resolveInput: async ({ listKey, operation, inputData, resolvedData, item, context }) => {
  return { ...resolvedData, updatedAt: new Date() }
}

// Before - Field-level resolveInput
resolveInput: async ({ inputValue, operation, item }) => {
  return hashPassword(inputValue)
}

// After - Field-level resolveInput
resolveInput: async ({ listKey, fieldKey, operation, inputData, item, resolvedData, context }) => {
  const fieldValue = resolvedData[fieldKey]
  return hashPassword(fieldValue)
}

// Before - validateInput
validateInput: async ({ resolvedData, addValidationError }) => {
  if (resolvedData.title?.includes('spam')) {
    addValidationError('Title cannot contain spam')
  }
}

// After - validate (validateInput still works as alias)
validate: async ({
  listKey,
  operation,
  inputData,
  resolvedData,
  item,
  context,
  addValidationError,
}) => {
  if (resolvedData.title?.includes('spam')) {
    addValidationError('Title cannot contain spam')
  }
}
```

**Key changes:**

1. All hooks now receive `listKey` and `context` parameters
2. Write operation hooks receive both `inputData` (original) and `resolvedData` (transformed)
3. `afterOperation` hooks receive `originalItem` for comparing before/after state
4. Field hooks use `fieldKey` parameter and access values via `resolvedData[fieldKey]`
5. The `validate` hook is now the standard name (replaces `validateInput`, which remains as deprecated alias)

See the updated CLAUDE.md documentation for complete hook argument specifications.
