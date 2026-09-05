import type { ContractData } from '@opensaas/stack-core'

/** What {@link seedExtensionContractSpaces} did, for the generator to report. */
export interface SeededExtensionSpaces {
  /** The packs whose contract space was materialised. */
  seeded: string[]
}

/**
 * Materialise each declared extension pack's **Extension contract space**
 * under the project's `migrations/` directory, between writing the Contract
 * module and shelling to `prisma contract emit` (ADR-0065).
 *
 * **This is a seam, not an implementation.** #1135 owns the seeding itself:
 * calling the toolchain's public seed phase for every pack in
 * `data.extensions`, so `db update` and `db migrate` never refuse a
 * declared-but-unmigrated space, and so a pack upgrade shows up as a generate
 * diff. Until then this is a no-op that reports nothing seeded, and
 * `migrations/` stays gitignored.
 */
export function seedExtensionContractSpaces(
  _cwd: string,
  _data: ContractData,
): SeededExtensionSpaces {
  return { seeded: [] }
}
