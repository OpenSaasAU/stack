'use client'

import { FieldRoot, FieldLabel, FieldHelp } from '@opensaas/stack-ui/fields'
import {
  redactEmbeddingForClient,
  type EmbeddingDisplayMetadata,
} from '../fields/embedding-display.js'

export interface EmbeddingFieldProps {
  name: string
  value: unknown
  onChange: (value: unknown) => void
  label: string
  mode?: 'read' | 'edit'
  /** See `EmbeddingField.ui.showVector`. */
  showVector?: boolean
  /** See `EmbeddingField.ui.showMetadata`. */
  showMetadata?: boolean
  /** See `EmbeddingField.allowManualWrites` — changes only the note shown below the field. */
  allowManualWrites?: boolean
  helpText?: string
}

const METADATA_LABELS: Array<[keyof EmbeddingDisplayMetadata, string]> = [
  ['provider', 'Provider'],
  ['model', 'Model'],
  ['dimensions', 'Dimensions'],
  ['generatedAt', 'Generated'],
  ['sourceHash', 'Source hash'],
]

function formatGeneratedAt(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function formatMetadataValue(key: keyof EmbeddingDisplayMetadata, value: string | number): string {
  return key === 'generatedAt' && typeof value === 'string'
    ? formatGeneratedAt(value)
    : String(value)
}

function MetadataList({ metadata }: { metadata: EmbeddingDisplayMetadata }) {
  const entries = METADATA_LABELS.filter(([key]) => metadata[key] !== undefined)
  if (entries.length === 0) return null

  return (
    <dl data-slot="field-value" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([key, label]) => {
        const value = metadata[key]
        if (value === undefined) return null
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono break-all">{formatMetadataValue(key, value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

/**
 * Read-only renderer for `embedding` fields.
 *
 * Read-only regardless of the `mode` it is given: the column is written by
 * `ragPlugin` after the write's transaction settles, and an ordinary create or
 * update naming it is refused unless the field sets `allowManualWrites`
 * (ADR-0045, ADR-0066). There is no editable control to offer.
 */
export function EmbeddingField({
  value,
  label,
  showVector = false,
  showMetadata = true,
  allowManualWrites = false,
  helpText,
}: EmbeddingFieldProps) {
  const embedding = redactEmbeddingForClient(value, { showVector, showMetadata })

  const summary = !embedding.isSet
    ? 'No embedding generated yet.'
    : embedding.dimensions === null
      ? 'Embedding generated.'
      : `${embedding.dimensions.toLocaleString()}-dimension vector`

  const ownership = allowManualWrites
    ? 'Maintained by the RAG plugin. This form does not write it — write it from application code.'
    : 'Maintained by the RAG plugin. A create or update naming this field is refused.'

  return (
    <FieldRoot mode="read">
      <FieldLabel muted>{label}</FieldLabel>
      <p data-slot="field-value" className="text-sm">
        {summary}
      </p>

      {showMetadata && embedding.metadata !== null && (
        <MetadataList metadata={embedding.metadata} />
      )}

      {showVector && embedding.vector !== null && (
        <pre
          data-slot="field-value"
          className="text-xs bg-muted rounded-md p-3 max-h-48 overflow-auto font-mono"
        >
          [{embedding.vector.join(', ')}]
        </pre>
      )}

      {!showVector && embedding.isSet && (
        <FieldHelp>
          Vector hidden — set this field&rsquo;s <code>ui.showVector</code> to display it.
        </FieldHelp>
      )}

      <FieldHelp>{ownership}</FieldHelp>
      {helpText && <FieldHelp>{helpText}</FieldHelp>}
    </FieldRoot>
  )
}
