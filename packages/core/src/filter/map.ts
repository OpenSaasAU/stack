import type { FilterCondition, FilterSpec, FilterToken } from './types.js'

/**
 * Map parsed {@link FilterToken}s to a single Prisma `where` fragment, given the
 * fields' {@link FilterSpec}s (ADR-0017).
 *
 * Pure — no DB/Prisma imports. This is the unit-tested half of the filter seam.
 * Tokens combine with implicit AND. A token degrades to free text (never an
 * error) when its field is unknown, has no spec, uses an unsupported operator,
 * has an empty value, or maps to `null`. Bare words (and degraded tokens) are
 * OR-matched across every free-text field, and each such word is ANDed with the
 * rest — so `beta gamma` requires both.
 *
 * @param tokens Parsed tokens from {@link parseFilterQuery}.
 * @param specs  Field-name → Filter spec (from {@link collectFilterSpecs}).
 * @returns A Prisma `where` fragment, or `undefined` when nothing filters.
 */
export function buildFilterWhere(
  tokens: FilterToken[],
  specs: Record<string, FilterSpec>,
): FilterCondition | undefined {
  const andConditions: FilterCondition[] = []
  const freeTextWords: string[] = []

  const freeTextFields = Object.keys(specs).filter((field) => specs[field].freeText)

  for (const token of tokens) {
    // Bare free-text word.
    if (token.field === null) {
      if (token.value) freeTextWords.push(token.value)
      continue
    }

    const spec = specs[token.field]

    // Unknown field / no spec / unsupported operator / empty value →
    // degrade to free text (search the value across free-text fields).
    if (!spec || !spec.operators.includes(token.operator) || token.value === '') {
      if (token.value) freeTextWords.push(token.value)
      continue
    }

    const condition = spec.toCondition(token.operator, token.value)
    if (condition === null) {
      // Value couldn't be interpreted for this field → free text.
      freeTextWords.push(token.value)
      continue
    }

    andConditions.push(condition)
  }

  // Each free-text word: OR across every free-text field's `eq` mapping.
  if (freeTextFields.length > 0) {
    for (const word of freeTextWords) {
      const orConditions = freeTextFields
        .map((field) => specs[field].toCondition('eq', word))
        .filter((condition): condition is FilterCondition => condition !== null)
      if (orConditions.length > 0) {
        andConditions.push(orConditions.length === 1 ? orConditions[0] : { OR: orConditions })
      }
    }
  }

  if (andConditions.length === 0) return undefined
  if (andConditions.length === 1) return andConditions[0]
  return { AND: andConditions }
}
