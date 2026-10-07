const TIMESTAMP_NAMES = new Set(['createdAt', 'updatedAt'])

export function isSystemFieldName(name: string, declaredFields: object): boolean {
  if (name === 'id') return true
  return TIMESTAMP_NAMES.has(name) && !Object.hasOwn(declaredFields, name)
}
