// @opensaas/stack-core/contract
//
// The contract derivation (ADR-0057) and its Prisma 8 builder feed. The
// derivation and the relation-graph assertion are also on the root; this
// subpath adds `buildPrismaContract`, which imports `@prisma/orm-postgres`.

export { deriveContract } from './derive.js'
export {
  deriveConstraintMap,
  deriveDependencyTable,
  deriveGeneratedTables,
} from './dependencies.js'
export {
  assertRelationGraphAgrees,
  RelationGraphDivergenceError,
  type EmittedContract,
} from './relation-graph.js'
export {
  buildPrismaContract,
  toEmittedContract,
  type BuildPrismaContractOptions,
  type PrismaContract,
  type PrismaContractPacks,
} from './prisma.js'
export type {
  ConstraintMap,
  DependencyTable,
  FieldDependencySet,
  GeneratedTables,
  ListDependencies,
  UniqueConstraint,
} from './dependencies.js'
export type {
  ContractColumn,
  ContractData,
  ContractEnum,
  ContractForeignKey,
  ContractIdColumn,
  ContractIdStrategy,
  ContractIndex,
  ContractModel,
  ContractRelation,
  ContractRelationKind,
  ContractTimestamps,
} from './types.js'
