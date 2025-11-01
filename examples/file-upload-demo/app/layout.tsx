import '@opensaas/stack-ui/styles'
import React from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'File Upload Demo - OpenSaas Stack',
  description: 'Demonstration of file and image upload capabilities',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
