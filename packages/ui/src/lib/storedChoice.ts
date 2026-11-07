export interface StoredChoice<T extends string> {
  read: () => T
  subscribe: (listener: () => void) => () => void
  store: (value: T) => void
}

export function createStoredChoice<T extends string>(
  key: string,
  isValid: (value: string | null) => value is T,
  fallback: T,
): StoredChoice<T> {
  let unpersisted: T | undefined
  const listeners = new Set<() => void>()

  const read = (): T => {
    if (unpersisted !== undefined) return unpersisted
    try {
      const stored = localStorage.getItem(key)
      return isValid(stored) ? stored : fallback
    } catch {
      return fallback
    }
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    try {
      window.addEventListener('storage', listener)
    } catch {
      // `window` can be unavailable outside a browser.
    }
    return () => {
      listeners.delete(listener)
      try {
        window.removeEventListener('storage', listener)
      } catch {
        // `window` can be unavailable outside a browser.
      }
    }
  }

  const store = (value: T): void => {
    unpersisted = value
    try {
      localStorage.setItem(key, value)
      unpersisted = undefined
    } catch {
      // Private browsing, quota and blocked site data make `setItem` throw.
    }
    for (const listener of listeners) listener()
  }

  return { read, subscribe, store }
}
