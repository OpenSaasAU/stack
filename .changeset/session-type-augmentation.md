---
'@opensaas/stack-core': minor
'@opensaas/stack-auth': minor
---

Add strongly-typed session support via module augmentation

This change enables developers to define custom session types with full TypeScript autocomplete and type safety throughout their OpenSaas applications using the module augmentation pattern.

**Core Changes:**

- Converted `Session` from `type` to `interface` to enable module augmentation
- Updated all session references to properly handle `Session | null`
- Added comprehensive JSDoc documentation with module augmentation examples
- Updated `AccessControl`, `AccessContext`, and access control engine to support nullable sessions
- Added "Session Typing" section to core package documentation

**Auth Package:**

- Added "Session Type Safety" section to documentation
- Documented how Better Auth users can create session type declarations
- Provided step-by-step guide for matching sessionFields to TypeScript types
- Created `getSession()` helper pattern for transforming Better Auth sessions

**Developer Experience:**

Developers can now augment the `Session` interface to get autocomplete everywhere:

```typescript
// types/session.d.ts
import '@opensaas/stack-core'

declare module '@opensaas/stack-core' {
  interface Session {
    userId?: string
    email?: string
    role?: 'admin' | 'user'
  }
}
```

This provides autocomplete in:
- Access control functions
- Hooks (resolveInput, validateInput, etc.)
- Context object
- Server actions

**Benefits:**

- Zero boilerplate - module augmentation provides types everywhere automatically
- Full type safety for session properties
- Autocomplete in all contexts that use session
- Developer controls session shape (no assumptions about structure)
- Works with any auth provider (Better Auth, custom, etc.)
- Fully backward compatible - existing code continues to work
- Follows TypeScript best practices (similar to NextAuth.js pattern)

**Example:**

```typescript
// Before: No autocomplete
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin'  // ❌ 'role' is 'unknown'
}

// After: Full autocomplete and type checking
const isAdmin: AccessControl = ({ session }) => {
  return session?.role === 'admin'  // ✅ Autocomplete + type checking
  //             ↑ Shows: userId, email, role
}
```

**Migration:**

No migration required - this is a fully backward compatible change. Existing projects continue to work with untyped sessions. Projects can opt-in to typed sessions by creating a `types/session.d.ts` file with module augmentation.
