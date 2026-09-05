// ───────────────────────────────────────────────────────────────
// @opensaas/stack-core/extend
//
// Authoring contracts for extending the stack: implement these when
// you build a plugin or a third-party field package. Stable, public
// API — distinct from the everyday consumer surface on the root entry
// point and from the unstable plumbing on `/internal`.
// ───────────────────────────────────────────────────────────────

// Plugin authoring (see the Plugin System docs)
export type { Plugin, PluginContext, GeneratedFiles, ExtensionDescriptor } from './config/index.js'

// Third-party field authoring (implement BaseFieldConfig; see custom-field docs)
export type {
  BaseFieldConfig,
  TypeInfo,
  TypeDescriptor,
  MultiColumnPrismaResult,
  ContractLiteral,
  ColumnTypeDescriptor,
  ColumnDefaultDescriptor,
  ContractColumnDescriptor,
  ContractForeignKeyDescriptor,
  ContractRelationDescriptor,
  ContractFieldDescriptor,
} from './config/index.js'

// Resolves a `TypeDescriptor` to the TypeScript type expression the generated
// bundle writes. An import descriptor becomes an inline `import('mod').Name`,
// so the emitted file needs no import statement of its own for it.
export { typeDescriptorToTypeString } from './fields/index.js'

// Contract derivation (ADR-0057) — the data a config derives to, which the
// generator renders and `@opensaas/stack-core/contract` feeds into Prisma.
export { deriveContract } from './contract/derive.js'
export {
  assertRelationGraphAgrees,
  RelationGraphDivergenceError,
  type EmittedContract,
} from './contract/relation-graph.js'
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
} from './contract/types.js'

// Filter spec authoring — a field's optional `getFilterSpec` returns these
// (ADR-0017). Additive: a field without one is simply not filterable.
export type {
  FilterSpec,
  FilterOperator,
  FilterCondition,
  FilterValueSource,
} from './filter/index.js'
