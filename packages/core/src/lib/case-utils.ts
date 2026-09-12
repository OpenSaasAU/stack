/**
 * Case conversion utilities for consistent naming across the stack
 *
 * - Config list names: PascalCase (e.g., "AuthUser", "BlogPost")
 * - Prisma models: PascalCase (e.g., "AuthUser", "BlogPost")
 * - Prisma client properties: camelCase (e.g., "authUser", "blogPost")
 * - Context db properties: camelCase (e.g., "authUser", "blogPost")
 * - URLs: kebab-case (e.g., "auth-user", "blog-post")
 */

export function pascalToCamel(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

export function pascalToKebab(str: string): string {
  return str.replace(/([A-Z])/g, (match, p1, offset) => {
    return offset > 0 ? `-${p1.toLowerCase()}` : p1.toLowerCase()
  })
}

export function kebabToPascal(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (match, p1) => p1.toUpperCase())
}

export function getUrlKey(listKey: string): string {
  return pascalToKebab(listKey)
}

export function getListKeyFromUrl(urlSegment: string): string {
  return kebabToPascal(urlSegment)
}

/**
 * Resolves a URL segment back to the list key that produced it, by checking
 * each candidate key against `getUrlKey` — the same helper that builds the
 * URL — rather than reconstructing a key by string transformation the way
 * `getListKeyFromUrl` does. That reconstruction is lossy for any list key
 * that isn't strict PascalCase (e.g. a camelCase key from a derived list),
 * so this is the config-aware resolver route lookups should use instead.
 *
 * Returns `undefined` when no candidate key's URL matches — callers render
 * their usual "not found" state rather than treating this as an error.
 * Throws if more than one candidate key produces the same URL segment: that
 * is a configuration error (two list keys collide once case-folded to a
 * URL) and must be reported, not resolved by silently picking one.
 */
export function resolveListKeyFromUrl(urlSegment: string, listKeys: string[]): string | undefined {
  const matches = listKeys.filter((listKey) => getUrlKey(listKey) === urlSegment)

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous list URL "${urlSegment}": list keys ${matches.map((key) => `"${key}"`).join(', ')} all resolve to this URL. Rename these lists so their URLs are unique.`,
    )
  }

  return matches[0]
}
