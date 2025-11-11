import React from 'react'
import Link from 'next/link'
import { Code2, Github, Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { CopyMarkdownButton } from './CopyMarkdownButton'
import { SearchModal } from './SearchModal'

interface DocLayoutProps {
  children: React.ReactNode
  slug: string[]
  title?: string
}

export function DocLayout({ children, slug, title }: DocLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Code2 className="h-6 w-6" />
              <span className="text-xl font-bold">OpenSaaS Stack</span>
            </Link>
            <nav className="hidden md:flex items-center gap-4">
              <Link
                href="/docs/quick-start"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Docs
              </Link>
              <a
                href="https://github.com/OpenSaasAU/stack"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Github className="h-4 w-4" />
                GitHub
              </a>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <SearchModal />
            <CopyMarkdownButton slug={slug} />
            <button className="md:hidden p-2">
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <div className="container max-w-4xl mx-auto px-8 py-12">
            {title && <h1 className="text-4xl font-bold mb-8">{title}</h1>}
            <div className="prose">{children}</div>

            {/* Edit on GitHub */}
            <div className="mt-12 pt-6 border-t">
              <a
                href={`https://github.com/OpenSaasAU/stack/edit/main/docs/content/${slug.join('/')}.md`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
              >
                <Github className="h-4 w-4" />
                Edit this page on GitHub
              </a>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
