// The closed operator set of the Where vocabulary (ADR-0055). A leaf module so
// both the vocabulary itself and the read-path key validation can name it
// without importing each other.

export const SCALAR_OPERATORS = [
  'equals',
  'not',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
] as const

export const RELATION_QUANTIFIERS = ['some', 'every', 'none'] as const

export type ScalarOperator = (typeof SCALAR_OPERATORS)[number]
export type RelationQuantifier = (typeof RELATION_QUANTIFIERS)[number]

export const SCALAR_OPERATOR_SET: ReadonlySet<string> = new Set(SCALAR_OPERATORS)
export const RELATION_QUANTIFIER_SET: ReadonlySet<string> = new Set(RELATION_QUANTIFIERS)
