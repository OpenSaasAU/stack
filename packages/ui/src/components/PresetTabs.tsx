'use client'

import Link from 'next/link.js'
import { cn } from '../lib/utils.js'

export interface SerializedPresetView {
  key: string
  label: string
}

export interface PresetTabsProps {
  presets: SerializedPresetView[]
  activePreset?: string
  hrefFor: (key: string | null) => string
  label: string
}

export function PresetTabs({ presets, activePreset, hrefFor, label }: PresetTabsProps) {
  const tabs = [{ key: null, label: 'All' }, ...presets]
  return (
    <nav aria-label={label} data-slot="preset-tabs" className="-mb-px overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = (tab.key ?? undefined) === activePreset
          return (
            <li key={tab.key ?? ''}>
              <Link
                href={hrefFor(tab.key)}
                aria-current={active ? 'page' : undefined}
                data-slot="preset-tab"
                className={cn(
                  'inline-flex h-9 items-center border-b-2 border-transparent px-3 font-sans text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active && 'border-primary font-medium text-foreground',
                )}
              >
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
