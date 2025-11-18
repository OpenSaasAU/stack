# End-to-End (E2E) Tests

This directory contains comprehensive end-to-end tests for OpenSaaS Stack examples using [Playwright](https://playwright.dev/).

## Overview

The E2E test suite validates:

- ✅ **Build process** - Ensures examples build successfully
- ✅ **Authentication flows** - Sign up, sign in, password reset
- ✅ **Access control** - Operation-level and field-level access rules
- ✅ **CRUD operations** - Create, read, update, delete functionality
- ✅ **Admin UI** - Forms, tables, navigation, and user interactions
- ✅ **Data validation** - Client-side and server-side validation
- ✅ **Session management** - Session persistence and authentication state

## Test Structure

```
e2e/
├── starter-auth/          # Tests for starter-auth example
│   ├── 00-build.spec.ts   # Build validation
│   ├── 01-auth.spec.ts    # Authentication tests
│   ├── 02-posts-access-control.spec.ts  # CRUD and access control
│   └── 03-admin-ui.spec.ts  # Admin UI functionality
├── utils/
│   ├── auth.ts            # Authentication helpers
│   └── db.ts              # Database setup/cleanup utilities
├── global-setup.ts        # Run before all tests
├── global-teardown.ts     # Run after all tests
└── README.md              # This file
```

## Running Tests

### Prerequisites

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Install Playwright browsers (first time only):
   ```bash
   pnpm exec playwright install
   ```

### Run All Tests

```bash
pnpm test:e2e
```

### Run Tests with UI Mode (Recommended for Development)

UI mode provides a visual interface to explore, run, and debug tests:

```bash
pnpm test:e2e:ui
```

### Run Tests in Headed Mode

See the browser while tests run:

```bash
pnpm test:e2e:headed
```

### Debug Tests

Run tests in debug mode with Playwright Inspector:

```bash
pnpm test:e2e:debug
```

### Run Specific Test File

```bash
pnpm exec playwright test e2e/starter-auth/01-auth.spec.ts
```

### Run Specific Test

```bash
pnpm exec playwright test -g "should successfully sign up a new user"
```

### Generate Test Code (Codegen)

Playwright can record your interactions and generate test code:

```bash
pnpm test:e2e:codegen
```

## Test Coverage

### starter-auth Example

#### Build Validation (`00-build.spec.ts`)

- ✅ Project builds successfully without errors
- ✅ Schema and types generate correctly
- ✅ No TypeScript compilation errors
- ✅ Required dependencies are installed
- ✅ Environment configuration is valid
- ✅ Configuration files are valid

#### Authentication (`01-auth.spec.ts`)

**Sign Up:**
- ✅ Successful user registration
- ✅ Email validation (invalid email format)
- ✅ Password validation (minimum length)
- ✅ Duplicate email prevention

**Sign In:**
- ✅ Successful login with correct credentials
- ✅ Error handling for incorrect password
- ✅ Error handling for non-existent user

**Password Reset:**
- ✅ Password reset page displays correctly
- ✅ Email submission for reset link

**Session Management:**
- ✅ Session persists across page reloads
- ✅ Session persists across navigation

#### CRUD and Access Control (`02-posts-access-control.spec.ts`)

**Unauthenticated Access:**
- ✅ Prevents post creation without authentication
- ✅ Shows only published posts to public users

**Post Creation:**
- ✅ Authenticated users can create posts
- ✅ Required field validation
- ✅ Custom validation (title cannot contain "spam")
- ✅ Unique slug constraint enforcement
- ✅ Auto-set publishedAt on status change

**Update Access Control:**
- ✅ Authors can update their own posts
- ✅ Non-authors cannot update others' posts

**Delete Access Control:**
- ✅ Authors can delete their own posts

**Field-level Access Control:**
- ✅ Only authors can read internalNotes field

#### Admin UI (`03-admin-ui.spec.ts`)

**Navigation and Layout:**
- ✅ Admin UI accessible at /admin
- ✅ Navigation between different lists (Post, User)

**List Table View:**
- ✅ Empty state display
- ✅ Posts appear in table after creation
- ✅ Multiple columns displayed correctly

**Create Form:**
- ✅ All fields render correctly
- ✅ Field labels are visible
- ✅ Proper field types (text, textarea, select)

**Edit Form:**
- ✅ Form populates with existing data
- ✅ Changes save successfully

**Form Validation UI:**
- ✅ Inline validation errors display
- ✅ Errors clear when corrected

**Relationships:**
- ✅ Author relationship field displays

**Auto-generated Lists:**
- ✅ User list displays (from authPlugin)
- ✅ User fields render in table

## How It Works

### Global Setup

Before tests run, `global-setup.ts`:
1. Creates `.env` file if it doesn't exist
2. Sets up test database
3. Generates Prisma schema and types

### Global Teardown

After tests complete, `global-teardown.ts`:
1. Cleans up test database

### Web Server

Playwright automatically starts the Next.js dev server before running tests and stops it afterward (configured in `playwright.config.ts`).

### Test Isolation

Each test file uses:
- Fresh browser context (isolated cookies/storage)
- Database state from global setup
- Independent authentication (signs up new users as needed)

## Writing New Tests

### Authentication Helper

Use the authentication utilities for common auth operations:

```typescript
import { signUp, signIn, testUser } from '../utils/auth.js'

test('my test', async ({ page }) => {
  // Sign up a new user
  await signUp(page, testUser)

  // Or sign in an existing user
  await signIn(page, testUser)
})
```

### Database Utilities

For tests that need database setup/cleanup:

```typescript
import { setupDatabase, cleanupDatabase } from '../utils/db.js'

test.beforeAll(() => {
  setupDatabase('examples/starter-auth')
})

test.afterAll(() => {
  cleanupDatabase('examples/starter-auth')
})
```

### Best Practices

1. **Use Descriptive Test Names**: Make it clear what's being tested
   ```typescript
   test('should show validation error for invalid email', async ({ page }) => {
     // ...
   })
   ```

2. **Wait for Navigation**: Use `waitForURL()` after actions that trigger navigation
   ```typescript
   await page.click('button[type="submit"]')
   await page.waitForURL('/', { timeout: 10000 })
   ```

3. **Wait for Network Idle**: Use `waitForLoadState('networkidle')` when data is loading
   ```typescript
   await page.goto('/admin/post')
   await page.waitForLoadState('networkidle')
   ```

4. **Use Expect Assertions**: Always verify expected outcomes
   ```typescript
   await expect(page.locator('text=My Post')).toBeVisible()
   ```

5. **Handle Async Visibility Checks**: Use try-catch for optional elements
   ```typescript
   const hasButton = await page.locator('button').isVisible({ timeout: 2000 })
   if (hasButton) {
     await page.click('button')
   }
   ```

## Debugging Failed Tests

### View Test Report

After a test run, view the HTML report:

```bash
pnpm exec playwright show-report
```

### Screenshots

Failed tests automatically capture screenshots in `test-results/`.

### Traces

Failed tests capture execution traces. View them:

```bash
pnpm exec playwright show-trace test-results/.../trace.zip
```

### Run Single Test in Debug Mode

```bash
pnpm exec playwright test --debug -g "test name"
```

## CI/CD Integration

For CI environments, tests are configured to:
- Use GitHub Actions reporter
- Retry failed tests twice
- Run with a single worker (no parallelization)
- Not reuse existing dev servers

Set `CI=true` environment variable to enable CI mode.

## Adding Tests for New Examples

To add E2E tests for a new example:

1. Create a new directory under `e2e/`:
   ```bash
   mkdir e2e/my-example
   ```

2. Create test files:
   ```bash
   touch e2e/my-example/01-feature.spec.ts
   ```

3. Update `global-setup.ts` to set up your example's database

4. Update `playwright.config.ts` webServer command if needed

5. Write tests following the patterns in `starter-auth/`

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Selectors](https://playwright.dev/docs/selectors)
- [Playwright Assertions](https://playwright.dev/docs/test-assertions)
