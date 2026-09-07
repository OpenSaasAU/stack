import { z } from 'zod'
import type { FieldAccess } from '@opensaas/stack-core'
import type {
  BaseFieldConfig,
  ContractFieldDescriptor,
  TypeInfo,
  VectorColumnDescriptor,
  VectorDistanceFunction,
} from '@opensaas/stack-core/extend'
import type { EmbeddingProviderName, ChunkingConfig, StoredEmbedding } from '../config/types.js'

/** The access methods pgvector builds a vector index with. */
export type VectorIndexMethod = 'hnsw' | 'ivfflat'

/** The column type an embedding's dimension and index resolve to. */
export type VectorColumnType = 'vector' | 'halfvec'

/**
 * A vector index declared on the field that owns the column, so the operator
 * class can be derived from the same place the distance function and the
 * dimension are declared (ADR-0045).
 */
export type EmbeddingIndexConfig = {
  method: VectorIndexMethod
  /**
   * The operator class. Derived from the field's `distanceFunction` and column
   * type when absent; a declared value that disagrees fails `pnpm generate`.
   */
  opclass?: string
  /** `hnsw`: graph connectivity. */
  m?: number
  /** `hnsw`: candidate list size during the build. */
  efConstruction?: number
  /** `ivfflat`: number of inverted lists. */
  lists?: number
}

/** An {@link EmbeddingIndexConfig} with its column type and operator class resolved. */
export type ResolvedEmbeddingIndex = {
  method: VectorIndexMethod
  opclass: string
  columnType: VectorColumnType
  /** The method's build parameters, in the spelling pgvector's `WITH` clause takes. */
  parameters: Record<string, number>
}

/**
 * pgvector's `hnsw` and `ivfflat` access methods index `vector` to 2,000
 * dimensions and `halfvec` to 4,000. Both caps are the index's, not the
 * column's — an unindexed column stays `vector` at any dimension.
 */
const VECTOR_INDEX_DIMENSION_CAP = 2_000
const HALFVEC_INDEX_DIMENSION_CAP = 4_000

/** The dimension of a field neither the author nor its provider gave one. */
const DEFAULT_DIMENSIONS = 1536

const OPERATOR_CLASS_SUFFIX: Record<VectorDistanceFunction, string> = {
  cosine: 'cosine_ops',
  l2: 'l2_ops',
  inner_product: 'ip_ops',
}

const COLUMN_TYPE_CONSTRUCTOR: Record<VectorColumnType, string> = {
  vector: 'Vector',
  halfvec: 'HalfVector',
}

export type EmbeddingField<TTypeInfo extends TypeInfo = TypeInfo> = BaseFieldConfig<TTypeInfo> & {
  type: 'embedding'

  /**
   * When this field changes, embeddings are automatically regenerated.
   *
   * @example 'content' or 'title'
   */
  sourceField?: string

  /**
   * References a provider name from RAG config. Falls back to the default
   * provider if not specified.
   *
   * @example 'openai' or 'ollama'
   */
  provider?: EmbeddingProviderName

  /**
   * The column's dimension. A schema fact: changing it is a migration, and
   * `ragPlugin`'s `beforeGenerate` refuses a declared value that disagrees
   * with a statically known provider dimension.
   *
   * Left undeclared, `ragPlugin` resolves it from the field's provider, so
   * only a provider that declares no dimension of its own reaches the default.
   *
   * @default the provider's dimension, else 1536 (OpenAI text-embedding-3-small)
   */
  dimensions?: number

  /**
   * How similarity over this column is measured. The operator class of any
   * declared {@link index} must agree with it.
   *
   * @default 'cosine'
   */
  distanceFunction?: VectorDistanceFunction

  /**
   * The index this column's type and operator class are derived for. Declaring
   * one caps the dimension: over 2,000 the column becomes `halfvec`, and over
   * 4,000 generation fails, because no pgvector index can be built there.
   *
   * Known limits: `@prisma/orm-extension-pgvector@8.0.0-rc.8` registers no
   * index types, so a declaration is NOT yet lowered to a `CREATE INDEX` —
   * today it derives the column type and the operator class and nothing else.
   * Re-check when the pack reaches GA.
   */
  index?: EmbeddingIndexConfig

  /**
   * Let application code write the embedding and its metadata. Off by default:
   * they are plugin outputs, and an ordinary create or update naming them
   * throws (ADR-0045). Turn it on to maintain vectors yourself.
   *
   * @default false
   */
  allowManualWrites?: boolean

  /**
   * Only applies if sourceField is set.
   */
  chunking?: ChunkingConfig

  /**
   * @default true if sourceField is set
   */
  autoGenerate?: boolean

  /** The metadata column's model field name, resolved from the field's key. */
  getMetadataColumn?: (fieldName: string) => string

  /**
   * The index this field declares, with its column type and operator class
   * resolved. See {@link EmbeddingField.index} for what is and is not built
   * from it under the pack version this ships against.
   */
  getVectorIndex?: (fieldName: string, listKey?: string) => ResolvedEmbeddingIndex | undefined

  ui?: {
    /**
     * @default false (usually too large to display)
     */
    showVector?: boolean

    /**
     * @default true
     */
    showMetadata?: boolean
  }
}

/** The metadata column's model field name — `<field>Metadata`, beside the vector. */
export function embeddingMetadataColumn(fieldName: string): string {
  return `${fieldName}Metadata`
}

function isStoredEmbedding(value: unknown): value is StoredEmbedding {
  return typeof value === 'object' && value !== null && Array.isArray(Reflect.get(value, 'vector'))
}

function where(fieldName: string, listKey: string | undefined): string {
  return listKey === undefined ? `"${fieldName}"` : `"${listKey}.${fieldName}"`
}

/**
 * The column type an indexed field of `dimensions` must use, or a refusal when
 * no pgvector index can be built over it at all.
 */
function resolveColumnType(
  fieldName: string,
  listKey: string | undefined,
  dimensions: number,
  index: EmbeddingIndexConfig | undefined,
): VectorColumnType {
  if (index === undefined) return 'vector'
  if (dimensions <= VECTOR_INDEX_DIMENSION_CAP) return 'vector'
  if (dimensions <= HALFVEC_INDEX_DIMENSION_CAP) return 'halfvec'
  throw new Error(
    `embedding field ${where(fieldName, listKey)} declares a ${index.method} index over ` +
      `${dimensions} dimensions. pgvector indexes vector to ${VECTOR_INDEX_DIMENSION_CAP} ` +
      `dimensions and halfvec to ${HALFVEC_INDEX_DIMENSION_CAP}, so no index can be built over ` +
      `this column. Drop the index option to keep an unindexed vector(${dimensions}) column, or ` +
      `reduce the dimension.`,
  )
}

function resolveOperatorClass(
  fieldName: string,
  listKey: string | undefined,
  columnType: VectorColumnType,
  distanceFunction: VectorDistanceFunction,
  declared: string | undefined,
): string {
  const derived = `${columnType}_${OPERATOR_CLASS_SUFFIX[distanceFunction]}`
  if (declared !== undefined && declared !== derived) {
    throw new Error(
      `embedding field ${where(fieldName, listKey)} declares the operator class "${declared}", ` +
        `but a ${distanceFunction} distance over a ${columnType} column is measured by ` +
        `"${derived}". Remove the opclass option to take the derived one, or change the ` +
        `distanceFunction the index is built for.`,
    )
  }
  return derived
}

function indexParameters(index: EmbeddingIndexConfig): Record<string, number> {
  const parameters: Record<string, number> = {}
  if (index.method === 'hnsw') {
    if (index.m !== undefined) parameters.m = index.m
    if (index.efConstruction !== undefined) parameters.ef_construction = index.efConstruction
  } else if (index.lists !== undefined) {
    parameters.lists = index.lists
  }
  return parameters
}

/**
 * A vector embedding column, with its metadata in a column beside it.
 *
 * @example
 * ```typescript
 * import { embedding } from '@opensaas/stack-rag/fields'
 *
 * fields: {
 *   content: text(),
 *   contentEmbedding: embedding({
 *     sourceField: 'content',
 *     provider: 'openai',
 *     dimensions: 1536,
 *     distanceFunction: 'cosine',
 *     index: { method: 'hnsw', m: 16, efConstruction: 64 },
 *   }),
 * }
 * ```
 */
export function embedding<TTypeInfo extends TypeInfo = TypeInfo>(
  options?: Omit<EmbeddingField<TTypeInfo>, 'type'>,
): EmbeddingField<TTypeInfo> {
  const dimensions = options?.dimensions ?? DEFAULT_DIMENSIONS
  const distanceFunction: VectorDistanceFunction = options?.distanceFunction ?? 'cosine'
  const autoGenerate = options?.autoGenerate ?? options?.sourceField != null
  const index = options?.index
  const allowManualWrites = options?.allowManualWrites ?? false

  const resolveIndex = (
    fieldName: string,
    listKey?: string,
  ): ResolvedEmbeddingIndex | undefined => {
    if (index === undefined) return undefined
    const columnType = resolveColumnType(fieldName, listKey, dimensions, index)
    return {
      method: index.method,
      opclass: resolveOperatorClass(
        fieldName,
        listKey,
        columnType,
        distanceFunction,
        index.opclass,
      ),
      columnType,
      parameters: indexParameters(index),
    }
  }

  const access: FieldAccess | undefined = allowManualWrites
    ? options?.access
    : { ...options?.access, create: () => false, update: () => false }

  return {
    type: 'embedding',
    ...options,
    ...(access === undefined ? {} : { access }),
    distanceFunction,
    autoGenerate,
    allowManualWrites,
    outputType: "import('@opensaas/stack-rag').StoredEmbedding | null",
    inputType: "import('@opensaas/stack-rag').StoredEmbedding | null",

    getZodSchema: (_fieldName: string, _operation: 'create' | 'update') => {
      const embeddingSchema = z.object({
        vector: z.array(z.number()).length(dimensions, {
          message: `Embedding vector must have exactly ${dimensions} dimensions`,
        }),
        metadata: z.object({
          model: z.string(),
          provider: z.string(),
          dimensions: z.number(),
          generatedAt: z.string(),
          sourceHash: z.string().optional(),
        }),
      })

      // Stays optional even when sourceField/autoGenerate is set: ragPlugin
      // writes it after the write's transaction settles, not on input.
      return embeddingSchema.nullable().optional() as unknown as z.ZodTypeAny
    },

    getContractField: (fieldName: string, listKey: string): ContractFieldDescriptor => {
      const columnType = resolveColumnType(fieldName, listKey, dimensions, index)
      // Resolved for its refusal: an operator class that disagrees with the
      // distance function has to stop generation, and this is the seam core
      // reports a field descriptor's throw through.
      resolveIndex(fieldName, listKey)
      return {
        kind: 'columns',
        columns: [
          {
            name: fieldName,
            type: {
              pack: 'pgvector',
              type: COLUMN_TYPE_CONSTRUCTOR[columnType],
              args: [dimensions],
            },
            nullable: true,
          },
          {
            name: embeddingMetadataColumn(fieldName),
            type: { pack: 'pg', type: 'jsonb' },
            nullable: true,
          },
        ],
      }
    },

    getVectorColumn: (fieldName: string): VectorColumnDescriptor => ({
      column: fieldName,
      dimensions,
      distanceFunction,
    }),

    getVectorIndex: resolveIndex,

    getMetadataColumn: embeddingMetadataColumn,

    getColumnNames: (fieldName: string): string[] => [
      fieldName,
      embeddingMetadataColumn(fieldName),
    ],

    assembleColumns: (fieldName: string, row: Record<string, unknown>): unknown => {
      const vector = row[fieldName]
      if (!Array.isArray(vector)) return null
      return { vector, metadata: row[embeddingMetadataColumn(fieldName)] }
    },

    splitColumns: (fieldName: string, value: unknown): Record<string, unknown> => {
      const stored = isStoredEmbedding(value) ? value : null
      return {
        [fieldName]: stored?.vector ?? null,
        [embeddingMetadataColumn(fieldName)]: stored?.metadata ?? null,
      }
    },
  }
}
