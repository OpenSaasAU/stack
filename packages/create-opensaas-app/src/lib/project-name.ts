/**
 * Project-name validation for scaffolded apps.
 *
 * A deep module with a tiny interface: a name string in, a structured
 * validity result out. Kept pure so it can be unit-tested in isolation and
 * reused by both the interactive prompt and the non-interactive flag path.
 */

export type ProjectNameValidation = { ok: true } | { ok: false; message: string }

/** Project names map directly to a directory and an npm package name. */
const PROJECT_NAME_PATTERN = /^[a-z0-9-]+$/

export function validateProjectName(name: string | undefined | null): ProjectNameValidation {
  if (!name) {
    return { ok: false, message: 'Project name is required' }
  }
  if (!PROJECT_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      message: 'Project name must only contain lowercase letters, numbers, and hyphens',
    }
  }
  return { ok: true }
}
