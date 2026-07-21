'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { GithubIcon } from './icons/GithubIcon'
import { SidebarNav } from './Sidebar'

/** Hamburger-triggered navigation drawer for viewports below `md`. */
export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="md:hidden">
      <button
        onClick={() => setIsOpen(true)}
        className="p-2 hover:text-primary transition-colors"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50">
          <button
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
            aria-label="Close navigation"
          />
          <div className="absolute inset-y-0 left-0 w-80 max-w-[85vw] bg-background border-r shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b">
              <Link href="/" onClick={() => setIsOpen(false)} className="flex items-baseline gap-2">
                <span className="text-lg font-bold">Stack</span>
                <span className="px-1.5 py-0.5 rounded border border-primary/40 text-primary text-[10px] font-mono uppercase tracking-wider">
                  Beta
                </span>
              </Link>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:text-primary transition-colors"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-4">
              <SidebarNav onNavigate={() => setIsOpen(false)} />
            </nav>
            <div className="border-t px-4 py-3">
              <a
                href="https://github.com/OpenSaasAU/stack"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <GithubIcon className="h-4 w-4" />
                GitHub
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
