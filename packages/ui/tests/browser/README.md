# Browser Tests

This directory contains UI tests that run in a real browser environment using Vitest Browser Mode with Playwright.

## Overview

Browser tests provide more realistic testing by running tests in actual browser environments (Chromium, Firefox, or WebKit). These tests can verify:

- Real browser interactions (clicks, keyboard input, focus management)
- Visual rendering and CSS behavior
- Accessibility features
- Browser-specific bugs

## Running Browser Tests

### Prerequisites

1. Install Playwright browsers:

   ```bash
   npx playwright install chromium
   ```

2. Ensure you have a display server available (for headless: false mode)

### Commands

```bash
# Run browser tests in headless mode
pnpm test:browser

# Run browser tests with UI
pnpm test:browser:ui
```

### Configuration

Browser tests are configured in `vitest.config.ts`:

- **Enabled**: Only when `BROWSER_TEST=true` environment variable is set
- **Browser**: Chromium (via Playwright)
- **Headless**: true (can be set to false for debugging)
- **Screenshot on failure**: Enabled

## Test Structure

Browser tests follow this structure:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from 'vitest/browser'
import { MyComponent } from '../../../src/components/MyComponent.js'

describe('MyComponent (Browser)', () => {
  it('should handle real browser interactions', async () => {
    render(<MyComponent />)

    const button = screen.getByRole('button')
    await userEvent.click(button)

    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})
```

## Test Categories

### Primitives

- **Button.browser.test.tsx**: Tests button variants, keyboard navigation, focus states
- **Dialog.browser.test.tsx**: Tests modal dialogs, focus trapping, keyboard shortcuts (Escape)

### Fields

- **TextField.browser.test.tsx**: Tests text input, paste, special characters, focus/blur
- **CheckboxField.browser.test.tsx**: Tests checkbox toggling, keyboard (Space), label clicks
- **SelectField.browser.test.tsx**: Tests dropdown behavior, keyboard navigation (arrows)

## Browser vs Regular Tests

| Aspect                | Regular Tests (Happy DOM) | Browser Tests  |
| --------------------- | ------------------------- | -------------- |
| **Speed**             | Fast (~500ms)             | Slower (~5s)   |
| **Environment**       | Simulated DOM             | Real browser   |
| **User Interactions** | Simulated                 | Real events    |
| **Visual Testing**    | No                        | Yes            |
| **CI/CD**             | Easy                      | Requires setup |

## When to Use Browser Tests

Use browser tests for:

- Complex user interactions (drag-drop, keyboard navigation)
- Focus management and accessibility
- Browser-specific features
- Visual regression testing
- Issues that only reproduce in real browsers

Use regular tests (Happy DOM) for:

- Unit testing components
- Testing props and state
- Fast feedback during development
- Most UI logic

## CI/CD Setup

For CI/CD environments, ensure:

1. **Display Server**: Use `xvfb` or run in headless mode
2. **Playwright Installation**: Include `npx playwright install --with-deps` in CI setup
3. **Browser Binaries**: Ensure chromium/firefox/webkit are available

Example GitHub Actions:

```yaml
- name: Install Playwright
  run: npx playwright install --with-deps chromium

- name: Run browser tests
  run: pnpm test:browser
```

## Troubleshooting

### "Browser connection was closed"

- **Cause**: No display server available
- **Solution**: Run in headless mode or use xvfb

### "vitest/browser can be imported only inside Browser Mode"

- **Cause**: Browser tests running in regular test mode
- **Solution**: Ensure tests are in `tests/browser/` directory and use `pnpm test:browser`

### Playwright installation errors

- **Cause**: Missing system dependencies
- **Solution**: Run `npx playwright install --with-deps chromium`

## Development Tips

1. **Debugging**: Set `headless: false` in vitest.config.ts to see the browser
2. **Screenshots**: Failed tests automatically capture screenshots
3. **Slow Tests**: Use `{ timeout: 10000 }` for tests that need more time
4. **Browser DevTools**: Set `slowMo: 100` to slow down interactions for debugging

## Future Enhancements

- [ ] Add visual regression testing with screenshots
- [ ] Test in multiple browsers (Firefox, WebKit)
- [ ] Add E2E tests for complete user flows
- [ ] Integrate with Percy or similar visual testing service
