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
 *
 * Apps with a strict nonce-based `script-src` Content-Security-Policy block
 * inline scripts unless they carry a matching `nonce`. Pass the per-request
 * nonce so the flash-prevention script survives the policy:
 *
 * ```tsx
 * import { headers } from 'next/headers'
 * import { ThemeScript } from '@opensaas/stack-ui'
 *
 * export default async function RootLayout({ children }) {
 *   const nonce = (await headers()).get('x-nonce') ?? undefined
 *   return (
 *     <html lang="en" suppressHydrationWarning>
 *       <head>
 *         <ThemeScript nonce={nonce} />
 *       </head>
 *       <body>{children}</body>
 *     </html>
 *   )
 * }
 * ```
 *
 * The nonce is forwarded only to the `<script>`'s `nonce` attribute; it is never
 * interpolated into the script body (which contains no user input). When
 * `nonce` is omitted the rendered output is byte-identical to before — no
 * `nonce` attribute is emitted.
 */
export interface ThemeScriptProps {
  /**
   * Optional CSP nonce forwarded to the inline `<script nonce>` attribute so the
   * flash-prevention script is permitted under a strict nonce-based
   * `script-src` policy. Omit it when your app has no such policy.
   */
  nonce?: string
}

export function ThemeScript({ nonce }: ThemeScriptProps = {}) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
}
