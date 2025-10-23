import '@opensaas/ui/styles'
import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = {
  title: 'OpenSaaS Blog Admin',
  description: 'Admin interface for blog management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
