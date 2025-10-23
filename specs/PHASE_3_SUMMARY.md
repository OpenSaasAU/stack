# Phase 3: Hooks System - Complete! ✅

## What Was Built

The complete hooks system has been implemented, matching KeystoneJS patterns and providing powerful data lifecycle management.

## Features Implemented

### 1. Hooks Execution Engine (`packages/core/src/hooks/`)

**New Module**: Complete hooks infrastructure with:

- `executeResolveInput()` - Modify data before validation
- `executeValidateInput()` - Custom validation with error collection
- `executeBeforeOperation()` - Side effects before DB operations
- `executeAfterOperation()` - Side effects after DB operations
- `validateFieldRules()` - Built-in field validation
- `ValidationError` class - Custom error type for validation failures

### 2. Hook Types Available

```typescript
hooks: {
  resolveInput?: (args) => Promise<Partial<T>>
  validateInput?: (args) => Promise<void>
  beforeOperation?: (args) => Promise<void>
  afterOperation?: (args) => Promise<void>
}
```

### 3. Execution Order (Per Spec)

For **Create/Update** operations:

1. Access control check (operation-level)
2. `resolveInput` hook - Transform input data
3. `validateInput` hook - Custom validation
4. Field validation (isRequired, length, min/max)
5. Access control check (field-level)
6. `beforeOperation` hook - Side effects before DB
7. Database operation
8. `afterOperation` hook - Side effects after DB
9. Return result

For **Delete** operations:

1. Access control check (operation-level)
2. `beforeOperation` hook
3. Database operation
4. `afterOperation` hook
5. Return result

### 4. Built-in Field Validation

Automatic validation for:

- `isRequired` - Field must be present (only on create, or if field is in update data)
- Text field `length.min` and `length.max`
- Integer field `validation.min` and `validation.max`

**Smart Validation**: On update operations, only validates fields that are actually being updated (avoids false "required" errors).

### 5. Integration Points

**Updated Context Operations**:

- `createCreate()` - Full hooks integration
- `createUpdate()` - Full hooks integration
- `createDelete()` - beforeOperation and afterOperation only

**Exports**:

- Exported `ValidationError` from `@opensaas/framework-core`
- All hook functions available internally

## Example Usage

### Auto-Set Timestamp When Publishing

```typescript
hooks: {
  resolveInput: async ({ operation, resolvedData, item }) => {
    // Auto-set publishedAt when status changes to published
    if (resolvedData.status === 'published' && (!item?.publishedAt || operation === 'create')) {
      return {
        ...resolvedData,
        publishedAt: new Date(),
      }
    }
    return resolvedData
  }
}
```

### Custom Validation

```typescript
hooks: {
  validateInput: async ({ resolvedData, addValidationError }) => {
    if (resolvedData.title?.toLowerCase().includes('spam')) {
      addValidationError('Title cannot contain the word "spam"')
    }

    if (resolvedData.content?.length < 10) {
      addValidationError('Content must be at least 10 characters')
    }
  }
}
```

### Side Effects (Logging, Notifications, etc.)

```typescript
hooks: {
  beforeOperation: async ({ operation, item }) => {
    console.log(`About to ${operation}:`, item?.id);
    // Could send notifications, update cache, etc.
  },

  afterOperation: async ({ operation, item }) => {
    console.log(`Successfully ${operation}d:`, item.id);
    // Could trigger webhooks, update search index, etc.
  }
}
```

## Test Results

**All 9 hooks tests passing! ✅**

1. ✅ resolveInput - Auto-set publishedAt on publish
2. ✅ resolveInput - Preserve publishedAt on subsequent updates
3. ✅ validateInput - Reject spam content
4. ✅ Built-in validation - Required fields on create
5. ✅ beforeOperation - Side effects before DB
6. ✅ afterOperation - Side effects after DB
7. ✅ Update operation hooks work correctly
8. ✅ Delete operation hooks work correctly
9. ✅ Publish workflow (draft → published) with auto-timestamp

**All 12 access control tests still passing! ✅**

No regressions - all existing functionality continues to work.

## Files Created/Modified

### New Files

- `packages/core/src/hooks/index.ts` - Complete hooks execution engine
- `examples/blog/test-hooks.ts` - Comprehensive hooks test suite

### Modified Files

- `packages/core/src/context/index.ts` - Integrated hooks into all operations
- `packages/core/src/index.ts` - Exported ValidationError
- `examples/blog/opensaas.config.ts` - Added hooks examples to Post model
- `CHANGELOG.md` - Documented Phase 3 completion

## Key Implementation Details

### 1. ValidationError Class

```typescript
class ValidationError extends Error {
  public errors: string[]

  constructor(errors: string[]) {
    super(`Validation failed: ${errors.join(', ')}`)
    this.errors = errors
  }
}
```

Users can catch and handle validation errors:

```typescript
try {
  await context.db.post.create({ data })
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:', error.errors)
  }
}
```

### 2. Field Validation Intelligence

The `validateFieldRules()` function is smart about update operations:

```typescript
// For create: all required fields must be present
// For update: only validate fields that are being updated
const shouldValidate = operation === 'create' || (operation === 'update' && fieldName in data)
```

This prevents false validation errors like "slug is required" when updating just the title.

### 3. Hook Execution is Async

All hooks support async/await, allowing:

- Database queries
- External API calls
- File system operations
- Any asynchronous side effects

### 4. Error Handling

- Validation errors are collected and thrown together
- Hook execution errors bubble up naturally
- Access control still happens before hooks (security first)

## Performance Considerations

- Hooks only run if defined (no overhead for unused hooks)
- Validation is lightweight (simple field checks)
- Async execution allows parallel operations when possible
- No N+1 issues - each operation executes hooks once

## What's Working

✅ Complete hooks lifecycle
✅ resolveInput for data transformation
✅ validateInput for custom validation
✅ beforeOperation for side effects
✅ afterOperation for side effects
✅ Built-in field validation
✅ Context-aware validation (create vs update)
✅ Error collection and reporting
✅ Full integration with access control
✅ All tests passing (21 total: 12 access control + 9 hooks)

## What's Not Implemented (Future)

- Hook timeout/cancellation
- Hook dependency ordering
- Conditional hook execution
- Hook composition/chaining
- Async hook event emitters
- Database transaction support

## Next Steps

**Phase 3 is complete!** The framework now has:

1. ✅ **Phase 1** - Core foundation (config, fields, generators)
2. ✅ **Phase 2** - Access control engine (operation + field level)
3. ✅ **Phase 3** - Hooks system (complete lifecycle)
4. ⏭️ **Phase 4** - CLI tooling (init, migrate commands)
5. ⏭️ **Phase 5** - Admin UI (React components)
6. ⏭️ **Phase 6** - Better-auth integration

## Migration Guide

If you have existing OpenSaaS code, no changes are required! Hooks are:

- **Optional** - Only run if defined in config
- **Backward compatible** - Existing configs work without hooks
- **Non-breaking** - All existing functionality preserved

To add hooks to your lists:

```typescript
Post: list({
  fields: {
    /* ... */
  },
  access: {
    /* ... */
  },
  hooks: {
    // Add this section
    resolveInput: async ({ resolvedData }) => {
      // Transform data
      return resolvedData
    },
  },
})
```

## Success Criteria Met

- ✅ All hook types implemented
- ✅ Proper execution order
- ✅ Error handling and validation
- ✅ Integration with access control
- ✅ Comprehensive test coverage
- ✅ Real-world examples
- ✅ Documentation updated
- ✅ No regressions

**Phase 3: COMPLETE** 🎉
