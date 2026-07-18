import '@opensaas/stack-ui/styles'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ThemeScript } from '@opensaas/stack-ui'
import React from 'react'

// Load a product font with next/font and expose it as a CSS variable. The
// admin theme (see opensaas.config.ts) maps `--font-sans` onto this variable,
// so the admin UI renders with the app's typography and proper font loading.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

export const metadata: Metadata = {
  title: 'OpenSaas Blog Admin',
  description: 'Admin interface for blog management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // `suppressHydrationWarning` is required on <html> because ThemeScript pins the
  // `data-theme` attribute before hydration, so the server-rendered markup and
  // the first client render legitimately differ on that attribute.
  //
  // To pin the admin to a single scheme instead of offering the toggle, drop
  // ThemeScript and set the attribute statically, e.g. `data-theme="dark"` here.
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Restores the saved light/dark/system choice before first paint to
            prevent a flash of the wrong scheme. */}
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  )
}
