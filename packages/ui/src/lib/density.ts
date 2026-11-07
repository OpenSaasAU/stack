/** How tightly the list table packs its rows. */
export type ListDensity = 'comfortable' | 'compact'

/** localStorage key the list density is persisted under. Part of the public contract. */
export const DENSITY_STORAGE_KEY = 'opensaas-list-density'

export const DEFAULT_DENSITY: ListDensity = 'comfortable'

function isListDensity(value: string | null): value is ListDensity {
  return value === 'comfortable' || value === 'compact'
}

/** Read the persisted density, defaulting to comfortable when unset or unreadable. */
export function readStoredDensity(): ListDensity {
  try {
    const stored = localStorage.getItem(DENSITY_STORAGE_KEY)
    return isListDensity(stored) ? stored : DEFAULT_DENSITY
  } catch {
    return DEFAULT_DENSITY
  }
}

export function readServerDensity(): ListDensity {
  return DEFAULT_DENSITY
}

const listeners = new Set<() => void>()

/** Subscribe to density changes from this tab and others, for `useSyncExternalStore`. */
export function subscribeDensity(listener: () => void): () => void {
  listeners.add(listener)
  try {
    window.addEventListener('storage', listener)
  } catch {
    // `window` can be unavailable; this tab's own writes still notify.
  }
  return () => {
    listeners.delete(listener)
    try {
      window.removeEventListener('storage', listener)
    } catch {
      // Mirror of the add above.
    }
  }
}

/** Persist the density, ignoring storage failures (private mode, quota). */
export function storeDensity(density: ListDensity): void {
  try {
    localStorage.setItem(DENSITY_STORAGE_KEY, density)
  } catch {
    // The in-page choice still applies when storage is unavailable.
  }
  for (const listener of listeners) listener()
}
