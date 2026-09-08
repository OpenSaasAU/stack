import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  transformItemFormData,
  transformInitialData,
  getEditableFields,
  PARTIAL_SAVE_PREFIX,
  UnwritableRelationshipError,
  useItemForm,
} from '../../src/lib/useItemForm.js'
import type { SerializableFieldConfig } from '../../src/lib/serializeFieldConfig.js'

const text = (): SerializableFieldConfig => ({ type: 'text' })
const singleRel = (): SerializableFieldConfig => ({ type: 'relationship', many: false })
const manyRel = (): SerializableFieldConfig => ({ type: 'relationship', many: true })
/** A to-many as `prepareItemForm` hands it to the form: rendered read-only. */
const readOnlyManyRel = (): SerializableFieldConfig => ({
  type: 'relationship',
  many: true,
  readOnly: true,
  readOnlyReason: 'Not editable here — the related record holds this link.',
})
const password = (): SerializableFieldConfig => ({ type: 'password' })
const virtual = (): SerializableFieldConfig => ({ type: 'virtual', virtual: true })

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

  it('sends nothing for a relationship the form rendered read-only', () => {
    // ADR-0050: an edge is a foreign-key assignment, and a to-many's key lives
    // on the related list. The value here is the one the server sent — a
    // read-only control never calls `onChange` — so nothing of the user's is
    // lost by omitting it.
    const fields = { tags: readOnlyManyRel() }
    expect(transformItemFormData(fields, { tags: ['a', 'b'] })).toEqual({})
  })

  it('refuses a to-many selection rather than discarding it when no control marked it read-only', () => {
    // The regression this guards: the field rendered as an editable, populated
    // multi-select, the selection vanished from the payload, and the save
    // reported success. Whatever else happens, the user must be told.
    const fields = { title: text(), tags: manyRel() }
    expect(() => transformItemFormData(fields, { title: 'Hi', tags: ['a', 'b'] })).toThrow(
      UnwritableRelationshipError,
    )
    expect(() => transformItemFormData(fields, { title: 'Hi', tags: ['a', 'b'] })).toThrow(/"tags"/)
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

  it('drops a key with no corresponding field config (e.g. a synthetic `_count`)', () => {
    const fields = { title: text() }
    expect(transformItemFormData(fields, { title: 'Hi', _count: { comments: 3 } })).toEqual({
      title: 'Hi',
    })
  })

  it('drops a virtual field key even when a value for it is present (defence-in-depth)', () => {
    const fields = { title: text(), fullName: virtual() }
    expect(transformItemFormData(fields, { title: 'Hi', fullName: 'Ada Lovelace' })).toEqual({
      title: 'Hi',
    })
  })

  it('handles a mixed payload end-to-end', () => {
    const fields = {
      title: text(),
      author: singleRel(),
      tags: readOnlyManyRel(),
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

  it('keeps virtual fields by default (update mode) so they render read-only', () => {
    const fields = { title: text(), fullName: virtual() }
    expect(getEditableFields(fields).map(([k]) => k)).toEqual(['title', 'fullName'])
  })

  it('keeps virtual fields for update mode explicitly', () => {
    const fields = { title: text(), fullName: virtual() }
    expect(getEditableFields(fields, 'update').map(([k]) => k)).toEqual(['title', 'fullName'])
  })

  it('drops virtual fields for create mode — there is no item yet to compute a value from', () => {
    const fields = { title: text(), fullName: virtual() }
    expect(getEditableFields(fields, 'create').map(([k]) => k)).toEqual(['title'])
  })

  it('keeps a read-only field in both modes, so the form can show why it is not editable', () => {
    // Dropping it would leave the user with no field and no explanation for
    // where it went. `FieldRenderer` renders it read-only with its reason.
    const fields = { title: text(), tags: readOnlyManyRel() }
    expect(getEditableFields(fields, 'create').map(([k]) => k)).toEqual(['title', 'tags'])
    expect(getEditableFields(fields, 'update').map(([k]) => k)).toEqual(['title', 'tags'])
  })
})

/**
 * The framework hands a read-only field's control `mode="read"`, but nothing
 * makes a third-party component honour it (`ui.component`,
 * `registerFieldComponent`). One that calls `onChange` anyway must not be able
 * to put a value into `formData` that the submit transform then drops: that is
 * a selection shown as accepted and discarded at save, reported as success —
 * the exact failure the read-only marking exists to stop.
 */
describe('useItemForm handleFieldChange', () => {
  const submitted: Array<Record<string, unknown>> = []
  const onSubmit = async (data: Record<string, unknown>) => {
    submitted.push(data)
    return { success: true } as const
  }

  it('ignores a change for a read-only field, so a rogue control cannot stage a lost value', async () => {
    submitted.length = 0
    const fields = { title: text(), tags: readOnlyManyRel() }
    const { result } = renderHook(() =>
      useItemForm({ fields, initialData: { tags: ['stored'] }, mode: 'update', onSubmit }),
    )

    act(() => {
      result.current.handleFieldChange('title', 'Hi')
      result.current.handleFieldChange('tags', ['a', 'b'])
    })

    // The control still shows what the server sent — the selection was refused
    // on screen, not accepted and dropped later.
    expect(result.current.formData).toEqual({ title: 'Hi', tags: ['stored'] })

    await act(async () => {
      result.current.handleSubmit({ preventDefault: () => {} })
    })

    expect(submitted).toEqual([{ title: 'Hi' }])
  })

  it('ignores a change for a virtual field', () => {
    const fields = { title: text(), fullName: virtual() }
    const { result } = renderHook(() =>
      useItemForm({ fields, initialData: { fullName: 'Ada Lovelace' }, mode: 'update', onSubmit }),
    )

    act(() => {
      result.current.handleFieldChange('fullName', 'Grace Hopper')
    })

    expect(result.current.formData).toEqual({ fullName: 'Ada Lovelace' })
  })

  it('accepts a change for a writable field', () => {
    const fields = { title: text(), author: singleRel() }
    const { result } = renderHook(() => useItemForm({ fields, mode: 'create', onSubmit }))

    act(() => {
      result.current.handleFieldChange('author', 'u1')
    })

    expect(result.current.formData).toEqual({ author: 'u1' })
  })
})

describe('a record update that fails after its edges landed', () => {
  const edgeWriting = (): SerializableFieldConfig => ({
    type: 'relationship',
    many: true,
    edgeWrite: { relatedListKey: 'Post', backReferenceField: 'author' },
  })

  const fields = { title: text(), posts: edgeWriting() }

  it('says the save was partial rather than reporting a plain failure', async () => {
    const onEdgeWrites = async () => ({ persisted: { posts: ['p1'] }, errors: [] })
    const { result } = renderHook(() =>
      useItemForm({
        fields,
        initialData: { posts: [] },
        mode: 'update',
        onEdgeWrites,
        onSubmit: async () => ({ success: false, error: 'Access denied' }) as const,
      }),
    )

    act(() => {
      result.current.handleFieldChange('posts', ['p1'])
    })
    await act(async () => {
      result.current.handleSubmit({ preventDefault: () => {} })
    })

    expect(result.current.generalError).toBe(`${PARTIAL_SAVE_PREFIX} Access denied`)
  })

  it('reports a plain failure when there were no edges to commit', async () => {
    const { result } = renderHook(() =>
      useItemForm({
        fields,
        initialData: { posts: [] },
        mode: 'update',
        onEdgeWrites: async () => ({ persisted: {}, errors: [] }),
        onSubmit: async () => ({ success: false, error: 'Access denied' }) as const,
      }),
    )

    act(() => {
      result.current.handleFieldChange('title', 'Hi')
    })
    await act(async () => {
      result.current.handleSubmit({ preventDefault: () => {} })
    })

    expect(result.current.generalError).toBe('Access denied')
  })

  it('says the same when the update throws', async () => {
    const { result } = renderHook(() =>
      useItemForm({
        fields,
        initialData: { posts: [] },
        mode: 'update',
        onEdgeWrites: async () => ({ persisted: { posts: ['p1'] }, errors: [] }),
        onSubmit: async () => {
          throw new Error('Network down')
        },
      }),
    )

    act(() => {
      result.current.handleFieldChange('posts', ['p1'])
    })
    await act(async () => {
      result.current.handleSubmit({ preventDefault: () => {} })
    })

    expect(result.current.generalError).toBe(`${PARTIAL_SAVE_PREFIX} Network down`)
  })
})
