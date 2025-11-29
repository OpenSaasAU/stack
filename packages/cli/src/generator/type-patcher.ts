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

  type VirtualFieldPatch = {
    listName: string
    fieldName: string
    fieldType: string
  }

  const fieldPatches: FieldPatch[] = []
  const virtualFieldPatches: VirtualFieldPatch[] = []

  for (const [listName, listConfig] of Object.entries(config.lists)) {
    for (const [fieldName, fieldConfig] of Object.entries(listConfig.fields)) {
      // Collect virtual fields for adding to Prisma payload types
      if (fieldConfig.virtual && 'outputType' in fieldConfig) {
        virtualFieldPatches.push({
          listName,
          fieldName,
          fieldType: fieldConfig.outputType,
        })
      }

      // Collect fields with explicit type patches
      if (fieldConfig.typePatch) {
        fieldPatches.push({
          fieldName,
          resultType: fieldConfig.typePatch.resultType,
          patchScope: fieldConfig.typePatch.patchScope || 'scalars-only',
        })
      }
    }
  }

  if (fieldPatches.length === 0 && virtualFieldPatches.length === 0) {
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

  // Add virtual fields to Prisma Payload types
  // Virtual fields are injected into the scalars object of each list's $Payload type
  for (const { listName, fieldName, fieldType } of virtualFieldPatches) {
    // Find the list's Payload definition and inject the virtual field into scalars
    // Pattern: export type UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    //   name: 'User'
    //   objects: {...}
    //   scalars: $Extensions.GetPayloadResult<{
    //     id: string
    //     name: string
    //     ← Insert virtual field here
    //   }, ExtArgs['result']['user']>
    //   composites: {}
    // }

    // We need to add the virtual field right before the closing brace of the scalars object
    // Find the pattern for this specific list's scalars
    const scalarPattern = new RegExp(
      `(export type ${listName}Payload[^{]*\\{[^}]*scalars:\\s*\\$Extensions\\.GetPayloadResult<\\{[^}]*)(\\s*\\},\\s*ExtArgs\\['result'\\]\\['${listName.toLowerCase()}'\\]>)`,
      'gs',
    )

    patchedTypes = patchedTypes.replace(scalarPattern, `$1\n    ${fieldName}: ${fieldType}$2`)
  }

  // Write patched types back to Prisma's index.d.ts
  // This directly modifies the Prisma-generated file with our type patches
  fs.writeFileSync(prismaIndexPath, patchedTypes, 'utf-8')

  const totalPatches = fieldPatches.length + virtualFieldPatches.length
  console.log(`✅ Patched Prisma types (${totalPatches} field${totalPatches === 1 ? '' : 's'})`)
}
