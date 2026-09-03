import type {
  ColumnTypeDescriptor,
  ContractColumnDescriptor,
  ExtensionDescriptor,
  IdFieldStrategy,
  ReferentialAction,
} from '../config/types.js'

/**
 * How a model's `id` is minted: one of the config's {@link IdFieldStrategy}
 * values, or `'singleton'` for a list declared `isSingleton` — an integer id
 * defaulting to `1`, regardless of `db.idField` (ADR-0048).
 */
export type ContractIdStrategy = IdFieldStrategy | 'singleton'

/**
 * A model's primary-key column. `type` is the column type a foreign key
 * referencing this model must also carry.
 */
export type ContractIdColumn = {
  strategy: ContractIdStrategy
  type: ColumnTypeDescriptor
}

/**
 * One stored column of a model. The same shape a field builder describes
 * ({@link ContractColumnDescriptor}) with any `db.nativeType` override already
 * folded into {@link ColumnTypeDescriptor}, so `type` is the single source of
 * the column's constructor. A foreign-key column appears here too, typed by
 * the referenced model's id.
 */
export type ContractColumn = Omit<ContractColumnDescriptor, 'nativeType'>

/**
 * A foreign-key constraint from one of the model's columns to another model's
 * `id`. `onDelete`/`onUpdate` are the relationship's `db` options; absent
 * means the target's default action.
 */
export type ContractForeignKey = {
  column: string
  references: { model: string; column: 'id' }
  onDelete?: ReferentialAction
  onUpdate?: ReferentialAction
}

/**
 * A model-level index or unique constraint from `db.indexes`, with every field
 * name resolved to its column (a scalar's own name, or a relationship's
 * `<field>Id`). `name` is the entry's declared name, emitted as the
 * constraint's `name:` (ADR-0040).
 */
export type ContractIndex = {
  columns: string[]
  unique: boolean
  name?: string
}

/**
 * The relation builder a model-side relation lowers to (ADR-0064): the
 * foreign-key owner is `belongsTo`; the other side is `hasMany` for a
 * one-to-many and `hasOne` for a one-to-one.
 */
export type ContractRelationKind = 'belongsTo' | 'hasOne' | 'hasMany'

/**
 * One relation on a model. `column` is the foreign-key column the relation is
 * keyed by — on this model for `belongsTo` (`from`), on `target` for `hasOne`
 * and `hasMany` (`by`). `oneToOne` is known from the config alone: Prisma's
 * emitted cardinality is `N:1` on the owning side of a one-to-one, and the
 * unique constraint on the owning column is what makes it one-to-one.
 */
export type ContractRelation = {
  name: string
  target: string
  kind: ContractRelationKind
  column: string
  oneToOne: boolean
  /** A `from_<List>_<field>` back-relation synthesised for a list-only `ref`. */
  synthetic: boolean
}

/**
 * Which auto-timestamp columns the model carries (`db.timestamps`, per list
 * over the config default, off by default). `createdAt` takes a database
 * `now()` default; `updatedAt` is maintained application-side with no
 * database backstop (ADR-0048).
 */
export type ContractTimestamps = {
  createdAt: boolean
  updatedAt: boolean
}

/** A native enum type the contract declares once and enum columns reference. */
export type ContractEnum = {
  name: string
  values: string[]
}

/**
 * One list, as a contract model.
 */
export type ContractModel = {
  /** The list key, which is also the model name. */
  name: string
  /** The physical table name (`db.map`), when it differs from {@link name}. */
  table?: string
  /** The Postgres schema the table lives in (`db.schema`); the default namespace when absent. */
  namespace?: string
  singleton: boolean
  id: ContractIdColumn
  /** Stored columns in declaration order, excluding `id` and the auto-timestamps. */
  columns: ContractColumn[]
  foreignKeys: ContractForeignKey[]
  indexes: ContractIndex[]
  relations: ContractRelation[]
  timestamps: ContractTimestamps
}

/**
 * The contract a config derives to (ADR-0057): plain, JSON-serialisable data
 * that the CLI renders into the standalone Contract module and that
 * `buildPrismaContract` feeds straight into Prisma's contract builder
 * in-process. Nothing here is a function, a class instance or a `Date`, so
 * the rendered module is fully literal by construction (ADR-0040).
 */
export type ContractData = {
  /** Models in config list order. */
  models: ContractModel[]
  /** Native enums, deduplicated by name. */
  enums: ContractEnum[]
  /** The extension packs the contract declares (`db.extensions`, plus any a plugin added), deduplicated by name. */
  extensions: ExtensionDescriptor[]
}
