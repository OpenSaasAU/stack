import '@opensaas/stack-ui/styles'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
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
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  )
}
