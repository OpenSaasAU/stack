# E2E Testing Implementation Summary

## Overview

A comprehensive end-to-end testing suite has been implemented for OpenSaaS Stack using Playwright. The test suite validates builds, authentication, access control, CRUD operations, and admin UI functionality.

## What Was Created

### 1. Testing Infrastructure

#### Root Level Files
- `playwright.config.ts` - Main Playwright configuration
- `e2e/` - Test directory structure
- `.gitignore` - Updated to exclude test artifacts

#### Test Utilities
- `e2e/utils/auth.ts` - Authentication helper functions (signUp, signIn, etc.)
- `e2e/utils/db.ts` - Database setup and cleanup utilities
- `e2e/global-setup.ts` - Pre-test environment setup
- `e2e/global-teardown.ts` - Post-test cleanup

#### Documentation
- `e2e/README.md` - Comprehensive testing guide
- `E2E_TESTING_SUMMARY.md` - This summary document

### 2. Test Suites for starter-auth Example

#### `e2e/starter-auth/00-build.spec.ts` - Build Validation
Tests that ensure the example builds correctly:
- ✅ Project builds without errors
- ✅ Schema and types generate successfully
- ✅ No TypeScript compilation errors
- ✅ Required dependencies are installed
- ✅ Valid environment configuration
- ✅ Valid Next.js and OpenSaaS configuration

#### `e2e/starter-auth/01-auth.spec.ts` - Authentication
Comprehensive authentication flow testing:

**Sign Up Tests:**
- Successful user registration
- Email validation (invalid format)
- Password validation (minimum 8 characters)
- Duplicate email prevention

**Sign In Tests:**
- Successful login with correct credentials
- Error handling for incorrect password
- Error handling for non-existent user

**Password Reset Tests:**
- Password reset page display
- Email submission for reset link

**Session Management:**
- Session persistence across page reloads
- Session persistence across navigation

#### `e2e/starter-auth/02-posts-access-control.spec.ts` - CRUD & Access Control
Tests validating the core access control system:

**Unauthenticated Access:**
- Prevents post creation without authentication
- Shows only published posts to public users

**Post Creation (CRUD):**
- Authenticated users can create posts
- Required field validation
- Custom validation (spam detection in title)
- Unique slug constraint enforcement
- Auto-set publishedAt timestamp on status change

**Update Access Control:**
- Authors can update their own posts
- Non-authors cannot update others' posts

**Delete Access Control:**
- Authors can delete their own posts

**Field-level Access Control:**
- Only authors can read the internalNotes field
- Non-authors cannot see private fields

#### `e2e/starter-auth/03-admin-ui.spec.ts` - Admin UI
Tests for the admin interface functionality:

**Navigation:**
- Admin UI accessible at /admin
- Navigation between lists (Post, User)

**List Table View:**
- Empty state display
- Posts appear after creation
- Multiple columns render correctly

**Create Form:**
- All fields render (text, textarea, select)
- Field labels display correctly
- Proper field types and options

**Edit Form:**
- Form populates with existing data
- Changes save successfully

**Form Validation UI:**
- Inline validation errors display
- Errors clear when fields are corrected

**Auto-generated Lists:**
- User list displays (from authPlugin)
- User fields render in table

### 3. Package.json Scripts

Added npm scripts to root `package.json`:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:headed": "playwright test --headed",
  "test:e2e:debug": "playwright test --debug",
  "test:e2e:codegen": "playwright codegen http://localhost:3000"
}
```

## How to Run Tests

### Quick Start

```bash
# 1. Install dependencies (if not already done)
pnpm install

# 2. Install Playwright browsers (first time only)
pnpm exec playwright install

# 3. Build required packages
pnpm --filter @opensaas/stack-core build
pnpm --filter @opensaas/stack-auth build
pnpm --filter @opensaas/stack-ui build
pnpm --filter @opensaas/stack-cli build

# 4. Run all E2E tests
pnpm test:e2e
```

### Development Workflow

```bash
# Run tests with UI (recommended for development)
pnpm test:e2e:ui

# Run tests in headed mode (see browser)
pnpm test:e2e:headed

# Debug specific test
pnpm test:e2e:debug

# Generate test code by recording interactions
pnpm test:e2e:codegen
```

### Run Specific Tests

```bash
# Run only authentication tests
pnpm exec playwright test e2e/starter-auth/01-auth.spec.ts

# Run a specific test by name
pnpm exec playwright test -g "should successfully sign up"

# Run only build validation
pnpm exec playwright test e2e/starter-auth/00-build.spec.ts
```

## Test Architecture

### Global Setup Flow

1. **Before Tests** (`global-setup.ts`):
   - Creates `.env` file from `.env.example` if needed
   - Sets test environment variables
   - Runs database setup (generate schema, db push)

2. **Test Execution**:
   - Playwright starts Next.js dev server automatically
   - Each test file runs with fresh browser context
   - Tests share database state from global setup

3. **After Tests** (`global-teardown.ts`):
   - Cleans up test database
   - Playwright stops dev server

### Test Utilities

**Authentication Helpers** (`e2e/utils/auth.ts`):
```typescript
import { signUp, signIn, testUser } from '../utils/auth.js'

// Sign up a new user
await signUp(page, testUser)

// Sign in existing user
await signIn(page, { email: 'user@example.com', password: 'pass123' })
```

**Database Utilities** (`e2e/utils/db.ts`):
```typescript
import { setupDatabase, cleanupDatabase } from '../utils/db.js'

// Setup fresh database
setupDatabase('examples/starter-auth')

// Clean up after tests
cleanupDatabase('examples/starter-auth')
```

## Test Coverage Summary

### Total Tests: ~40 test cases

#### By Category:
- **Build Validation**: 7 tests
- **Authentication**: 13 tests
- **CRUD & Access Control**: 10 tests
- **Admin UI**: 15 tests

#### Coverage Areas:
- ✅ Project builds and TypeScript compilation
- ✅ Schema generation and database setup
- ✅ User registration and sign-in flows
- ✅ Password validation and reset
- ✅ Session management and persistence
- ✅ Operation-level access control (query, create, update, delete)
- ✅ Field-level access control (read, create, update)
- ✅ CRUD operations (Create, Read, Update, Delete)
- ✅ Data validation (required fields, custom validators, constraints)
- ✅ Hooks (resolveInput, validateInput)
- ✅ Admin UI rendering and navigation
- ✅ Form functionality (create, edit, validation)
- ✅ Table views and data display
- ✅ Auto-generated lists from plugins

## CI/CD Integration

E2E tests are fully integrated into GitHub Actions with two workflows:

### 1. Main Test Workflow (`.github/workflows/test.yml`)

Runs on all pull requests to `main`:
- Executes E2E tests as part of the main test suite
- Runs alongside unit tests, linting, and formatting checks
- Uploads test reports and artifacts on failure

### 2. Dedicated E2E Workflow (`.github/workflows/e2e.yml`)

Provides more control over E2E test execution:

**Triggers:**
- Pull requests that modify E2E-related files
- Manual trigger via GitHub Actions UI
- Nightly schedule (2 AM UTC daily)

**Features:**
- 30-minute timeout for long-running tests
- Comprehensive artifact uploads (reports, screenshots, traces)
- Automatic PR comments with test results
- Extended artifact retention (30 days)

**Manual Trigger:**
Go to Actions → E2E Tests → Run workflow

### GitHub Actions Configuration

When `CI=true` is set, Playwright will:
- ✅ Use GitHub Actions reporter for better CI output
- ✅ Retry failed tests twice automatically
- ✅ Run with single worker (no parallelization)
- ✅ Not reuse existing dev servers
- ✅ Upload screenshots and traces on failure

### Artifacts Uploaded

On test completion:
- **playwright-report/** - HTML test report
- **test-results/** - Raw test results

On test failure:
- **playwright-screenshots/** - Screenshots of failures
- **playwright-traces/** - Execution traces for debugging

### Viewing Test Results

1. **In GitHub Actions**: Navigate to the Actions tab, select the workflow run
2. **Download artifacts**: Click on uploaded artifacts to download
3. **View traces**: Download trace files and view at [trace.playwright.dev](https://trace.playwright.dev)

## Next Steps

### Adding Tests for Other Examples

To add E2E tests for additional examples (e.g., `blog`, `composable-dashboard`):

1. Create test directory:
   ```bash
   mkdir -p e2e/blog
   ```

2. Copy and adapt test files:
   ```bash
   cp e2e/starter-auth/*.spec.ts e2e/blog/
   ```

3. Update `global-setup.ts` to handle the new example

4. Update `playwright.config.ts` webServer command if needed

### Extending Test Coverage

Consider adding tests for:
- OAuth authentication flows
- File upload functionality
- Rich text editor (Tiptap)
- Search and filtering
- Pagination
- Relationship fields (complex scenarios)
- Custom field types
- Plugin-specific features (RAG, MCP)

### Performance Testing

Playwright can also be used for performance testing:
- Measure page load times
- Track API response times
- Monitor bundle sizes
- Validate Core Web Vitals

## Troubleshooting

### Tests Fail to Start

**Issue**: Dev server doesn't start
**Solution**: Ensure packages are built:
```bash
pnpm build
```

**Issue**: Database errors
**Solution**: Clean and regenerate:
```bash
cd examples/starter-auth
rm -f dev.db dev.db-journal
pnpm generate
pnpm db:push
```

### Tests Fail Intermittently

**Issue**: Timing issues
**Solution**: Increase timeouts in specific tests:
```typescript
test('slow test', async ({ page }) => {
  test.setTimeout(60000) // 60 seconds
  // ... test code
})
```

**Issue**: Network delays
**Solution**: Use `waitForLoadState('networkidle')`:
```typescript
await page.goto('/admin/post')
await page.waitForLoadState('networkidle')
```

### Debugging Failed Tests

1. **View HTML Report**:
   ```bash
   pnpm exec playwright show-report
   ```

2. **View Traces**:
   ```bash
   pnpm exec playwright show-trace test-results/.../trace.zip
   ```

3. **Run in Debug Mode**:
   ```bash
   pnpm exec playwright test --debug -g "failing test name"
   ```

4. **Screenshots**: Failed tests automatically save screenshots to `test-results/`

## Resources

- [E2E Testing Guide](./e2e/README.md) - Detailed testing documentation
- [Playwright Documentation](https://playwright.dev/) - Official Playwright docs
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [OpenSaaS Stack Docs](https://stack.opensaas.au/) - Stack documentation

## Files Changed

### New Files Created
- `playwright.config.ts`
- `e2e/utils/auth.ts`
- `e2e/utils/db.ts`
- `e2e/global-setup.ts`
- `e2e/global-teardown.ts`
- `e2e/starter-auth/00-build.spec.ts`
- `e2e/starter-auth/01-auth.spec.ts`
- `e2e/starter-auth/02-posts-access-control.spec.ts`
- `e2e/starter-auth/03-admin-ui.spec.ts`
- `e2e/README.md`
- `E2E_TESTING_SUMMARY.md`

### Files Modified
- `package.json` - Added E2E test scripts
- `.gitignore` - Added Playwright artifacts

### Dependencies Added
- `@playwright/test`
- `playwright`

## Conclusion

The E2E test suite provides comprehensive coverage of the OpenSaaS Stack's core features:
- **Authentication** - Complete user flows
- **Authorization** - Access control at all levels
- **CRUD Operations** - Full data lifecycle
- **Admin UI** - User interface validation
- **Build Process** - Ensures examples work correctly

This foundation enables:
- ✅ Confident refactoring and feature development
- ✅ Regression prevention
- ✅ Documentation through tests (living examples)
- ✅ CI/CD integration
- ✅ Quality assurance before releases

The test suite can be easily extended to cover additional examples and features as the stack evolves.
