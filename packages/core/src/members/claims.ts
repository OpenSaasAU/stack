/** Name → what claimed it, for one list: the collision backstop the contract and the List member resolver share. */
export type ListMemberClaims = Map<string, string>

export const claimOrigin = {
  field: (fieldKey: string): string => `fields.${fieldKey}`,
  foreignKey: (fieldKey: string): string => `the foreign-key column of fields.${fieldKey}`,
  syntheticBackRelation: (sourceList: string, sourceField: string): string =>
    `the back-relation synthesised for the list-only ref on "${sourceList}.${sourceField}"`,
}

export function startListMemberClaims(timestamps: {
  createdAt: boolean
  updatedAt: boolean
}): ListMemberClaims {
  const claims: ListMemberClaims = new Map([['id', 'the id column']])
  if (timestamps.createdAt) claims.set('createdAt', 'the createdAt auto-timestamp')
  if (timestamps.updatedAt) claims.set('updatedAt', 'the updatedAt auto-timestamp')
  return claims
}

export function claimListMember(
  listKey: string,
  claims: ListMemberClaims,
  name: string,
  origin: string,
): void {
  const existing = claims.get(name)
  if (existing !== undefined) {
    throw new Error(
      `List "${listKey}": ${origin} derives the contract member "${name}", which ${existing} already claims on the same model`,
    )
  }
  claims.set(name, origin)
}
