import { createStoredChoice } from './storedChoice.js'

/** How tightly the list table packs its rows. */
export type ListDensity = 'comfortable' | 'compact'

/** localStorage key the list density is persisted under. Part of the public contract. */
export const DENSITY_STORAGE_KEY = 'opensaas-list-density'

export const DEFAULT_DENSITY: ListDensity = 'comfortable'

function isListDensity(value: string | null): value is ListDensity {
  return value === 'comfortable' || value === 'compact'
}

const densityChoice = createStoredChoice(DENSITY_STORAGE_KEY, isListDensity, DEFAULT_DENSITY)

/** Read the density, defaulting to comfortable when unset or unreadable. */
export const readStoredDensity: () => ListDensity = densityChoice.read

export function readServerDensity(): ListDensity {
  return DEFAULT_DENSITY
}

/** Subscribe to density changes from this tab and others, for `useSyncExternalStore`. */
export const subscribeDensity: (listener: () => void) => () => void = densityChoice.subscribe

/** Set the density for this page, and persist it when storage allows. */
export const storeDensity: (density: ListDensity) => void = densityChoice.store
