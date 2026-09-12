/**
 * The name one process-wide value or key is published under, in the symbol
 * registry `Symbol.for` and `globalThis` share.
 *
 * A bundler can compile the same module into several bundles, each with its
 * own module scope: Next.js does exactly this for the page layer and the
 * route-handler layer. Anything two copies of this package must AGREE on —
 * the async store the tripwire reads, the key an engine face is attached
 * under — therefore cannot live in module scope, because each copy would
 * create its own.
 */
export function processGlobalKey(name: string): string {
  return `@opensaas/stack-core/${name}`
}

/**
 * The one instance of a process-wide value, creating it on the first copy of
 * this module to ask for it and returning that same instance to every copy
 * after.
 *
 * `is` is what makes the sharing verifiable rather than assumed: a value
 * already published under the name is adopted only if it is the shape this
 * caller expects.
 */
export function processGlobal<T>(
  name: string,
  is: (value: unknown) => value is T,
  create: () => T,
): T {
  const key = Symbol.for(processGlobalKey(name))
  const existing: unknown = Reflect.get(globalThis, key)
  if (is(existing)) return existing
  const created = create()
  Reflect.set(globalThis, key, created)
  return created
}
