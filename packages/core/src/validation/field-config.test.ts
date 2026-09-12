import { describe, it, expect } from 'vitest'
import { validateFieldConfig, validateConfigFields } from './field-config.js'
import {
  text,
  integer,
  checkbox,
  timestamp,
  password,
  select,
  json,
  relationship,
  virtual,
} from '../fields/index.js'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'

const CONFIG: OpenSaasConfig = { db: { provider: 'postgresql' }, lists: {} }

describe('validateFieldConfig', () => {
  describe('well-formed fields pass', () => {
    it.each([
      ['text', text()],
      ['integer', integer()],
      ['checkbox', checkbox()],
      ['timestamp', timestamp()],
      ['password', password()],
      ['select', select({ options: [{ label: 'A', value: 'a' }] })],
      ['json', json()],
    ])('a built-in %s field is self-contained', (_name, field) => {
      expect(validateFieldConfig(field as FieldConfig, 'myField', 'MyList', CONFIG)).toEqual([])
    })

    it('a relationship field is self-contained via getContractField alone', () => {
      const field = relationship({ ref: 'User.posts' })
      expect(validateFieldConfig(field as FieldConfig, 'author', 'Post', CONFIG)).toEqual([])
    })

    it('a virtual field is self-contained without a column', () => {
      const field = virtual({
        type: 'string',
        hooks: { resolveOutput: () => 'x' },
      })
      expect(validateFieldConfig(field as FieldConfig, 'fullName', 'User', CONFIG)).toEqual([])
    })
  })

  describe('missing stored-field contract members fail', () => {
    it('reports a missing getContractField naming the list, field, and member', () => {
      const field = text()
      delete field.getContractField

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post', CONFIG)

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        listKey: 'Post',
        fieldKey: 'title',
        fieldType: 'text',
        missingMember: 'getContractField',
      })
      expect(errors[0].message).toContain('Post.title')
      expect(errors[0].message).toContain('getContractField()')
      expect(errors[0].message).toContain('not self-contained')
    })

    it('reports a missing getZodSchema naming the member', () => {
      const field = text()
      delete field.getZodSchema

      const errors = validateFieldConfig(field as FieldConfig, 'title', 'Post', CONFIG)

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('getZodSchema')
      expect(errors[0].message).toContain('getZodSchema')
    })

    it('reports every missing member when a field declares none', () => {
      const field: FieldConfig = { type: 'custom' }

      const errors = validateFieldConfig(field, 'mystery', 'Widget', CONFIG)

      expect(errors.map((e) => e.missingMember).sort()).toEqual([
        'getContractField',
        'getZodSchema',
      ])
      for (const error of errors) {
        expect(error.message).toContain('Widget.mystery')
        expect(error.message).toContain('custom')
      }
    })

    it('names the list and the field in the message', () => {
      const field: FieldConfig = { type: 'custom' }
      const errors = validateFieldConfig(field, 'mystery', 'Widget', CONFIG)
      expect(errors).toHaveLength(2)
      expect(errors[0].listKey).toBe('Widget')
      expect(errors[0].message).toContain('Field "Widget.mystery"')
    })
  })

  describe('relationship and virtual variants', () => {
    it('reports a relationship missing getContractField', () => {
      const field: FieldConfig = { type: 'relationship' }

      const errors = validateFieldConfig(field, 'author', 'Post', CONFIG)

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('getContractField')
      expect(errors[0].message).toContain('Post.author')
    })

    it('reports a virtual field missing outputType and getZodSchema', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }

      const errors = validateFieldConfig(field, 'fullName', 'User', CONFIG)

      expect(errors.map((e) => e.missingMember).sort()).toEqual(['getZodSchema', 'outputType'])
    })

    it('does not require getContractField for virtual fields', () => {
      const field: FieldConfig = { type: 'virtual', virtual: true }
      const errors = validateFieldConfig(field, 'fullName', 'User', CONFIG)
      expect(errors.some((e) => e.missingMember === 'getContractField')).toBe(false)
    })

    /**
     * A virtual field with no `outputType` has no column for the contract to
     * type it from, so the remainder's `computed` entry would be missing and
     * every consumer would see the field as `unknown` (#1292). The gate names
     * it instead.
     */
    it('names outputType, not the type it would have been inferred from', () => {
      const field: FieldConfig = {
        type: 'virtual',
        virtual: true,
        getZodSchema: () => json().getZodSchema!('x', 'create'),
      }

      const errors = validateFieldConfig(field, 'fullName', 'User', CONFIG)

      expect(errors).toHaveLength(1)
      expect(errors[0].missingMember).toBe('outputType')
      expect(errors[0].message).toContain('outputType.')
      expect(errors[0].message).not.toContain('outputType()')
    })
  })

  describe('contract-era fields', () => {
    /**
     * Two columns of different types, which no single column type describes.
     * `getColumnNames` is deliberately absent: the obligation follows the
     * descriptor's `kind`, and a fixture declaring both markers would let the
     * gate read either one and still pass.
     */
    const twoColumns: FieldConfig = {
      type: 'embedding',
      outputType: "import('@opensaas/stack-rag').StoredEmbedding | null",
      getZodSchema: () => json().getZodSchema!('embedding', 'create'),
      getContractField: () => ({
        kind: 'columns',
        columns: [
          {
            name: 'embedding',
            type: { pack: 'pgvector', type: 'Vector', args: [3] },
            nullable: true,
          },
          { name: 'embeddingMetadata', type: { pack: 'pg', type: 'jsonb' }, nullable: true },
        ],
      }),
    }

    /**
     * The converse: one column, but `getColumnNames` present anyway — the
     * shape a builder takes when it declares the member unconditionally and
     * narrows to a single column in some mode. Its codec types it, so no
     * `outputType` is owed.
     */
    const oneColumnWithColumnNames: FieldConfig = {
      type: 'embedding',
      getZodSchema: () => json().getZodSchema!('embedding', 'create'),
      getColumnNames: () => ['embedding'],
      getContractField: () => ({
        kind: 'column',
        name: 'embedding',
        type: { pack: 'pg', type: 'jsonb' },
        nullable: true,
      }),
    }

    it('accepts a multi-column field that declares its own TypeScript face', () => {
      expect(validateFieldConfig(twoColumns, 'embedding', 'Article', CONFIG)).toEqual([])
    })

    it('still requires getZodSchema, which no contract supplies', () => {
      const field: FieldConfig = { ...twoColumns }
      delete field.getZodSchema

      const errors = validateFieldConfig(field, 'embedding', 'Article', CONFIG)

      expect(errors.map((e) => e.missingMember)).toEqual(['getZodSchema'])
    })

    /**
     * A field spanning several columns has no single column to be typed from,
     * so an absent `outputType` leaves it `unknown` everywhere (#1292).
     */
    it('requires outputType from a field whose descriptor spans several columns', () => {
      const field: FieldConfig = { ...twoColumns }
      delete field.outputType

      expect(
        validateFieldConfig(field, 'embedding', 'Article', CONFIG).map((e) => e.missingMember),
      ).toEqual(['outputType'])
    })

    it('does not require outputType from a single-column field that declares getColumnNames', () => {
      expect(oneColumnWithColumnNames.outputType).toBeUndefined()
      expect(validateFieldConfig(oneColumnWithColumnNames, 'embedding', 'Article', CONFIG)).toEqual(
        [],
      )
    })

    it('does not require outputType from a single-column field, whose codec types it', () => {
      expect(text().outputType).toBeUndefined()
      expect(validateFieldConfig(text() as FieldConfig, 'title', 'Post', CONFIG)).toEqual([])
    })

    /**
     * The two fixtures above make the descriptor's `kind` and the optional
     * `getColumnNames` disagree in opposite directions, so a gate reading
     * either one gives a different verdict on each. Reading the proxy would
     * miss `twoColumns` (#1292's hole) and wrongly flag
     * `oneColumnWithColumnNames`.
     */
    it('reads the descriptor rather than getColumnNames, which disagrees with it', () => {
      expect(twoColumns.getColumnNames).toBeUndefined()
      expect(oneColumnWithColumnNames.getColumnNames).toBeTypeOf('function')

      const spanning: FieldConfig = { ...twoColumns }
      delete spanning.outputType

      expect(
        validateFieldConfig(spanning, 'embedding', 'Article', CONFIG).map((e) => e.missingMember),
      ).toEqual(['outputType'])
      expect(validateFieldConfig(oneColumnWithColumnNames, 'embedding', 'Article', CONFIG)).toEqual(
        [],
      )
    })

    /**
     * A `kind: 'computed'` descriptor with no `virtual: true` beside it. Core's
     * `virtual()` sets both, so the two markers agree on every shipped field
     * and neither can be told from the other there; a third-party builder owes
     * only the descriptor. `outputType` is absent, which is the whole question
     * — under a check reading the flag this field falls into the stored branch,
     * is never asked for one, and then emits no column (`deriveContract`'s
     * `case 'computed'`) and lands in none of `computed`/`output`/`input`,
     * vanishing from every consumer's row type (#1292's shape).
     */
    const computedWithoutVirtualFlag: FieldConfig = {
      type: 'fullName',
      getZodSchema: () => json().getZodSchema!('fullName', 'create'),
      getContractField: () => ({ kind: 'computed' }),
    }

    it('requires outputType from a computed descriptor that does not set virtual', () => {
      expect(computedWithoutVirtualFlag.virtual).toBeUndefined()
      expect(computedWithoutVirtualFlag.type).not.toBe('virtual')

      expect(
        validateFieldConfig(computedWithoutVirtualFlag, 'fullName', 'User', CONFIG).map(
          (e) => e.missingMember,
        ),
      ).toEqual(['outputType'])
    })

    it('accepts the same field once it declares its face', () => {
      const field: FieldConfig = { ...computedWithoutVirtualFlag, outputType: 'string' }

      expect(validateFieldConfig(field, 'fullName', 'User', CONFIG)).toEqual([])
    })

    /**
     * The stored branch's own obligation is not owed by a computed field: it
     * has no column, so demanding `getContractField` from a field that returned
     * `computed` from it would be incoherent. Pinned so the fix cannot be
     * mistaken for routing computed fields through the scalar branch.
     */
    it('does not ask a computed field for the stored-scalar members', () => {
      const field: FieldConfig = { ...computedWithoutVirtualFlag }
      delete field.outputType
      delete field.getZodSchema

      expect(
        validateFieldConfig(field, 'fullName', 'User', CONFIG).map((e) => e.missingMember),
      ).toEqual(['outputType', 'getZodSchema'])
    })

    /**
     * `getContractField` is a field's refusal seam (`embedding()` throws out of
     * it for an impossible `dimensions`). This gate is the first step
     * `opensaas generate` runs, ahead of the config-surface step that reports
     * such a throw, so it must not propagate one.
     */
    describe('a field whose descriptor throws', () => {
      const refusing: FieldConfig = {
        type: 'embedding',
        outputType: 'string',
        getZodSchema: () => json().getZodSchema!('embedding', 'create'),
        getContractField: () => {
          throw new Error('embedding "Article.embedding": dimensions must be at most 2000')
        },
      }

      it('does not escape validateFieldConfig', () => {
        expect(() => validateFieldConfig(refusing, 'embedding', 'Article', CONFIG)).not.toThrow()
        expect(validateFieldConfig(refusing, 'embedding', 'Article', CONFIG)).toEqual([])
      })

      it('does not escape validateConfigFields, which the generate path runs', () => {
        const config: OpenSaasConfig = {
          db: { provider: 'postgresql' },
          lists: { Article: { fields: { embedding: refusing } } },
        }

        expect(() => validateConfigFields(config)).not.toThrow()
        expect(validateConfigFields(config)).toEqual([])
      })
    })
  })
})

describe('validateConfigFields', () => {
  it('returns no errors for a fully compliant config', () => {
    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
      },
      lists: {
        User: {
          fields: {
            name: text({ validation: { isRequired: true } }),
            posts: relationship({ ref: 'Post.author', many: true }),
          },
        },
        Post: {
          fields: {
            title: text(),
            author: relationship({ ref: 'User.posts' }),
          },
        },
      },
    }

    expect(validateConfigFields(config)).toEqual([])
  })

  it('collects per-field errors across every list and names each location', () => {
    const brokenTitle = text()
    delete brokenTitle.getContractField

    const brokenName = text()
    delete brokenName.getZodSchema

    const config: OpenSaasConfig = {
      db: {
        provider: 'postgresql',
      },
      lists: {
        User: {
          fields: {
            name: brokenName,
          },
        },
        Post: {
          fields: {
            title: brokenTitle,
          },
        },
      },
    }

    const errors = validateConfigFields(config)

    expect(errors).toHaveLength(2)
    const byField = Object.fromEntries(errors.map((e) => [`${e.listKey}.${e.fieldKey}`, e]))
    expect(byField['User.name'].missingMember).toBe('getZodSchema')
    expect(byField['Post.title'].missingMember).toBe('getContractField')
  })

  /**
   * The config is what makes the descriptor readable, so the `columns`
   * requirement is only reachable through this entry point.
   */
  it('reads the descriptor it is given the config for', () => {
    const spanning: FieldConfig = {
      type: 'spanning',
      getZodSchema: () => json().getZodSchema!('spanning', 'create'),
      getContractField: () => ({
        kind: 'columns',
        columns: [
          { name: 'spanning_a', type: { pack: 'pg', type: 'text' }, nullable: true },
          { name: 'spanning_b', type: { pack: 'pg', type: 'int' }, nullable: true },
        ],
      }),
    }

    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: { Article: { fields: { spanning } } },
    }

    expect(validateConfigFields(config).map((e) => [e.fieldKey, e.missingMember])).toEqual([
      ['spanning', 'outputType'],
    ])
  })
})
