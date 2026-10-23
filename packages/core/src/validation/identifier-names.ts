import type { OpenSaasConfig } from '../config/types.js'
import { isRelationshipField } from '../fields/index.js'
import type { ConfigRefusal } from './config-refusal.js'

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function refuseNonIdentifierNames(config: OpenSaasConfig): ConfigRefusal[] {
  const refusals: ConfigRefusal[] = []

  for (const [listKey, listConfig] of Object.entries(config.lists)) {
    if (!IDENTIFIER.test(listKey)) {
      refusals.push({
        listKey,
        entry: 'lists',
        reason: 'non-identifier-name',
        message:
          `List key ${JSON.stringify(listKey)} is not a valid identifier. A list key becomes a contract model ` +
          `name, so it must match ${IDENTIFIER} — rename the list to a PascalCase name such as "Post".`,
      })
    }

    for (const [fieldKey, field] of Object.entries(listConfig.fields)) {
      if (field.virtual || isRelationshipField(field) || !field.getContractField) continue
      let enumName: string | undefined
      try {
        const descriptor = field.getContractField(fieldKey, listKey, config)
        enumName = descriptor.kind === 'column' ? descriptor.enum?.name : undefined
      } catch {
        continue
      }
      if (enumName === undefined || IDENTIFIER.test(enumName)) continue
      refusals.push({
        listKey,
        entry: `fields.${fieldKey}.db.enumName`,
        reason: 'non-identifier-name',
        message:
          `List "${listKey}": the enum name ${JSON.stringify(enumName)} for field "${fieldKey}" is not a valid ` +
          `identifier. It must match ${IDENTIFIER} — set db.enumName on "${fieldKey}" to a name such as "PostStatus".`,
      })
    }
  }

  return refusals
}
