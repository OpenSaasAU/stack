'use client'

import * as React from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '../primitives/button.js'
import {
  type ThemeChoice,
  applyThemeChoice,
  readStoredChoice,
  storeChoice,
  subscribeThemeChoice,
} from '../lib/theme-mode.js'

export interface ThemeToggleProps {
  /** Extra classes merged onto the toggle button. */
  className?: string
}

// Cycle order for the single-button control: light → dark → system → light.
const NEXT_CHOICE: Record<ThemeChoice, ThemeChoice> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
}

const LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

const ICONS: Record<ThemeChoice, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

// Stable server snapshot: before hydration we can't read localStorage, so the
// server (and first client paint) assume 'system'. `useSyncExternalStore` then
// reconciles to the persisted value on the client without a hydration warning.
const getServerChoice = (): ThemeChoice => 'system'

/**
 * User-facing color-scheme control for the admin chrome. A single button that
 * cycles light → dark → system, writing the choice to the document root's
 * `data-theme` attribute (see `styles/globals.css`) and persisting it to
 * `localStorage`. On mount it restores the persisted choice; a first-paint
 * flash is prevented separately by the `ThemeScript` inline script in `<head>`.
 *
 * This is a Client Component. It is mounted in the default chrome's user menu
 * but is fully composable — custom chrome simply omits it, or places it
 * anywhere via the exported component.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  // Read the persisted choice through an external store so the rendered icon
  // stays in sync with `localStorage` (this tab and others) without a
  // setState-in-effect or a hydration mismatch.
  const choice = React.useSyncExternalStore(subscribeThemeChoice, readStoredChoice, getServerChoice)

  // Reconcile the DOM attribute with the current choice. On mount this restores
  // the persisted scheme (the inline ThemeScript may already have pinned it
  // before paint); on change it applies the new choice.
  React.useEffect(() => {
    applyThemeChoice(choice)
  }, [choice])

  const handleClick = React.useCallback(() => {
    storeChoice(NEXT_CHOICE[readStoredChoice()])
  }, [])

  const Icon = ICONS[choice]
  const label = LABELS[choice]

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      data-slot="theme-toggle"
      aria-label={`Theme: ${label}. Activate to change.`}
      title={`Theme: ${label}`}
      className={className}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </Button>
  )
}
