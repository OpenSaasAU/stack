/**
 * An empty registry with no prototype, for a plain object that will be keyed
 * by an author-supplied name (a plugin name, say). A registry built with `{}`
 * lets a key like `__proto__` reach the object's actual prototype on write,
 * and a key like `constructor` or `toString` shadow an inherited member on
 * read — both silent, and both far from where the name was chosen.
 */
export function nullPrototypeRegistry<T = unknown>(): Record<string, T> {
  return Object.create(null)
}
