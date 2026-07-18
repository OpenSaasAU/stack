import { themeInitScript } from '../lib/theme-mode.js'

/**
 * Pre-hydration inline script that restores the persisted color-scheme choice
 * before first paint, preventing a flash of the wrong scheme.
 *
 * Render it as early as possible in the document — ideally the first child of
 * `<head>` (or the top of `<body>`) in your root layout — so it runs before the
 * admin chrome paints:
 *
 * ```tsx
 * import { ThemeScript } from '@opensaas/stack-ui'
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html lang="en" suppressHydrationWarning>
 *       <head>
 *         <ThemeScript />
 *       </head>
 *       <body>{children}</body>
 *     </html>
 *   )
 * }
 * ```
 *
 * It is a plain server-safe element (no client runtime); the `ThemeToggle`
 * component reads and writes the same `localStorage` key at runtime.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
}
