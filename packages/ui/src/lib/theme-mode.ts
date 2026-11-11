/**
 * Shared vocabulary for the user-controllable color scheme.
 *
 * The admin's dark-mode mechanism lives in `styles/globals.css`: a
 * `data-theme="light" | "dark"` attribute on the document root pins
 * `color-scheme` (which drives every `light-dark()` token), while the
 * attribute's absence follows the OS preference. This module centralises the
 * storage key, the three-state choice type, and the helpers that read/apply/
 * persist it, so the pre-hydration inline script and the `ThemeToggle`
 * component can never disagree about how the choice is stored or applied.
 */

import { createStoredChoice } from './storedChoice.js'

/** The three states a user can pick: pin light, pin dark, or follow the OS. */
export type ThemeChoice = 'light' | 'dark' | 'system'

/** localStorage key the choice is persisted under. Part of the public contract. */
export const THEME_STORAGE_KEY = 'opensaas-theme'

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system'
}

/**
 * Apply a choice to the document root: pin the `data-theme` attribute for
 * light/dark, or remove it so `color-scheme` follows the system preference.
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', choice)
  }
}

const themeChoice = createStoredChoice(THEME_STORAGE_KEY, isThemeChoice, 'system')

/** Read the persisted choice, defaulting to `'system'` when unset or unreadable. */
export const readStoredChoice: () => ThemeChoice = themeChoice.read

/**
 * Subscribe to color-scheme choice changes (this tab's writes + other tabs'
 * `storage` events). Returns an unsubscribe function. Designed for
 * `React.useSyncExternalStore`, which keeps the control hydration-safe without
 * calling `setState` inside an effect.
 */
export const subscribeThemeChoice: (listener: () => void) => () => void = themeChoice.subscribe

/** Persist the choice, ignoring failures (private mode / disabled storage). */
export const storeChoice: (choice: ThemeChoice) => void = themeChoice.store

/**
 * Self-contained inline script for the document `<head>`. It runs before first
 * paint — ahead of any module or React hydration — reading the persisted
 * choice and pinning `data-theme` so the correct scheme is painted immediately,
 * with no flash of the wrong scheme. Kept dependency-free because it executes
 * before the bundle loads; keep it in sync with {@link applyThemeChoice} /
 * {@link readStoredChoice}.
 */
export const themeInitScript = `(function(){try{var c=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var r=document.documentElement;if(c==='light'||c==='dark'){r.setAttribute('data-theme',c)}else{r.removeAttribute('data-theme')}}catch(e){}})()`
