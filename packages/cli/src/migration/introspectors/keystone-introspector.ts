/**
 * KeystoneJS Config Introspector
 *
 * Loads keystone.config.ts using jiti and extracts list definitions.
 * KeystoneJS → OpenSaaS migration is mostly 1:1.
 */

import path from 'path'
import fs from 'fs-extra'
import { createJiti } from 'jiti'
import type { IntrospectedSchema, IntrospectedModel, IntrospectedField } from '../types.js'

export interface KeystoneList {
  name: string
  fields: KeystoneField[]
  access?: Record<string, unknown>
  hooks?: Record<string, unknown>
}

export interface KeystoneField {
  name: string
  type: string
  options?: Record<string, unknown>
}

export interface KeystoneSchema {
  lists: KeystoneList[]
  db?: {
    provider: string
    url?: string
  }
}

export class KeystoneIntrospector {
  /**
   * Introspect a KeystoneJS config file
   */
  async introspect(cwd: string, configPath: string = 'keystone.config.ts'): Promise<IntrospectedSchema> {
    const fullPath = path.isAbsolute(configPath) ? configPath : path.join(cwd, configPath)

    // Try alternative paths
    const paths = [
      fullPath,
      path.join(cwd, 'keystone.ts'),
      path.join(cwd, 'keystone.config.js'),
    ]

    let foundPath: string | undefined
    for (const p of paths) {
      if (await fs.pathExists(p)) {
        foundPath = p
        break
      }
    }

    if (!foundPath) {
      throw new Error(`KeystoneJS config not found. Tried: ${paths.join(', ')}`)
    }

    try {
      // Use jiti to load TypeScript config
      const jiti = createJiti(import.meta.url, {
        interopDefault: true,
        moduleCache: false,
      })

      const configModule = await jiti.import(foundPath) as { default?: unknown } | unknown
      const config = (typeof configModule === 'object' && configModule !== null && 'default' in configModule)
        ? configModule.default
        : configModule

      const keystoneSchema = this.parseConfig(config)

      // Convert KeystoneSchema to IntrospectedSchema
      return this.convertToIntrospectedSchema(keystoneSchema)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to load KeystoneJS config: ${message}`)
    }
  }

  /**
   * Parse the loaded KeystoneJS config object
   */
  private parseConfig(config: unknown): KeystoneSchema {
    const result: KeystoneSchema = {
      lists: [],
    }

    if (typeof config !== 'object' || config === null) {
      return result
    }

    const configObj = config as Record<string, unknown>

    // Extract database config
    if (configObj.db && typeof configObj.db === 'object' && configObj.db !== null) {
      const db = configObj.db as Record<string, unknown>
      result.db = {
        provider: typeof db.provider === 'string' ? db.provider : 'unknown',
        url: typeof db.url === 'string' ? db.url : undefined,
      }
    }

    // Extract lists
    if (configObj.lists && typeof configObj.lists === 'object' && configObj.lists !== null) {
      for (const [name, listDef] of Object.entries(configObj.lists)) {
        const list = this.parseList(name, listDef)
        result.lists.push(list)
      }
    }

    return result
  }

  /**
   * Parse a single list definition
   */
  private parseList(name: string, listDef: unknown): KeystoneList {
    const list: KeystoneList = {
      name,
      fields: [],
    }

    if (typeof listDef !== 'object' || listDef === null) {
      return list
    }

    const listDefObj = listDef as Record<string, unknown>

    // Extract fields
    if (listDefObj.fields && typeof listDefObj.fields === 'object' && listDefObj.fields !== null) {
      for (const [fieldName, fieldDef] of Object.entries(listDefObj.fields)) {
        const field = this.parseField(fieldName, fieldDef)
        list.fields.push(field)
      }
    }

    // Store access and hooks for reference (not used in migration but useful)
    if (listDefObj.access && typeof listDefObj.access === 'object') {
      list.access = listDefObj.access as Record<string, unknown>
    }
    if (listDefObj.hooks && typeof listDefObj.hooks === 'object') {
      list.hooks = listDefObj.hooks as Record<string, unknown>
    }

    return list
  }

  /**
   * Parse a single field definition
   */
  private parseField(name: string, fieldDef: unknown): KeystoneField {
    // KeystoneJS fields are objects with a type property or function results
    let type = 'unknown'
    let options: Record<string, unknown> = {}

    if (typeof fieldDef === 'object' && fieldDef !== null) {
      const fieldDefObj = fieldDef as Record<string, unknown>

      // Check for common field type patterns
      if (typeof fieldDefObj.type === 'string') {
        type = fieldDefObj.type
      } else if (typeof fieldDefObj._type === 'string') {
        type = fieldDefObj._type
      } else if (fieldDefObj.constructor && typeof fieldDefObj.constructor === 'object' && fieldDefObj.constructor !== null) {
        const constructor = fieldDefObj.constructor as Record<string, unknown>
        if (typeof constructor.name === 'string') {
          type = constructor.name
        }
      }

      // Extract common options
      if (fieldDefObj.validation !== undefined) options.validation = fieldDefObj.validation
      if (fieldDefObj.defaultValue !== undefined) options.defaultValue = fieldDefObj.defaultValue
      if (fieldDefObj.isRequired !== undefined) options.isRequired = fieldDefObj.isRequired
      if (fieldDefObj.ref !== undefined) options.ref = fieldDefObj.ref
      if (fieldDefObj.many !== undefined) options.many = fieldDefObj.many
    }

    return { name, type, options }
  }

  /**
   * Convert KeystoneSchema to IntrospectedSchema format
   */
  private convertToIntrospectedSchema(keystoneSchema: KeystoneSchema): IntrospectedSchema {
    const models: IntrospectedModel[] = keystoneSchema.lists.map(list => {
      const fields: IntrospectedField[] = list.fields.map(field => {
        const isRelationship = field.type.toLowerCase() === 'relationship'
        const isRequired = field.options?.isRequired === true

        const introspectedField: IntrospectedField = {
          name: field.name,
          type: field.type,
          isRequired,
          isUnique: false, // KeystoneJS doesn't expose this easily
          isId: field.name === 'id',
          isList: field.options?.many === true,
        }

        if (field.options?.defaultValue !== undefined) {
          introspectedField.defaultValue = String(field.options.defaultValue)
        }

        if (isRelationship && field.options?.ref) {
          const ref = String(field.options.ref)
          const [model, fieldName] = ref.split('.')

          introspectedField.relation = {
            name: '',
            model,
            fields: [],
            references: fieldName ? [fieldName] : [],
          }
        }

        return introspectedField
      })

      return {
        name: list.name,
        fields,
        hasRelations: fields.some(f => f.relation !== undefined),
        primaryKey: 'id',
      }
    })

    return {
      provider: keystoneSchema.db?.provider || 'unknown',
      models,
      enums: [], // KeystoneJS doesn't have enums in the same way
    }
  }

  /**
   * Map KeystoneJS field type to OpenSaaS equivalent
   */
  mapKeystoneTypeToOpenSaas(keystoneType: string): { type: string; import: string } {
    // KeystoneJS → OpenSaaS is mostly 1:1
    const mappings: Record<string, { type: string; import: string }> = {
      'text': { type: 'text', import: 'text' },
      'integer': { type: 'integer', import: 'integer' },
      'float': { type: 'float', import: 'float' },
      'checkbox': { type: 'checkbox', import: 'checkbox' },
      'timestamp': { type: 'timestamp', import: 'timestamp' },
      'select': { type: 'select', import: 'select' },
      'relationship': { type: 'relationship', import: 'relationship' },
      'password': { type: 'password', import: 'password' },
      'json': { type: 'json', import: 'json' },
      // Storage field types (from @opensaas/stack-storage)
      'image': { type: 'image', import: 'image' },
      'file': { type: 'file', import: 'file' },
      // Virtual/computed fields
      'virtual': { type: 'virtual', import: 'virtual' },
      // Other field types
      'calendarDay': { type: 'timestamp', import: 'timestamp' },
    }

    const lower = keystoneType.toLowerCase()
    return mappings[lower] || { type: 'text', import: 'text' }
  }

  /**
   * Get warnings for unsupported features
   */
  getWarnings(schema: IntrospectedSchema): string[] {
    const warnings: string[] = []
    const hasFileOrImageFields = schema.models.some(model =>
      model.fields.some(field => ['image', 'file'].includes(field.type.toLowerCase()))
    )
    const hasVirtualFields = schema.models.some(model =>
      model.fields.some(field => field.type.toLowerCase() === 'virtual')
    )

    // Add storage configuration reminder if file/image fields are present
    if (hasFileOrImageFields) {
      warnings.push("Your schema uses file/image fields - you'll need to configure storage providers in your OpenSaaS config")
    }

    // Add virtual field migration reminder
    if (hasVirtualFields) {
      warnings.push("Your schema uses virtual fields - you'll need to manually migrate the resolveOutput hooks to compute field values")
    }

    return warnings
  }
}
