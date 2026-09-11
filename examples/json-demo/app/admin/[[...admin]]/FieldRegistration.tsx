'use client'

import '../../../lib/register-fields'

/**
 * Carries the `'use client'` registration module into the client bundle.
 *
 * A bare side-effect import of a `'use client'` module from a server component
 * does not run in the browser — the module is only evaluated where it is
 * rendered. This component renders nothing; being rendered is the whole point.
 */
export function FieldRegistration() {
  return null
}
