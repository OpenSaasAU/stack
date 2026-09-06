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
 *  - update is partial;
 *  - every write terminal admits silent denial — `create` is `| null`, and the
 *    per-item batches carry `null` in a denied item's position.
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
    // ADR-0058's criterion needs a to-one whose foreign key is NOT nullable,
    // so the arity rule can be told apart from a nullability-driven one.
    Booking: {
      fields: {
        host: relationship({ ref: 'User', db: { isNullable: false } }),
      },
    },
  },
}

describe('write-path narrowing over the emitted contract', () => {
  let fixture: TypeFixture

  beforeAll(async () => {
    fixture = await emitTypeFixture('write-narrowing', config)
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

  it('admits silent denial at every write terminal', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context, Event } from './.opensaas/types.ts'

type Created = Awaited<ReturnType<Context['db']['event']['create']>>
type CreatedMany = Awaited<ReturnType<Context['db']['event']['createMany']>>
type UpdatedMany = Awaited<ReturnType<Context['db']['event']['updateMany']>>
type Found = Awaited<ReturnType<Context['db']['event']['findMany']>>

declare const created: Created
declare const createdMany: CreatedMany
declare const updatedMany: UpdatedMany
declare const found: Found

// A denied create returns null rather than throwing, so the caller must check.
const maybeCreated: Event | null = created
// @ts-expect-error a denied create is null
const alwaysCreated: Event = created

// \`createMany\` and \`updateMany\` run one secured write per item, so a partial
// denial leaves a null in that item's position.
const maybeEach: (Event | null)[] = createdMany
// @ts-expect-error a denied item in the batch is null
const alwaysEach: Event[] = createdMany

const maybeEachUpdated: (Event | null)[] = updatedMany
// @ts-expect-error a denied item in the batch is null
const alwaysEachUpdated: Event[] = updatedMany

// A denied read of many is an empty array, not an array of nulls.
const alwaysFound: Event[] = found

void maybeCreated
void alwaysCreated
void maybeEach
void alwaysEach
void maybeEachUpdated
void alwaysEachUpdated
void alwaysFound
`)

    expect(output).toBe('')
  })

  it('reads a required to-one as | null all the same', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context, User } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  // ADR-0058: arity decides, not the column. \`host\`'s foreign key is
  // non-nullable, and the included row is still \`| null\` — the Access Filter
  // can scope it away even when the database cannot.
  const rows = await context.db.booking.findMany({ include: { host: true } })
  assertType<Exact<(typeof rows)[number]['host'], User | null>>()

  // …and the write side still requires it.
  await context.db.booking.create({ data: { host: { connect: { id: 'u1' } } } })

  // @ts-expect-error \`host\` is non-nullable with no default
  await context.db.booking.create({ data: {} })
}

void run
`)

    expect(output).toBe('')
  })

  it('refuses the pre-ADR-0052 spelling of StackContext', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { StackContext } from '@opensaas/stack-core'
import type { DB } from './.opensaas/types.ts'

type Current = StackContext<DB>

// @ts-expect-error the first parameter is the secured \`db\` surface, not the client
type Stale = StackContext<{ post: object; $connect: () => Promise<void> }>

declare const current: Current
declare const stale: Stale
void current
void stale
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
