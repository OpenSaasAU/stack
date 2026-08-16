import { describe, it, expect } from 'vitest'
import { convertTableToList, convertBetterAuthSchema } from '../src/server/schema-converter.js'

describe('convertTableToList', () => {
  it('should convert string fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        name: { type: 'string', required: true },
        bio: { type: 'string' },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields).toHaveProperty('name')
    expect(listConfig.fields).toHaveProperty('bio')
    expect(listConfig.fields.name.type).toBe('text')
    expect(listConfig.fields.name.validation?.isRequired).toBe(true)
    expect(listConfig.fields.bio.validation?.isRequired).toBeUndefined()
  })

  it('should convert number fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        age: { type: 'number', required: true },
        score: { type: 'number', defaultValue: 0 },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields.age.type).toBe('integer')
    expect(listConfig.fields.age.validation?.isRequired).toBe(true)
    expect(listConfig.fields.score.defaultValue).toBe(0)
  })

  it('should convert boolean fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        active: { type: 'boolean', defaultValue: true },
        verified: { type: 'boolean' },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields.active.type).toBe('checkbox')
    expect(listConfig.fields.active.defaultValue).toBe(true)
    expect(listConfig.fields.verified.type).toBe('checkbox')
  })

  it('should convert date fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        expiresAt: { type: 'date' },
        createdOn: { type: 'date', defaultValue: 'now' },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields.expiresAt.type).toBe('timestamp')
    expect(listConfig.fields.createdOn.type).toBe('timestamp')
    expect(listConfig.fields.createdOn.defaultValue).toEqual({ kind: 'now' })
  })

  it('should handle unique fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        email: { type: 'string', unique: true },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields.email.isIndexed).toBe('unique')
  })

  it('should skip system fields', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        id: { type: 'string', required: true },
        name: { type: 'string' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    // System fields should be skipped
    expect(listConfig.fields).not.toHaveProperty('id')
    expect(listConfig.fields).not.toHaveProperty('createdAt')
    expect(listConfig.fields).not.toHaveProperty('updatedAt')
    // Regular fields should be included
    expect(listConfig.fields).toHaveProperty('name')
  })

  it('should handle reference fields as text', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        userId: {
          type: 'string',
          required: true,
          references: {
            model: 'User',
            field: 'id',
          },
        },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    expect(listConfig.fields).toHaveProperty('userId')
    expect(listConfig.fields.userId.type).toBe('text')
    expect(listConfig.fields.userId.validation?.isRequired).toBe(true)
  })

  it('should handle unknown field types', () => {
    const tableSchema = {
      modelName: 'TestTable',
      fields: {
        customField: { type: 'unknown-type' },
      },
    }

    const listConfig = convertTableToList('test_table', tableSchema)

    // Should default to text
    expect(listConfig.fields.customField.type).toBe('text')
  })

  it('should ship the User table closed (no access control) per ADR-0013', () => {
    const tableSchema = {
      modelName: 'User',
      fields: {
        name: { type: 'string' },
      },
    }

    const listConfig = convertTableToList('user', tableSchema)

    expect(listConfig.access).toBeUndefined()
  })

  it('should ship the Session table closed (no access control) per ADR-0013', () => {
    const tableSchema = {
      modelName: 'Session',
      fields: {
        token: { type: 'string' },
      },
    }

    const listConfig = convertTableToList('session', tableSchema)

    expect(listConfig.access).toBeUndefined()
  })

  it('should ship the Verification table closed (no access control) per ADR-0013', () => {
    const tableSchema = {
      modelName: 'Verification',
      fields: {
        value: { type: 'string' },
      },
    }

    const listConfig = convertTableToList('verification', tableSchema)

    expect(listConfig.access).toBeUndefined()
  })

  it('should ship unknown tables closed (no access control)', () => {
    const tableSchema = {
      modelName: 'UnknownTable',
      fields: {
        data: { type: 'string' },
      },
    }

    const listConfig = convertTableToList('unknown_table', tableSchema)

    expect(listConfig.access).toBeUndefined()
  })

  it('should ship OAuth application table closed (no access control)', () => {
    const tableSchema = {
      modelName: 'OAuthApplication',
      fields: {
        clientId: { type: 'string', required: true },
        userId: { type: 'string', required: true },
      },
    }

    const listConfig = convertTableToList('oauthapplication', tableSchema)

    expect(listConfig.access).toBeUndefined()
  })
})

describe('convertBetterAuthSchema', () => {
  it('should convert multiple tables', () => {
    const schema = {
      user: {
        modelName: 'User',
        fields: {
          name: { type: 'string' },
        },
      },
      session: {
        modelName: 'Session',
        fields: {
          token: { type: 'string' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema)

    expect(lists).toHaveProperty('User')
    expect(lists).toHaveProperty('Session')
  })

  it('should use modelName for list key', () => {
    const schema = {
      custom_table: {
        modelName: 'CustomTable',
        fields: {
          data: { type: 'string' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema)

    expect(lists).toHaveProperty('CustomTable')
    expect(lists).not.toHaveProperty('custom_table')
  })

  it('should convert snake_case to PascalCase if no modelName', () => {
    const schema = {
      oauth_application: {
        modelName: '',
        fields: {
          data: { type: 'string' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema)

    expect(lists).toHaveProperty('OauthApplication')
  })

  it('should handle empty schema', () => {
    const lists = convertBetterAuthSchema({})

    expect(lists).toEqual({})
  })

  it('should resolve a base-model table against the configured baseModelKeys remap instead of the table name', () => {
    const schema = {
      user: {
        modelName: '',
        fields: {
          isAnonymous: { type: 'boolean' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema, { user: 'AuthUser' })

    expect(lists).toHaveProperty('AuthUser')
    expect(lists).not.toHaveProperty('User')
    expect(lists.AuthUser.fields).toHaveProperty('isAnonymous')
  })

  it('should prefer the baseModelKeys remap over an explicit tableSchema.modelName', () => {
    const schema = {
      user: {
        modelName: 'User',
        fields: {
          isAnonymous: { type: 'boolean' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema, { user: 'AuthUser' })

    expect(lists).toHaveProperty('AuthUser')
    expect(lists).not.toHaveProperty('User')
  })

  it('should resolve a rateLimit table (case-insensitively) against the configured baseModelKeys remap (issue #909)', () => {
    const schema = {
      rateLimit: {
        modelName: '',
        fields: {
          customField: { type: 'boolean' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema, { rateLimit: 'AuthRateLimit' })

    expect(lists).toHaveProperty('AuthRateLimit')
    expect(lists).not.toHaveProperty('RateLimit')
    expect(lists.AuthRateLimit.fields).toHaveProperty('customField')
  })

  it('should leave non-base tables unaffected by baseModelKeys', () => {
    const schema = {
      oauth_application: {
        modelName: '',
        fields: {
          data: { type: 'string' },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema, { user: 'AuthUser' })

    expect(lists).toHaveProperty('OauthApplication')
  })

  it('should convert complex schema with multiple field types', () => {
    const schema = {
      test_table: {
        modelName: 'TestTable',
        fields: {
          name: { type: 'string', required: true },
          age: { type: 'number', defaultValue: 0 },
          active: { type: 'boolean', defaultValue: true },
          expiresAt: { type: 'date', defaultValue: 'now' },
          userId: {
            type: 'string',
            references: { model: 'User', field: 'id' },
          },
        },
      },
    }

    const lists = convertBetterAuthSchema(schema)

    expect(lists.TestTable.fields).toHaveProperty('name')
    expect(lists.TestTable.fields).toHaveProperty('age')
    expect(lists.TestTable.fields).toHaveProperty('active')
    expect(lists.TestTable.fields).toHaveProperty('expiresAt')
    expect(lists.TestTable.fields).toHaveProperty('userId')
  })
})
