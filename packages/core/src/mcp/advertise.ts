/**
 * Decide whether one field is advertised, treating a rule that throws as a
 * denial.
 *
 * `tools/list` evaluates every field's access rule across every list, so a rule
 * that throws — `({ session }) => session.role === 'admin'` reached by a
 * session-less request, say — would otherwise fail the whole listing over one
 * field. Containment is the advertisement's alone: the rule still throws when
 * the field is read or written (ADR-0030, ADR-0053).
 */
export async function decideAdvertisement<T>(decide: () => Promise<T>, denied: T): Promise<T> {
  try {
    return await decide()
  } catch {
    return denied
  }
}
