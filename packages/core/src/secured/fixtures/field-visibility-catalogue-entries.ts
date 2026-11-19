// The Field Visibility catalogue's entries: the catalogue observes only these
// names, and the differential requires both replays to observe every one.

export const CATALOGUE_ENTRIES = [
  'bare all() as a member',
  'bare all() as an admin',
  'bare first() anonymously',
  'bare first() under sudo',
  'bare all() on a list with no relations',
  'a rule enumerating its row',
  'select(name, label)',
  'select(note, total) leaves expensive alone',
  'select(orgId, mentorId)',
  'forUpdate().first()',
  'create',
  'update',
  'delete',
  'create on a list the session cannot query',
  'create on a list declaring a relation',
] as const

export type CatalogueEntry = (typeof CATALOGUE_ENTRIES)[number]
