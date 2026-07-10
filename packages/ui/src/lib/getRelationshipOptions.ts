/**
 * Bounded, projected fetch of `{ id, label }` options for a relationship
 * editor. Re-exported from `@opensaas/stack-core` — the single implementation
 * also backs the `relationshipOptions` context.serverAction op, so a server
 * component with a full context in hand (e.g. `prepareItemForm`) and a client
 * calling through `serverAction` both resolve options identically.
 */
export {
  getRelationshipOptions,
  type RelationshipOption,
  type RelationshipOptionsArgs,
} from '@opensaas/stack-core'
