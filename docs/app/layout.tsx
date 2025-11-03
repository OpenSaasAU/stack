import type { Metadata } from 'next'
import React from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'OpenSaaS Stack Documentation',
  description:
    'Complete documentation for OpenSaaS Stack - A Next.js-based stack for building admin-heavy applications with built-in access control.',
  keywords: ['Next.js', 'TypeScript', 'Prisma', 'Admin', 'Access Control', 'SaaS'],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
