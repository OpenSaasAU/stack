import { describe, it, expect } from 'vitest'
import { validateDefaultValues } from './default-value.js'
import {
  checkbox,
  integer,
  relationship,
  select,
  text,
  timestamp,
  virtual,
} from '../fields/index.js'
import type { OpenSaasConfig } from '../config/types.js'

function configFor(fields: OpenSaasConfig['lists'][string]['fields']): OpenSaasConfig {
  return { db: { provider: 'postgresql' }, lists: { Thing: { fields } } }
}

describe('validateDefaultValues', () => {
  it('refuses a required text field whose defaultValue is an empty string', () => {
    const config = configFor({
      title: text({ validation: { isRequired: true }, defaultValue: '' }),
    })

    const refusals = validateDefaultValues(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Thing',
      entry: 'fields.title',
      reason: 'default-value-rejected-by-validation',
    })
    expect(refusals[0].message).toContain('List "Thing"')
    expect(refusals[0].message).toContain('fields.title')
    expect(refusals[0].message).toContain('defaultValue')
  })

  it('accepts a required text field whose defaultValue passes its own validation', () => {
    const config = configFor({
      title: text({ validation: { isRequired: true }, defaultValue: 'PLEASE_UPDATE' }),
    })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('refuses an integer field whose defaultValue is below its own minimum', () => {
    const config = configFor({
      quantity: integer({ validation: { isRequired: true, min: 1 }, defaultValue: 0 }),
    })

    const refusals = validateDefaultValues(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Thing',
      entry: 'fields.quantity',
      reason: 'default-value-rejected-by-validation',
    })
  })

  it('accepts an integer field whose defaultValue satisfies its own validation', () => {
    const config = configFor({
      quantity: integer({ validation: { isRequired: true, min: 1 }, defaultValue: 1 }),
    })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('refuses a select field whose defaultValue is not one of its own options', () => {
    const config = configFor({
      status: select({
        validation: { isRequired: true },
        defaultValue: 'unknown',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      }),
    })

    const refusals = validateDefaultValues(config)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatchObject({
      listKey: 'Thing',
      entry: 'fields.status',
      reason: 'default-value-rejected-by-validation',
    })
  })

  it('accepts a select field whose defaultValue is one of its own options', () => {
    const config = configFor({
      status: select({
        validation: { isRequired: true },
        defaultValue: 'draft',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      }),
    })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('accepts a checkbox defaultValue, which its validator never refuses', () => {
    const config = configFor({ isActive: checkbox({ defaultValue: false }) })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('skips the { kind: "now" } sentinel on a timestamp field', () => {
    const config = configFor({
      publishedAt: timestamp({ defaultValue: { kind: 'now' } }),
    })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('skips a field with no defaultValue', () => {
    const config = configFor({ title: text({ validation: { isRequired: true } }) })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('skips a virtual field', () => {
    const config = configFor({
      fullName: virtual({ type: 'string', hooks: { resolveOutput: () => 'x' } }),
    })

    expect(validateDefaultValues(config)).toEqual([])
  })

  it('skips a relationship field', () => {
    const config: OpenSaasConfig = {
      db: { provider: 'postgresql' },
      lists: {
        Thing: { fields: { owner: relationship({ ref: 'Owner' }) } },
        Owner: { fields: { name: text() } },
      },
    }

    expect(validateDefaultValues(config)).toEqual([])
  })
})
