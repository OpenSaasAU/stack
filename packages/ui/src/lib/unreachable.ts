export const UNREACHABLE_SAVE =
  "Couldn't reach the server. Your changes may or may not have been saved, so reload to check before trying again."

export function unreachableDelete(itemName: string): string {
  return `Couldn't reach the server. The ${itemName} may or may not have been deleted, so reload to check before trying again.`
}
