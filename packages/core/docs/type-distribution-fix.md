# Password Field Type Distribution Fix

## Problem

All fields in returned objects were being typed as `string | HashedPassword` instead of only the password field being typed as `HashedPassword`.

### Example of the Bug

```typescript
const users = await context.db.user.findMany()
// Before fix:
// users: { name: string | HashedPassword, email: string | HashedPassword, password: string | HashedPassword, ... }
//
// Expected:
// users: { name: string, email: string, password: HashedPassword, ... }
```

## Root Cause

The issue was in how TypeScript's **distributive conditional types** work with union types.

### The Problem Code

In `packages/core/src/access/types.ts`, the `TransformObject` type was delegating to a `TransformField` helper:

```typescript
type TransformObject<TConfig, TListKey, TObj> = {
  [K in keyof TObj]: K extends keyof TConfig['lists'][TListKey]['fields']
    ? TransformField<TConfig['lists'][TListKey]['fields'][K], TObj[K]>
    //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                This is a UNION of all field config types!
    : TObj[K]
}
```

When TypeScript evaluated `TConfig['lists'][TListKey]['fields'][K]`, it couldn't narrow the type precisely, resulting in:

```typescript
TextField | IntegerField | CheckboxField | TimestampField | PasswordField | ...
```

This union type then **distributed** over the conditional type in `TransformField`:

```typescript
type TransformField<TFieldConfig, TOriginal> =
  TFieldConfig extends { type: infer TType }
    ? 'password' extends TType  // Distributes over the union!
      ? HashedPassword
      : TOriginal
    : TOriginal

// Becomes:
// TransformField<TextField, string> | TransformField<PasswordField, string> | ...
// = TOriginal | HashedPassword | ...
// = string | HashedPassword
```

## Solution

**Remove the `TransformField` helper and inline the logic directly in `TransformObject`.**

This allows TypeScript to narrow the field config type **before** applying the conditional type, preventing distribution.

### The Fix

```typescript
type TransformObject<TConfig, TListKey, TObj> =
  TObj extends Record<string, any>
    ? {
        [K in keyof TObj]: K extends keyof TConfig['lists'][TListKey]['fields']
          ? TConfig['lists'][TListKey]['fields'][K] extends { type: 'relationship', ref: infer TRef }
            ? /* relationship logic */
            : // Inline password check - NO helper function
              TConfig['lists'][TListKey]['fields'][K] extends { type: 'password' }
              ? TObj[K] extends string
                ? HashedPassword
                : TObj[K]
              : TObj[K]  // Not password, preserve original type
          : TransformIncludedRelationship<TConfig, K, TObj[K]>
      }
    : TObj
```

### Why This Works

By inlining the logic, TypeScript can:

1. **First narrow** `TConfig['lists'][TListKey]['fields'][K]` to the specific field type (e.g., `TextField`)
2. **Then check** if it extends `{ type: 'password' }`
3. **Return** the appropriate type without creating a union

The check `TConfig['lists'][TListKey]['fields'][K] extends { type: 'password' }` evaluates to:
- `TextField extends { type: 'password' }` → `false` → return `TObj[K]` (preserve original)
- `PasswordField extends { type: 'password' }` → `true` → return `HashedPassword`

No distribution occurs because we're not using a separate type alias that receives the union.

## Verification

### Tests

Created `tests/password-type-distribution.test.ts` with 3 tests:
1. Verifies non-password fields remain `string`
2. Verifies password field becomes `HashedPassword`
3. Verifies TypeScript narrowing works correctly

All 191 tests pass ✅

### Type Checks

```typescript
const users = await context.db.user.findMany()
const user = users[0]

// These now compile correctly:
const name: string = user.name           // ✅ string
const email: string = user.email         // ✅ string
const password: HashedPassword = user.password  // ✅ HashedPassword
await password.compare('test')           // ✅ Has compare method
```

## Files Changed

- `packages/core/src/access/types.ts`:
  - Modified `TransformObject` type (lines 125-160) to inline password transformation logic
  - Removed `TransformField` helper type (was lines 175-189)
- `packages/core/tests/password-type-distribution.test.ts`:
  - New test file with 3 tests verifying the fix

## Lessons Learned

1. **Distributive conditional types** in TypeScript can cause unexpected union types
2. **Helper type aliases** can prevent proper type narrowing
3. **Inlining type logic** allows TypeScript to narrow types before applying conditionals
4. **Test both runtime and compile-time behavior** when working with TypeScript transformations
