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

export function getDbKey(listKey: string): string {
  return pascalToCamel(listKey)
}

export function getUrlKey(listKey: string): string {
  return pascalToKebab(listKey)
}

export function getListKeyFromUrl(urlSegment: string): string {
  return kebabToPascal(urlSegment)
}
