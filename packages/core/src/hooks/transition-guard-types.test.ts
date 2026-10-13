import { describe, it, expectTypeOf } from 'vitest'
import { list } from '../config/index.js'
import { select } from '../fields/index.js'
import type { SelectField } from '../config/types.js'
import { transitionGuard } from './transition-guard.js'

type OperationRow = { id: string; action: 'EDIT' | 'VOID'; state: 'PREPARED' | 'DISPATCHING' }

type OperationTypeInfo = {
  key: 'Operation'
  fields: {
    action: SelectField<OperationTypeInfo, 'action'>
    state: SelectField<OperationTypeInfo, 'state'>
  }
  item: OperationRow
  inputs: { create: Partial<OperationRow>; update: Partial<OperationRow> }
}

describe('transitionGuard types', () => {
  it('accepts a spec that matches the list', () => {
    const guard = transitionGuard<OperationTypeInfo, 'state', 'action'>({
      field: 'state',
      discriminator: 'action',
      initial: { EDIT: ['PREPARED'] },
      allowed: { EDIT: { PREPARED: ['DISPATCHING'] } },
    })
    expectTypeOf(guard).toBeFunction()
  })

  it('is assignable to a list hooks.validate', () => {
    list<OperationTypeInfo>({
      fields: {
        action: select({ options: [{ label: 'Edit', value: 'EDIT' }] }),
        state: select({ options: [{ label: 'Prepared', value: 'PREPARED' }] }),
      },
      hooks: {
        validate: transitionGuard<OperationTypeInfo, 'state'>({
          field: 'state',
          initial: ['PREPARED'],
          allowed: { PREPARED: ['DISPATCHING'] },
        }),
      },
    })
  })

  it('rejects a misspelled state, key or field', () => {
    transitionGuard<OperationTypeInfo, 'state', 'action'>({
      field: 'state',
      discriminator: 'action',
      // @ts-expect-error PREPAREDD is not a state of the select
      initial: { EDIT: ['PREPAREDD'] },
      allowed: {},
    })
    transitionGuard<OperationTypeInfo, 'state', 'action'>({
      field: 'state',
      discriminator: 'action',
      // @ts-expect-error EDITT is not a value of the discriminator
      initial: { EDITT: ['PREPARED'] },
      allowed: {},
    })
    transitionGuard<OperationTypeInfo, 'state'>({
      // @ts-expect-error stat is not a field of the list
      field: 'stat',
      initial: ['PREPARED'],
      allowed: {},
    })
  })

  it('still works untyped', () => {
    transitionGuard({ field: 'state', initial: ['A'], allowed: { A: ['B'] } })
  })
})
