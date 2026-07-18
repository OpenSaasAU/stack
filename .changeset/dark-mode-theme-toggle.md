---
'@opensaas/stack-ui': minor
---

Add user-controllable dark mode: `ThemeToggle` and `ThemeScript`

The admin chrome now ships a light/dark/system color-scheme control built on the
`light-dark()` token contract. A `data-theme` attribute on the document root pins
`color-scheme` (overriding the OS preference); its absence follows the system.

- `ThemeToggle` — a client component that cycles light → dark → system, writes
  `data-theme` on `<html>`, persists the choice to `localStorage`
  (`opensaas-theme`), and restores it on mount. It appears in the default Admin
  chrome's user menu and is opt-out via composition (custom chrome omits it).
- `ThemeScript` — a server-safe inline `<script>` for the document `<head>` that
  applies the saved choice before first paint, preventing a flash of the wrong
  scheme.

```tsx
import { ThemeScript } from '@opensaas/stack-ui'

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

To pin the admin to a single scheme, omit both and set the attribute statically,
e.g. `<html data-theme="dark">`. The `ThemeChoice` type and the
`applyThemeChoice` / `readStoredChoice` / `themeInitScript` / `THEME_STORAGE_KEY`
helpers are also exported for building custom controls.
