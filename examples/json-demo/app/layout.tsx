import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@opensaas/stack-ui/styles'

export const metadata: Metadata = {
  title: 'OpenSaaS JSON Demo',
  description: 'Demo of JSON field type with custom editor component',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
