# Changelog

All notable changes to the OpenSaaS Framework will be documented in this file.

## [Unreleased]

### Added

- **Phase 3 - Hooks System**: Complete hooks implementation matching KeystoneJS patterns ✅
  - `resolveInput` - Modify input data before validation (e.g., auto-set timestamps)
  - `validateInput` - Custom validation with error collection
  - `beforeOperation` - Side effects before database operations
  - `afterOperation` - Side effects after database operations
  - All hooks integrated into create, update, and delete operations
  - New `ValidationError` class for collecting and throwing validation errors
  - Built-in field validation for `isRequired`, length constraints, min/max values
  - Field validation context-aware: only validates fields being updated in update operations
  - Example use case: Auto-set `publishedAt` when status changes to "published"
  - Comprehensive test suite (9 tests) demonstrating all hook types

### Fixed

- **Field-Level Access Control**: Fixed critical bug where filter-based access control functions were not properly evaluated for field-level access
  - `checkFieldAccess()` now correctly evaluates filter objects returned by access control functions
  - Added `matchesFilter()` helper to check if an item matches a Prisma-like filter
  - Previously, returning a filter like `{ authorId: { equals: session.userId } }` would always grant access
  - Now properly checks if the item's fields match the filter conditions
  - **Security Impact**: This bug allowed users to see fields they shouldn't have access to
  - Example: Alice could see Bob's `internalNotes` even though the field had `access: { read: isAuthor }`
  - All 12 tests now passing ✅

### Changed

- **BREAKING**: Removed `PrismaClient` import from `@opensaas/core` to avoid circular dependency issues
  - `getContext()` now uses a generic type parameter: `getContext<TPrisma extends PrismaClientLike>()`
  - This allows the core package to be built before Prisma schema is generated
  - Users should explicitly pass the `PrismaClient` type when calling `getContext()`
  - Example:
    ```typescript
    import { PrismaClient } from '@prisma/client'
    import { getContext } from '@opensaas/core'
    
    const prisma = new PrismaClient()
    const context = await getContext<PrismaClient>(config, prisma, session)
    ```

- **Generator CLI**: Fixed tsx loader path to work with project-local tsx installations
  - Now correctly loads tsx from `node_modules/tsx/dist/cjs/index.cjs`
  - Better error messages when tsx is not installed

- **Prisma Generator**: Fixed optional field detection for timestamp fields
  - Timestamp fields without `defaultValue` or `isRequired` validation are now correctly marked as optional
  - Previously all timestamp fields were treated as required

## [0.1.0] - 2025-01-14

### Added

- Initial prototype release (Phase 1-2)
- Core configuration system with declarative schema definition
- 7 field types: text, integer, checkbox, timestamp, password, select, relationship
- Access control engine with operation-level and field-level access
- Prisma schema generator from config
- TypeScript type generator from config
- Context creation with access-controlled database wrapper
- Generator CLI script
- Blog example with comprehensive test suite
- Silent failures on access denial (returns null/[])
- Filter-based access control (return Prisma where clauses)
- Field-level access filtering
- Monorepo structure with pnpm workspaces

### Features Demonstrated

- ✅ Declarative schema definition
- ✅ Automatic code generation (Prisma + TypeScript)
- ✅ Operation-level access control
- ✅ Filter-based access control
- ✅ Field-level access control
- ✅ Silent failures for security
- ✅ Type-safe operations
- ✅ Working example with tests

### Not Yet Implemented

- Hooks system (resolveInput, validateInput, etc.)
- CLI tooling (init, migrate commands)
- Admin UI
- Authentication integration plugins
- File upload handling
- More field types (JSON, rich text, etc.)
