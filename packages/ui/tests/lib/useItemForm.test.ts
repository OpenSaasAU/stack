import { describe, it, expect } from 'vitest'
import {
  transformItemFormData,
  transformInitialData,
  getEditableFields,
} from '../../src/lib/useItemForm.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const text = (): SerializableFieldConfig => ({ type: 'text' })
const singleRel = (): SerializableFieldConfig => ({ type: 'relationship', many: false })
const manyRel = (): SerializableFieldConfig => ({ type: 'relationship', many: true })
const password = (): SerializableFieldConfig => ({ type: 'password' })

describe('transformItemFormData', () => {
  it('passes scalar fields through unchanged', () => {
    const fields = { title: text(), views: text() }
    const out = transformItemFormData(fields, { title: 'Hi', views: 3 })
    expect(out).toEqual({ title: 'Hi', views: 3 })
  })

  it('converts a single relationship to connect shape', () => {
    const fields = { author: singleRel() }
    expect(transformItemFormData(fields, { author: 'u1' })).toEqual({
      author: { connect: { id: 'u1' } },
    })
  })

  it('omits an empty single relationship', () => {
    const fields = { author: singleRel() }
    expect(transformItemFormData(fields, { author: '' })).toEqual({})
    expect(transformItemFormData(fields, { author: null })).toEqual({})
  })

  it('converts a many relationship to connect-array shape', () => {
    const fields = { tags: manyRel() }
    expect(transformItemFormData(fields, { tags: ['a', 'b'] })).toEqual({
      tags: { connect: [{ id: 'a' }, { id: 'b' }] },
    })
  })

  it('omits an empty many relationship', () => {
    const fields = { tags: manyRel() }
    expect(transformItemFormData(fields, { tags: [] })).toEqual({})
  })

  it('skips password fields carrying an { isSet } sentinel', () => {
    const fields = { password: password() }
    expect(transformItemFormData(fields, { password: { isSet: true } })).toEqual({})
  })

  it('submits a password when a new plaintext value is provided', () => {
    const fields = { password: password() }
    expect(transformItemFormData(fields, { password: 'secret' })).toEqual({ password: 'secret' })
  })

  it('handles a mixed payload end-to-end', () => {
    const fields = {
      title: text(),
      author: singleRel(),
      tags: manyRel(),
      password: password(),
    }
    const out = transformItemFormData(fields, {
      title: 'Post',
      author: 'u1',
      tags: ['t1'],
      password: { isSet: true },
    })
    expect(out).toEqual({
      title: 'Post',
      author: { connect: { id: 'u1' } },
      tags: { connect: [{ id: 't1' }] },
    })
  })
})

describe('transformInitialData', () => {
  it('applies a field valueForClientSerialization transform', () => {
    const fields = {
      when: {
        type: 'timestamp',
        ui: { valueForClientSerialization: ({ value }: { value: unknown }) => `iso:${value}` },
      },
      title: { type: 'text' },
    }
    const out = transformInitialData(fields, { when: 123, title: 'x' })
    expect(out).toEqual({ when: 'iso:123', title: 'x' })
  })

  it('leaves data unchanged when no transform is defined', () => {
    const fields = { title: { type: 'text' } }
    expect(transformInitialData(fields, { title: 'x' })).toEqual({ title: 'x' })
  })
})

describe('getEditableFields', () => {
  it('drops system fields and preserves declaration order', () => {
    const fields = {
      id: text(),
      title: text(),
      createdAt: text(),
      body: text(),
      updatedAt: text(),
    }
    expect(getEditableFields(fields).map(([k]) => k)).toEqual(['title', 'body'])
  })
})
