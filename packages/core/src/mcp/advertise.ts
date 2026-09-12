/**
 * Decide whether one field is advertised, treating anything thrown while
 * deciding as a denial.
 *
 * `tools/list` evaluates every field's access rule across every list, so a rule
 * that throws — `({ session }) => session.role === 'admin'` reached by a
 * session-less request, say — would otherwise fail the whole listing over one
 * field. Containment is the advertisement's alone: the rule still throws when
 * the field is read or written (ADR-0030, ADR-0053).
 *
 * The catch is deliberately broad — an `InvalidFieldAccessResultError` or a bug
 * in the framework costs the field its advertisement just as a throwing rule
 * does — so it warns, or an un-advertised field would have no diagnostic at all.
 */
export async function decideAdvertisement<T>(
  subject: string,
  decide: () => Promise<T>,
  denied: T,
): Promise<T> {
  try {
    return await decide()
  } catch (err) {
    console.warn(
      `[opensaas] MCP is not advertising "${subject}": deciding its access threw. ` +
        `Reading or writing the field will raise the same error.`,
      err,
    )
    return denied
  }
}
