/**
 * How a failed embedding generation is reported.
 *
 * The distinction that matters to whoever reads the log is whether the failure
 * is transient — this provider, this row, retry — or standing, meaning it will
 * fail identically on every row until something outside the application
 * changes. That is a property of the **error**, not of where in the hook it was
 * thrown: `createEmbeddingProvider` fails permanently on a `type` nothing
 * registered, while a provider being down fails transiently. So the
 * classification is on the error and the reporter is one catch site.
 */

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Whether a throw is `createEmbeddingProvider` refusing a `type` no factory
 * answers to. `beforeGenerate` cannot catch this — a custom provider is
 * registered at runtime by `registerEmbeddingProvider`, so what is registered
 * is unknowable when the schema is planned.
 */
export function isUnregisteredProviderType(error: unknown): boolean {
  return messageOf(error).includes('Unknown embedding provider type')
}

/**
 * The writes core refuses before they reach the database, by name. Matched on
 * `Error.name` rather than `instanceof` so a second copy of `stack-core` on
 * the resolved tree cannot make the classification silently fall through to
 * the transient arm.
 */
const REFUSED_WRITE_ERRORS = new Set([
  'HandlelessPluginFieldWriteError',
  'UnknownPluginFieldWriteError',
  'UndefinedPluginFieldWriteError',
  'WriteCollectionMissingError',
])

/**
 * Whether a throw is core refusing the escalated write itself — a wiring
 * defect the plugin holds: a context with no ORM handle, a field the config
 * does not declare, an `undefined` value, or an ORM client whose emitted
 * contract has no collection for the list. Each fails identically on every
 * row until the wiring is fixed, so none of them is something to retry.
 */
export function isRefusedWrite(error: unknown): boolean {
  return error instanceof Error && REFUSED_WRITE_ERRORS.has(error.name)
}

export type GenerationFailure = {
  listName: string
  fieldName: string
  id: string | number
  /** The provider as the field named it, for the transient message. */
  provider: string
  error: unknown
}

export type GenerationFailureReporter = (failure: GenerationFailure) => void

/**
 * Reports one failed generation. A standing defect is said in full the first
 * time it is seen for a field and in one line for every row after it, so the
 * condition reads as the standing defect it is rather than as per-row noise; a
 * transient failure is said in full every time, because every occurrence is its
 * own event.
 */
export function createGenerationFailureReporter(): GenerationFailureReporter {
  const said = new Set<string>()

  const standing = (
    { listName, fieldName, id, error }: GenerationFailure,
    headline: string,
    pointer: string,
  ): void => {
    const field = `${listName}.${fieldName}`
    if (said.has(field)) {
      console.error(
        `RAG plugin: "${field}" was not embedded for ${listName} ${id} — the standing defect ` +
          `reported above (${pointer}).`,
        error,
      )
      return
    }
    said.add(field)
    console.error(headline, error)
  }

  return (failure) => {
    const field = `${failure.listName}.${failure.fieldName}`

    if (isUnregisteredProviderType(failure.error)) {
      standing(
        failure,
        `RAG plugin: EMBEDDING GENERATION IS NOT RUNNING for "${field}". Its ` +
          `${failure.provider} names a type no factory answers to, and that is a configuration ` +
          `defect rather than a provider being down: it fails the same way for every row until ` +
          `the type is registered. Call registerEmbeddingProvider() with it before the first ` +
          `write, or name a provider ragPlugin declares. Rows commit normally and the embedding ` +
          `column stays null, and there is no regeneration path (#1271), so rows written before ` +
          `it is registered stay null afterwards.`,
        'register the provider type',
      )
      return
    }

    if (isRefusedWrite(failure.error)) {
      standing(
        failure,
        `RAG plugin: EMBEDDING GENERATION IS NOT RUNNING for "${field}". The provider answered ` +
          `and core then refused the write that stores what it returned, by name. That is a ` +
          `wiring defect rather than a provider being down: it fails the same way for every row ` +
          `until the wiring is fixed, and retrying the source write will not clear it. Rows ` +
          `commit normally and the embedding column stays null, and there is no regeneration ` +
          `path (#1271), so rows written before it is fixed stay null afterwards.`,
        'fix the refused write reported above',
      )
      return
    }

    console.error(
      `RAG plugin: "${field}" was not embedded for ${failure.listName} ${failure.id}. Reaching ` +
        `the ${failure.provider}, or storing what it returned, failed for a reason that is not ` +
        `a standing defect — the row is committed and keeps a null embedding, and there is no ` +
        `regeneration path yet (#1271). If the cause has cleared, retry by writing the source ` +
        `field again.`,
      failure.error,
    )
  }
}
