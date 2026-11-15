/**
 * `rule` typed as an access rule. A rule in an untyped config can answer
 * `null` or `undefined`, which the engine reads as deny; this is how a typed
 * test declares one. For core's own tests: the overload launders a nullable
 * rule's type, so no entry point exports it.
 */
export function untypedRule<TArgs>(
  rule: (args: TArgs) => boolean | null | undefined,
): (args: TArgs) => boolean
export function untypedRule<TArgs>(
  rule: (args: TArgs) => boolean | null | undefined,
): (args: TArgs) => boolean | null | undefined {
  return rule
}
