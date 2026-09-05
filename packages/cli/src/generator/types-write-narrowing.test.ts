import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  calendarDay,
  checkbox,
  json,
  password,
  relationship,
  select,
  text,
} from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * The write inputs, against a real emitted contract.
 *
 * #608 recorded two places describing a list's create input and asked for one.
 * There is now one: `CreateInput<Contract, Remainder, 'Event'>` is both the
 * export and the terminal's parameter, and everything in it — which columns
 * exist, what they accept, which are required — is read from the contract
 * except the remainder's own `input` overrides.
 *
 * What is asserted:
 *  - a required column with no default is required on create, and one with a
 *    default is not (#599's `checkbox({ defaultValue: false })` case);
 *  - a system-filled column (`id`, `createdAt`, `updatedAt`) is not writable
 *    at all;
 *  - a field's `input` override wins over its codec (`calendarDay` writes as
 *    a `string`, so a `Date` is a compile error);
 *  - `connect` is offered on the foreign-key-owning side, and the foreign-key
 *    column itself stays writable (ADR-0050);
 *  - update is partial.
 *
 * The `@ts-expect-error` markers make a zero-diagnostic compile the proof:
 * each marker must catch an error, and every other line must type-check.
 */

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    User: { fields: { name: text({ validation: { isRequired: true } }) } },
    Event: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        day: calendarDay(),
        meta: json(),
        secret: password(),
        active: checkbox({ defaultValue: false }),
        status: select({
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Live', value: 'live' },
          ],
          defaultValue: 'draft',
          db: { type: 'enum' },
        }),
        owner: relationship({ ref: 'User' }),
      },
    },
  },
}

describe('write-path narrowing over the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(() => {
    fixture = emitTypeFixture('write-narrowing', config)
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it('accepts every valid write and rejects the narrowed ones', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context, EventCreateInput, EventUpdateInput } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // A required column with no default is required; everything else is optional.
  await context.db.event.create({ data: { title: 't' } })

  // @ts-expect-error \`title\` is non-nullable with no default
  await context.db.event.create({ data: { day: '2026-01-01' } })

  // \`calendarDay\` declares a \`string\` input override; the codec would take more.
  await context.db.event.create({ data: { title: 't', day: '2026-01-01' } })

  // @ts-expect-error a Date is not a calendarDay input
  await context.db.event.create({ data: { title: 't', day: new Date() } })

  // A native enum column is its own value union, from the contract.
  await context.db.event.create({ data: { title: 't', status: 'live' } })

  // @ts-expect-error 'archived' is not one of the declared options
  await context.db.event.create({ data: { title: 't', status: 'archived' } })

  // \`connect\` on the foreign-key-owning side, and the column itself (ADR-0050).
  await context.db.event.create({ data: { title: 't', owner: { connect: { id: 'u1' } } } })
  await context.db.event.create({ data: { title: 't', ownerId: 'u1' } })

  // @ts-expect-error the primary key is system-filled and never writable
  await context.db.event.create({ data: { title: 't', id: 'e1' } })

  // @ts-expect-error \`createdAt\` carries a database default and is never writable
  await context.db.event.create({ data: { title: 't', createdAt: '2026-01-01T00:00:00Z' } })

  // Update is partial, and keeps every narrowing create has.
  await context.db.event.update({ where: { id: 'e1' }, data: { day: '2026-01-02' } })

  // @ts-expect-error a Date is not a calendarDay input on update either
  await context.db.event.update({ where: { id: 'e1' }, data: { day: new Date() } })

  // @ts-expect-error \`titel\` is not a column on this list
  await context.db.event.update({ where: { id: 'e1' }, data: { titel: 't' } })
}

// The standalone export and the terminal's parameter are the same type (#608).
declare const create: EventCreateInput
declare const update: EventUpdateInput
assertType<Exact<Parameters<Context['db']['event']['create']>[0]['data'], EventCreateInput>>()

void run
void create
void update
`)

    expect(output).toBe('')
  })

  it('reads a password column through its output override', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Event } from './.opensaas/types.ts'
import type { HashedPassword } from '@opensaas/stack-core/internal'

// ADR-0029: a field may read differently from its column. The contract knows
// only the codec (text); the remainder carries the override.
assertType<Exact<Event['secret'], HashedPassword>>()
assertType<Exact<Event['active'], boolean>>()
assertType<Exact<Event['status'], 'draft' | 'live'>>()
`)

    expect(output).toBe('')
  })
})
