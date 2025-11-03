'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { navigation, type NavItem } from '@/lib/navigation'
import { useState } from 'react'

function NavItemComponent({ item, level = 0 }: { item: NavItem; level?: number }) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(true)
  const hasChildren = item.items && item.items.length > 0
  const isActive = item.href === pathname

  if (hasChildren) {
    return (
      <div className="mb-2">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 w-full text-left font-semibold text-sm py-2 hover:text-primary transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {item.title}
        </button>
        {isOpen && (
          <div className="ml-4 border-l pl-4 mt-1">
            {item.items?.map((child, index) => (
              <NavItemComponent key={index} item={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      href={item.href || '#'}
      className={`block text-sm py-2 hover:text-primary transition-colors ${
        isActive ? 'text-primary font-medium' : 'text-muted-foreground'
      }`}
    >
      {item.title}
    </Link>
  )
}

export function Sidebar() {
  return (
    <aside className="w-64 border-r h-screen sticky top-0 overflow-y-auto p-6">
      <div className="space-y-4">
        {navigation.map((section, index) => (
          <NavItemComponent key={index} item={section} />
        ))}
      </div>
    </aside>
  )
}
