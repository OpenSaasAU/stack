import type { ContractData, ContractModel, ContractRelation } from './types.js'

/**
 * The slice of an emitted Prisma contract (`contract.json`, or
 * `JSON.parse(JSON.stringify(contract))` of a built one) that the relation
 * graph assertion reads. Every other key is ignored.
 */
export type EmittedContract = {
  domain: {
    namespaces: Record<
      string,
      {
        models: Record<
          string,
          {
            relations: Record<
              string,
              {
                to: { namespace: string; model: string }
                cardinality: string
                on: { localFields: string[]; targetFields: string[] }
              }
            >
            storage: {
              table: string
              namespaceId: string
              fields: Record<string, { column: string }>
            }
          }
        >
      }
    >
  }
  storage: {
    namespaces: Record<
      string,
      { entries: { table: Record<string, { uniques: { columns: string[]; name?: string }[] }> } }
    >
  }
}

/**
 * Thrown by {@link assertRelationGraphAgrees} on the first place the emitted
 * contract's relations disagree with the config-derived graph.
 */
export class RelationGraphDivergenceError extends Error {
  constructor(
    /** `Model.relation`, or `Model` when the model itself is missing. */
    readonly at: string,
    detail: string,
  ) {
    super(`Emitted contract disagrees with the config-derived relation graph at ${at}: ${detail}`)
    this.name = 'RelationGraphDivergenceError'
  }
}

type EmittedModel = EmittedContract['domain']['namespaces'][string]['models'][string]

function findEmittedModel(
  emitted: EmittedContract,
  name: string,
): { namespace: string; model: EmittedModel } | undefined {
  for (const [namespace, ns] of Object.entries(emitted.domain.namespaces)) {
    const model = ns.models[name]
    if (model) return { namespace, model }
  }
  return undefined
}

const CARDINALITY: Record<ContractRelation['kind'], string> = {
  belongsTo: 'N:1',
  hasMany: '1:N',
  hasOne: '1:1',
}

function expectedOn(relation: ContractRelation): { local: string[]; target: string[] } {
  return relation.kind === 'belongsTo'
    ? { local: [relation.column], target: ['id'] }
    : { local: ['id'], target: [relation.column] }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function hasUniqueOn(emitted: EmittedContract, model: EmittedModel, field: string): boolean {
  const column = model.storage.fields[field]?.column
  if (column === undefined) return false
  const table =
    emitted.storage.namespaces[model.storage.namespaceId]?.entries.table[model.storage.table]
  return table?.uniques.some((unique) => sameList(unique.columns, [column])) ?? false
}

function assertRelation(
  emitted: EmittedContract,
  model: ContractModel,
  relation: ContractRelation,
  emittedModel: EmittedModel,
): void {
  const at = `${model.name}.${relation.name}`
  const found = emittedModel.relations[relation.name]
  if (!found)
    throw new RelationGraphDivergenceError(at, 'the relation is missing from the emitted contract')
  if (found.to.model !== relation.target) {
    throw new RelationGraphDivergenceError(
      at,
      `the config targets "${relation.target}" but the emitted relation targets "${found.to.model}"`,
    )
  }
  const cardinality = CARDINALITY[relation.kind]
  if (found.cardinality !== cardinality) {
    throw new RelationGraphDivergenceError(
      at,
      `the config derives ${relation.kind} (${cardinality}) but the emitted cardinality is "${found.cardinality}"`,
    )
  }
  const on = expectedOn(relation)
  if (!sameList(found.on.localFields, on.local) || !sameList(found.on.targetFields, on.target)) {
    throw new RelationGraphDivergenceError(
      at,
      `the config keys it on [${on.local.join(', ')}] → [${on.target.join(', ')}] but the emitted relation is ` +
        `[${found.on.localFields.join(', ')}] → [${found.on.targetFields.join(', ')}]`,
    )
  }
  if (relation.oneToOne) {
    const owner =
      relation.kind === 'belongsTo'
        ? emittedModel
        : findEmittedModel(emitted, relation.target)?.model
    if (!owner || !hasUniqueOn(emitted, owner, relation.column)) {
      throw new RelationGraphDivergenceError(
        at,
        `the config declares a one-to-one but the emitted contract has no unique constraint on "${relation.column}", ` +
          `so the relation would silently return the first of many`,
      )
    }
  }
}

/**
 * Assert that the relations in an emitted contract are exactly the ones
 * {@link deriveContract} derived from the config: every derived relation is
 * present with the same target, cardinality (`belongsTo` → `N:1`, `hasMany`
 * → `1:N`, `hasOne` → `1:1`) and key columns, every one-to-one has its unique
 * constraint on the owning column (ADR-0064), and the emitted contract
 * carries no relation the config did not derive. Throws
 * {@link RelationGraphDivergenceError} naming the first divergence.
 *
 * The generator runs this after `contract emit` so a divergence is a build
 * error rather than a Prisma rejection at runtime (ADR-0040).
 */
export function assertRelationGraphAgrees(derived: ContractData, emitted: EmittedContract): void {
  const found = new Map<string, EmittedModel>()
  for (const model of derived.models) {
    const emittedModel = findEmittedModel(emitted, model.name)
    if (!emittedModel) {
      throw new RelationGraphDivergenceError(
        model.name,
        'the model is missing from the emitted contract',
      )
    }
    found.set(model.name, emittedModel.model)
  }
  for (const model of derived.models) {
    const emittedModel = found.get(model.name)
    if (!emittedModel) continue
    for (const relation of model.relations) {
      assertRelation(emitted, model, relation, emittedModel)
    }
    const derivedNames = new Set(model.relations.map((relation) => relation.name))
    for (const name of Object.keys(emittedModel.relations)) {
      if (!derivedNames.has(name)) {
        throw new RelationGraphDivergenceError(
          `${model.name}.${name}`,
          'the emitted contract carries a relation the config did not derive',
        )
      }
    }
  }
}
