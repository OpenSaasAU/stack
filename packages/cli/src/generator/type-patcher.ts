import type { OpenSaasConfig } from '@opensaas/stack-core'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Patches Prisma's generated types based on field-level type patch configurations
 *
 * This reads Prisma's generated index.d.ts and replaces field types according to
 * the `typePatch` configuration on each field. Fields can specify custom result types
 * that will replace the original Prisma types in query results.
 *
 * The patched types are written to `.opensaas/prisma-client.d.ts` so users can
 * import from there to get the transformed types.
 */
export function patchPrismaTypes(config: OpenSaasConfig, projectRoot: string): void {
  const opensaasPath = config.opensaasPath || '.opensaas'

  // Prisma generates to opensaasPath/prisma-client
  const prismaClientDir = path.join(projectRoot, opensaasPath, 'prisma-client')
  const prismaIndexPath = path.join(prismaClientDir, 'index.d.ts')

  // Check if Prisma types exist
  if (!fs.existsSync(prismaIndexPath)) {
    console.warn(
      '⚠️  Prisma types not found. Run `npx prisma generate` first to generate Prisma Client.',
    )
    return
  }

  // Read original Prisma types
  const originalTypes = fs.readFileSync(prismaIndexPath, 'utf-8')

  // Collect all fields that need type patching
  type FieldPatch = {
    fieldName: string
    resultType: string
    patchScope: 'scalars-only' | 'all'
  }

  const fieldPatches: FieldPatch[] = []

  for (const listConfig of Object.values(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      if (fieldConfig.typePatch) {
        fieldPatches.push({
          fieldName,
          resultType: fieldConfig.typePatch.resultType,
          patchScope: fieldConfig.typePatch.patchScope || 'scalars-only',
        })
      }
    }
  }

  if (fieldPatches.length === 0) {
    // No fields need patching
    return
  }

  // Patch the types
  let patchedTypes = originalTypes

  // For each field that needs patching, replace its type
  for (const { fieldName, resultType, patchScope } of fieldPatches) {
    if (patchScope === 'scalars-only') {
      // Pattern matches: fieldName: <type> ONLY inside scalars: $Extensions.GetPayloadResult<{...}>
      // This ensures we don't patch Input types (UserCreateInput, etc.)
      // Example match:
      // scalars: $Extensions.GetPayloadResult<{
      //   id: string
      //   password: string  ← Replace this
      //   ...
      const pattern = new RegExp(
        `(scalars:\\s*\\$Extensions\\.GetPayloadResult<\\{[^}]*?\\b${fieldName}:\\s*)[^,\\n}]+`,
        'g',
      )

      patchedTypes = patchedTypes.replace(pattern, `$1${resultType}`)
    } else {
      // patchScope === 'all' - patch everywhere the field appears
      // This is more aggressive and will patch input types too
      const pattern = new RegExp(`(\\b${fieldName}:\\s*)[^,\\n}]+`, 'g')
      patchedTypes = patchedTypes.replace(pattern, `$1${resultType}`)
    }
  }

  // Write patched types back to Prisma's index.d.ts
  // This directly modifies the Prisma-generated file with our type patches
  fs.writeFileSync(prismaIndexPath, patchedTypes, 'utf-8')

  console.log(
    `✅ Patched Prisma types (${fieldPatches.length} field${fieldPatches.length === 1 ? '' : 's'})`,
  )
}
