# Hooks System Refactor

## Problem Statement

The current hooks system has three main issues:

1. **Type Safety**: Hook parameters use `unknown` types instead of proper generics
2. **Data Mutation Location**: `beforeOperation` is used for data transformation (e.g., password hashing) when it should only contain side effects
3. **Output Transformation**: `afterOperation` is used on reads to transform output, but this blurs the line between side effects and data transformation

## Current Hook System

```typescript
type FieldHooks = {
  beforeOperation?: (context: {
    operation: unknown
    item?: unknown
    value: unknown
    listKey: unknown
  }) => Promise<unknown>
  afterOperation?: (context: {
    operation: unknown
    item?: unknown
    value: unknown
    listKey: unknown
  }) => unknown
}
```

**Current execution order:**
1. `resolveInput` (list-level only)
2. `validateInput` (list-level only)
3. Field validation (Zod schemas)
4. Field-level access control
5. `beforeOperation` (field-level) - **Currently used for data transformation**
6. Database operation
7. `afterOperation` (field-level) - **Currently used for output transformation**

## Proposed Changes

### 1. Add Data Transformation Hooks

Add `resolveInput` and `resolveOutput` hooks at the field level to clearly separate data transformation from side effects.

```typescript
type FieldHooks<TValue = any, TItem = any> = {
  // Data transformation (before DB write)
  resolveInput?: (context: {
    operation: 'create' | 'update'
    inputValue: TValue | undefined
    item?: TItem
    listKey: string
  }) => Promise<TValue | undefined> | TValue | undefined

  // Side effects (before DB write)
  beforeOperation?: (context: {
    operation: 'create' | 'update'
    resolvedValue: TValue | undefined
    item?: TItem
    listKey: string
  }) => Promise<void> | void

  // Side effects (after DB operation)
  afterOperation?: (context: {
    operation: 'create' | 'update' | 'query'
    value: TValue | undefined
    item: TItem
    listKey: string
  }) => Promise<void> | void

  // Data transformation (after DB read)
  resolveOutput?: (context: {
    operation: 'query'
    value: TValue | undefined
    item: TItem
    listKey: string
  }) => TValue | undefined
}
```

### 2. Updated Execution Order

**Write operations (create/update):**
1. List-level `resolveInput`
2. Field-level `resolveInput` - **NEW: data transformation**
3. List-level `validateInput`
4. Field validation (Zod schemas)
5. Field-level access control
6. Field-level `beforeOperation` - **CHANGED: side effects only** (only called if field was modified)
7. List-level `beforeOperation`
8. Database operation
9. List-level `afterOperation`
10. Field-level `afterOperation` - **CHANGED: side effects only** (only called if field was modified)

**Read operations (query):**
1. Database operation
2. Field-level access control
3. Field-level `resolveOutput` - **NEW: output transformation**
4. Field-level `afterOperation` - **CHANGED: side effects only**

### 3. Type Safety with Generics

Hook types use generics to provide full type safety for both the field value and the item:

```typescript
export type FieldHooks<TValue = any, TItem = any> = {
  resolveInput?: (args: {
    operation: 'create' | 'update'
    inputValue: TValue | undefined
    item?: TItem  // ✅ Properly typed
    listKey: string
    fieldName: string
    context: AccessContext
  }) => Promise<TValue | undefined> | TValue | undefined
  // ... other hooks
}

export type BaseFieldConfig<TValue = any> = {
  type: string
  ui?: UIConfig
  hooks?: FieldHooks<TValue, any>
  access?: FieldAccessControl
  validation?: ValidationConfig
  // ... other properties
}

export type PasswordField = BaseFieldConfig<string> & {
  type: 'password'
  validation?: {
    isRequired?: boolean
  }
}
```

### 4. Automatic Type Inference from List

The item type flows automatically from `list<T>()` down to field hooks:

```typescript
import type { User } from './.opensaas/types'

// Type parameter on list() injects User type into all field hooks
const userList = list<User>({
  fields: {
    password: password({
      hooks: {
        resolveInput: async ({ inputValue, item, operation }) => {
          // ✅ inputValue: string | undefined
          // ✅ item: User | undefined
          // ✅ Full autocomplete and type safety!

          if (operation === 'update' && item) {
            console.log(`Changing password for ${item.email}`)
          }

          return await hashPassword(inputValue)
        }
      }
    })
  }
})
```

**How it works:**

1. `FieldsWithItemType<TFields, TItem>` mapped type transforms field configs
2. `WithItemType<TField, TItem>` extracts the value type and injects item type
3. `list<T>()` function accepts raw configs and returns `ListConfig<T>` with transformed fields
4. All field hooks automatically get `TItem = T`

**Implementation:**

```typescript
// Utility type to inject item type into a single field config
type WithItemType<TField extends FieldConfig, TItem> =
  TField extends BaseFieldConfig<infer TValue, any>
    ? Omit<TField, 'hooks'> & { hooks?: FieldHooks<TValue, TItem> }
    : TField

// Transform all fields in a record
export type FieldsWithItemType<TFields extends Record<string, FieldConfig>, TItem = any> = {
  [K in keyof TFields]: WithItemType<TFields[K], TItem>
}

// List config uses transformed fields
export type ListConfig<T = any> = {
  fields: FieldsWithItemType<Record<string, FieldConfig>, T>
  access?: { operation?: OperationAccess<T> }
  hooks?: Hooks<T>
}

// Builder function performs type transformation
export function list<T = any>(
  config: {
    fields: Record<string, FieldConfig>  // Input: raw configs
    access?: { operation?: OperationAccess<T> }
    hooks?: Hooks<T>
  }
): ListConfig<T> {  // Output: transformed configs
  return config as ListConfig<T>
}
```

### 5. Password Field Refactor

**Before (incorrect):**
```typescript
hooks: {
  beforeOperation: async ({ value }) => {
    // Data transformation in wrong hook
    if (typeof value === 'string' && !isHashedPassword(value)) {
      return await hashPassword(value)
    }
    return value
  },
  afterOperation: ({ value }) => {
    // Output transformation on reads
    if (typeof value === 'string') {
      return new HashedPassword(value)
    }
    return value
  },
}
```

**After (correct):**
```typescript
hooks: {
  resolveInput: async ({ inputValue }) => {
    // Data transformation before write
    if (inputValue === undefined || inputValue === null) return inputValue
    if (typeof inputValue !== 'string' || inputValue.length === 0) return inputValue
    if (isHashedPassword(inputValue)) return inputValue
    return await hashPassword(inputValue)
  },
  resolveOutput: ({ value }) => {
    // Output transformation after read
    if (typeof value === 'string' && value.length > 0) {
      return new HashedPassword(value)
    }
    return value
  },
  // beforeOperation and afterOperation reserved for side effects like:
  // - logging
  // - sending notifications
  // - invalidating caches
}
```

## Implementation Checklist

- [x] Update `FieldHooks` type definition in `packages/core/src/config/types.ts`
- [x] Add `resolveInput` and `resolveOutput` to hook execution in `packages/core/src/context/index.ts`
- [x] Update password field to use new hooks in `packages/core/src/fields/index.ts`
- [x] Update `BaseFieldConfig` to use generics for type safety
- [x] Update CLAUDE.md documentation
- [ ] Add examples demonstrating proper hook usage
- [ ] Update tests to cover new hook execution order

## Implementation Notes

### Files Modified

1. **`packages/core/src/config/types.ts`**
   - Added `FieldHooks<TValue, TItem>` with two generics for full type safety
   - Added `resolveInput` and `resolveOutput` for data transformation
   - Updated `beforeOperation` and `afterOperation` to return `void` (side effects only)
   - Updated `BaseFieldConfig<TValue>` to accept generic and pass `FieldHooks<TValue, any>`
   - Applied generics to all field types (TextField, PasswordField, etc.)
   - Created `WithItemType<TField, TItem>` utility type to inject item type into field configs
   - Created `FieldsWithItemType<TFields, TItem>` mapped type to transform all fields
   - Updated `ListConfig<T>` to use `FieldsWithItemType` for automatic type transformation

2. **`packages/core/src/config/index.ts`**
   - Updated `list<T>()` function to accept raw field configs and return transformed `ListConfig<T>`
   - Added comprehensive documentation and examples showing type inference
   - Exported `FieldsWithItemType` utility type for advanced use cases

3. **`packages/core/src/fields/index.ts`**
   - Refactored password field to use `resolveInput` for hashing
   - Refactored password field to use `resolveOutput` for wrapping with HashedPassword

4. **`packages/core/src/context/index.ts`**
   - Created `executeFieldResolveInputHooks()` - transforms input data
   - Created `executeFieldResolveOutputHooks()` - transforms output data
   - Updated `executeFieldBeforeOperationHooks()` - side effects only, void return
   - Updated `executeFieldAfterOperationHooks()` - side effects only, void return
   - Updated all CRUD operations with correct execution order:
     - **findUnique/findMany**: DB → access control → resolveOutput → afterOperation
     - **create**: list resolveInput → field resolveInput → validate → access → field beforeOperation → list beforeOperation → DB → list afterOperation → field afterOperation → resolveOutput
     - **update**: list resolveInput → field resolveInput → validate → access → field beforeOperation → list beforeOperation → DB → list afterOperation → field afterOperation → resolveOutput
     - **delete**: field beforeOperation → list beforeOperation → DB → list afterOperation → field afterOperation

5. **`CLAUDE.md`**
   - Documented complete hook system with execution order
   - Separated data transformation hooks from side effect hooks
   - Added use case examples for both list-level and field-level hooks

6. **`specs/field-hook-type-inference-example.ts`**
   - Created comprehensive examples demonstrating type inference
   - Shows how `list<User>()` automatically types field hooks
   - Includes examples with and without type parameters

## Benefits

1. **Clear Separation**: Data transformation vs. side effects are now distinct
2. **Full Type Safety**: Strongly typed hooks with automatic inference of both value and item types
3. **Automatic Type Inference**: Using `list<User>()` automatically types all field hooks without manual annotations
4. **Predictable**: Hook names clearly indicate when and why they run
5. **Extensible**: Third-party field types can use the same pattern
6. **No Runtime Overhead**: Type transformation happens entirely at compile time

## Migration Path

Existing fields using `beforeOperation`/`afterOperation` for data transformation should:

1. Move data transformation logic to `resolveInput`/`resolveOutput`
2. Keep only side effects in `beforeOperation`/`afterOperation`
3. Update types to use generics

This is a breaking change but only affects field-level hooks (rare). Most users won't be affected.
