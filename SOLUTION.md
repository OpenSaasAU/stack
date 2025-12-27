# Solution: Virtual Fields in Prisma Select Types (Issue #305)

## Summary

This solution adds full type-safety support for virtual fields in Prisma select types and GetPayload helpers. Users can now select virtual fields in type-safe queries and get properly typed results.

## Changes Made

### 1. Added `{ListName}GetPayload<T>` Helper Type

**File**: `packages/cli/src/generator/types.ts`

Generated a new `GetPayload` helper type for each list that:
- Extends Prisma's `GetPayload` type
- Conditionally includes virtual fields based on selection
- Handles `select` and `include` modes correctly
- Only includes selected virtual fields (not all virtual fields)

**Example Generated Type**:

```typescript
export type UserGetPayload<T extends { select?: any; include?: any } = {}> =
  Omit<Prisma.UserGetPayload<T>, 'password'> &
  UserTransformedFields &
  (
    T extends { select: any }
      ? T['select'] extends true
        ? UserVirtualFields
        : {
            [K in keyof UserVirtualFields as K extends keyof T['select']
              ? T['select'][K] extends true
                ? K
                : never
              : never]: UserVirtualFields[K]
          }
      : T extends { include: any }
        ? T['include'] extends true
          ? UserVirtualFields
          : {
              [K in keyof UserVirtualFields as K extends keyof T['include']
                ? T['include'][K] extends true
                  ? K
                  : never
                : never]: UserVirtualFields[K]
            }
        : UserVirtualFields
  )
```

### 2. Enhanced Type Generation Pipeline

**File**: `packages/cli/src/generator/types.ts`

Added `generateGetPayloadType()` function that:
- Checks if list has virtual or transformed fields
- Generates conditional type logic for selective field inclusion
- Includes comprehensive JSDoc documentation
- Skips generation if no virtual/transformed fields exist

### 3. Added Comprehensive Tests

**File**: `packages/cli/src/generator/types.test.ts`

Added two new test cases:
- `should generate Select and GetPayload types with virtual fields`
- `should generate Include type with virtual fields for models with relationships`

Both tests verify:
- `{ListName}VirtualFields` type is generated
- `{ListName}Select` extends `Prisma.{ListName}Select` with virtual fields
- `{ListName}GetPayload` helper type is generated
- Snapshots capture the complete generated output

## Usage

### Before (Issue #305)

```typescript
import { Prisma } from '@/.opensaas/prisma-client/client'

const studentDetailSelect = {
  id: true,
  firstName: true,
  age: true, // ❌ TS Error: 'age' does not exist in type 'StudentSelect'
} satisfies Prisma.StudentSelect

type StudentDetail = Prisma.StudentGetPayload<{
  select: typeof studentDetailSelect
}>
// ❌ StudentDetail doesn't include 'age' even if type error is ignored
```

### After (Solution)

```typescript
import { StudentSelect, StudentGetPayload } from '@/.opensaas/types'

const studentDetailSelect = {
  id: true,
  firstName: true,
  age: true, // ✅ Virtual field - TypeScript knows about this!
} satisfies StudentSelect

type StudentDetail = StudentGetPayload<{
  select: typeof studentDetailSelect
}>
// ✅ StudentDetail includes: { id: string, firstName: string, age: number }
```

### Selective Virtual Fields

```typescript
// Only include virtual fields when selected
const basicSelect = {
  id: true,
  firstName: true,
  // age NOT selected
} satisfies StudentSelect

type BasicStudent = StudentGetPayload<{
  select: typeof basicSelect
}>
// ✅ BasicStudent includes: { id: string, firstName: string }
// age is NOT included because it wasn't selected
```

### With Context.db

```typescript
const student = await context.db.student.findUnique({
  where: { id: '1' },
  select: studentDetailSelect,
})

if (student) {
  console.log(student.id)        // ✅ Typed
  console.log(student.firstName) // ✅ Typed
  console.log(student.age)       // ✅ Typed - virtual field!
}
```

## Key Features

1. **Type-Safe Selection**: Virtual fields are included in `{ListName}Select` types
2. **Conditional Inclusion**: Only selected virtual fields appear in result types
3. **Select & Include Support**: Works with both `select` and `include` modes
4. **Transformed Fields**: Also handles fields with `resultExtension` transformations
5. **Full Documentation**: Generated types include comprehensive JSDoc comments
6. **Backward Compatible**: Doesn't break existing code

## Architecture

The solution leverages TypeScript's conditional types to:

1. Detect if `T` has a `select` or `include` property
2. Check if each virtual field is selected (`T['select'][K] extends true`)
3. Use mapped types to include only selected virtual fields
4. Merge with Prisma's base `GetPayload` type

This creates a type that mirrors runtime behavior exactly - virtual fields only appear when they're selected.

## Testing

Run tests with:

```bash
cd packages/cli
pnpm test
```

The test suite includes:
- Unit tests for `generateGetPayloadType()`
- Integration tests with full config examples
- Snapshot tests for generated output
- Tests for both virtual and transformed fields

## Files Changed

1. `packages/cli/src/generator/types.ts` - Added `generateGetPayloadType()` function
2. `packages/cli/src/generator/types.test.ts` - Added virtual field tests
3. `packages/cli/src/generator/__snapshots__/types.test.ts.snap` - Generated snapshots

## Migration Guide

No migration needed! This is a pure type enhancement. Existing code continues to work, and users can adopt the new types incrementally:

1. Replace `Prisma.{ListName}Select` with `{ListName}Select` from `.opensaas/types`
2. Replace `Prisma.{ListName}GetPayload<T>` with `{ListName}GetPayload<T>` from `.opensaas/types`
3. Regenerate types with `pnpm generate`

## Future Enhancements

Potential future improvements:
- Generate `{ListName}Args` types that wrap all Prisma args with virtual field support
- Module augmentation to extend `Prisma` namespace directly (optional)
- Documentation examples in official docs
