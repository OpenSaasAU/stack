/**
 * Structural equality for a stored `FileMetadata`/`ImageMetadata` value. A key
 * holding `undefined` counts the same as an absent key, since `assembleColumns`
 * and a caller resubmitting a value read back from `context.db` can each carry
 * an optional member (`metadata`, `transformations`) the other one omits for
 * the same logical value.
 */
export function metadataEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => metadataEquals(value, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      if (!metadataEquals(a[key], b[key])) return false
    }
    return true
  }
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * A metadata-shaped input is AUTHORITATIVE (see ADR-0006's no-re-upload
 * guarantee) only when it is exactly the row's own currently stored value, or
 * when the write runs under `sudo()`. Anything else — a traversal filename, a
 * copy of another row's real metadata, a changed `storageProvider` — is
 * refused rather than trusted, since accepting it verbatim is what let a
 * non-privileged write point a field at an arbitrary path or another row's
 * asset (#1619).
 *
 * `create` has no "currently stored value" to match against, so a
 * metadata-shaped create input is refused outright unless sudo — matching
 * the existing sudo-only seed/migration use case of pointing a new row at an
 * already-uploaded asset.
 */
export function authorizeStoredMetadata<T>(params: {
  value: T
  fieldKey: string
  operation: 'create' | 'update'
  isSudo: boolean
  currentValue: () => unknown
}): T {
  const { value, fieldKey, operation, isSudo, currentValue } = params
  if (isSudo) return value

  if (operation === 'create') {
    throw new Error(
      `Cannot set "${fieldKey}" to existing upload metadata on create: a non-privileged create must ` +
        `upload a File. Use sudo() to point a new row at an already-uploaded asset.`,
    )
  }

  if (!metadataEquals(value, currentValue())) {
    throw new Error(
      `Cannot set "${fieldKey}" to upload metadata that does not match its own currently stored value. ` +
        `Resubmit the field unchanged, or upload a new File.`,
    )
  }

  return value
}
