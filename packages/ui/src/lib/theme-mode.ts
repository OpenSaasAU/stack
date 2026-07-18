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

/** Read the persisted choice, defaulting to `'system'` when unset or unreadable. */
export function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeChoice(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

// In-page subscribers so a same-tab write re-renders the toggle. The browser's
// `storage` event only fires in *other* tabs, so we notify locally on write.
const listeners = new Set<() => void>()

/**
 * Subscribe to color-scheme choice changes (this tab's writes + other tabs'
 * `storage` events). Returns an unsubscribe function. Designed for
 * `React.useSyncExternalStore`, which keeps the control hydration-safe without
 * calling `setState` inside an effect.
 */
export function subscribeThemeChoice(listener: () => void): () => void {
  listeners.add(listener)
  try {
    window.addEventListener('storage', listener)
  } catch {
    // `window` may be unavailable; the in-tab listener set still works.
  }
  return () => {
    listeners.delete(listener)
    try {
      window.removeEventListener('storage', listener)
    } catch {
      // Ignore — mirror of the add above.
    }
  }
}

/** Persist the choice, ignoring failures (private mode / disabled storage). */
export function storeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice)
  } catch {
    // Storage can be unavailable (private browsing, quota); the in-page choice
    // still applies for this session, so a write failure is non-fatal.
  }
  for (const listener of listeners) listener()
}

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
