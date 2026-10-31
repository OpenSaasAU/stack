import { createHash } from 'node:crypto'
import type { CleanedWhere } from 'better-auth/adapters'

export type ForcedIdStrategy = 'uuid7' | 'cuid2'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUID2 = /^[a-z][a-z0-9]{23}$/
const IDENTITY_OPERATORS: ReadonlySet<CleanedWhere['operator']> = new Set([
  'eq',
  'ne',
  'in',
  'not_in',
])
const NAMESPACE = Buffer.from('6f1b6c52a3d44e0f9b7e2c58d4a1e390', 'hex')

function uuidV5(name: string): string {
  const bytes = createHash('sha1').update(NAMESPACE).update(name).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function cuidShaped(name: string): string {
  return `c${createHash('sha256').update(name).digest('hex').slice(0, 23)}`
}

export function fitIdToStrategy(strategy: ForcedIdStrategy, id: string): string {
  if (strategy === 'uuid7') return UUID.test(id) ? id : uuidV5(id)
  return CUID2.test(id) ? id : cuidShaped(id)
}

export function fitWhereIds(
  strategy: ForcedIdStrategy,
  where: readonly CleanedWhere[],
): readonly CleanedWhere[] {
  return where.map((clause) => {
    if (clause.field !== 'id' || !IDENTITY_OPERATORS.has(clause.operator)) return clause
    const { value } = clause
    if (typeof value === 'string') return { ...clause, value: fitIdToStrategy(strategy, value) }
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      return { ...clause, value: value.map((entry) => fitIdToStrategy(strategy, entry)) }
    }
    return clause
  })
}
