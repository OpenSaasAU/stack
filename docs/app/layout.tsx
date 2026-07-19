import type { Metadata } from 'next'
import React from 'react'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: {
    default: 'Stack — the secure path is the only path',
    template: '%s · Stack',
  },
  description:
    'Stack, by OpenSaas: a config-first Next.js framework with access control enforced on every database operation — so features built by AI coding agents are secure by construction.',
  keywords: [
    'Next.js',
    'TypeScript',
    'Prisma',
    'Admin UI',
    'Access Control',
    'AI coding agents',
    'Claude Code',
  ],
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
        <Analytics />
      </body>
    </html>
  )
}
