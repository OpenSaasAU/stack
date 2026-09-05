// ───────────────────────────────────────────────────────────────
// The contract-keyed generics the Generated bundle instantiates.
//
// `.opensaas/types.ts` authors one `Remainder` entry per list — the facts the
// emitted Contract artifacts cannot carry — and names one interface per shape
// extending a generic from here. Every shape the contract DOES carry (scalar
// types, nullability, relation arity, foreign-key ownership, column defaults)
// is derived once, here, and never written into generated text. See ADR-0052.
// ───────────────────────────────────────────────────────────────

export type {
  ListRemainder,
  RemainderBase,
  ColumnOutputTypes,
  ColumnInputTypes,
  RelationKey,
  RelationTarget,
  IsToOne,
  OwnedRelationKey,
  ForeignKeyColumn,
  ListId,
} from './contract.js'

export type { Row, StoredRow, NeedsRow, RelationValue, SystemFieldKey } from './rows.js'

export type { CreateInput, UpdateInput, WritableColumn } from './inputs.js'

export type {
  SecuredList,
  QueryResult,
  ColumnFilter,
  ListWhere,
  ListOrderBy,
  ListUniqueWhere,
  ListSelect,
  ListInclude,
  SubArgs,
  FindUniqueArgs,
  FindManyArgs,
  CountArgs,
  CreateArgs,
  CreateManyArgs,
  UpdateArgs,
  UpdateManyArgs,
  DeleteArgs,
  GetArgs,
} from './secured-list.js'

export type { StackBaseContext, StackTransactionContext, StackDb } from './context.js'
