/**
 * Case conversion utilities for consistent naming across the stack
 *
 * - Config list names: PascalCase (e.g., "AuthUser", "BlogPost")
 * - Prisma models: PascalCase (e.g., "AuthUser", "BlogPost")
 * - Prisma client properties: camelCase (e.g., "authUser", "blogPost")
 * - Context db properties: camelCase (e.g., "authUser", "blogPost")
 * - URLs: kebab-case (e.g., "auth-user", "blog-post")
 */

/**
 * Convert PascalCase to camelCase
 * AuthUser -> authUser
 * BlogPost -> blogPost
 */
export function pascalToCamel(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * Convert PascalCase to kebab-case
 * AuthUser -> auth-user
 * BlogPost -> blog-post
 */
export function pascalToKebab(str: string): string {
  return str.replace(/([A-Z])/g, (match, p1, offset) => {
    return offset > 0 ? `-${p1.toLowerCase()}` : p1.toLowerCase()
  })
}

/**
 * Convert kebab-case to PascalCase
 * auth-user -> AuthUser
 * blog-post -> BlogPost
 */
export function kebabToPascal(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

/**
 * Convert kebab-case to camelCase
 * auth-user -> authUser
 * blog-post -> blogPost
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (match, p1) => p1.toUpperCase())
}

/**
 * Get the database key for a list (camelCase)
 * Used for accessing context.db and prisma client
 */
export function getDbKey(listKey: string): string {
  return pascalToCamel(listKey)
}

/**
 * Get the URL segment for a list (kebab-case)
 * Used for constructing admin URLs
 */
export function getUrlKey(listKey: string): string {
  return pascalToKebab(listKey)
}

/**
 * Get the list key from a URL segment (PascalCase)
 * Used for parsing admin URLs
 */
export function getListKeyFromUrl(urlSegment: string): string {
  return kebabToPascal(urlSegment)
}
