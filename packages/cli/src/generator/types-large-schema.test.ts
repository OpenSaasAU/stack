import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ListConfig, OpenSaasConfig } from '@opensaas/stack-core'
import { checkbox, integer, json, relationship, text, virtual } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'

/**
 * The generated bundle for a realistically large schema has to type-check
 * against a REAL emitted `contract.d.ts`, under the two gates ADR-0054 puts on
 * the bundle (`erasableSyntaxOnly`, `verbatimModuleSyntax`).
 *
 * Its original job (#952 / ADR-0032) was catching `TS2589: Type instantiation
 * is excessively deep` once a schema grew past a handful of lists, and it
 * keeps it: the per-list shapes are now core generics instantiated 21 times
 * over a mutually-recursive relation graph, which is exactly the shape that
 * used to blow up. What changed is that the contract is emitted rather than
 * stubbed, so the types being checked are the ones an application gets.
 *
 * It also pins the app-facing names (PRD user story 10), the include
 * narrowing (ADR-0058) and the declared-dependency item type (ADR-0051) —
 * every one of them a claim about the generics, not about generated text.
 */

const LIST_COUNT = 20

function buildLargeSchemaConfig(): OpenSaasConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ListConfig is generic over per-list TypeInfo
  const lists: Record<string, ListConfig<any>> = {
    Tenant: {
      fields: {
        name: text({ validation: { isRequired: true } }),
      },
    },
    Settings: {
      isSingleton: true,
      fields: {
        siteName: text({ defaultValue: 'Fixture' }),
      },
    },
  }

  for (let i = 0; i < LIST_COUNT; i++) {
    const listName = `Model${i}`
    const previousListName = i === 0 ? null : `Model${i - 1}`
    const hasNext = i < LIST_COUNT - 1

    lists[listName] = {
      fields: {
        title: text({ validation: { isRequired: true } }),
        code: text(),
        priority: integer(),
        active: checkbox({ defaultValue: false }),
        metaA: json(),
        metaB: json(),
        // A computed field over a sibling column: `needs` widened to stored
        // columns by ADR-0051, and the type of what its hook is handed.
        summary: virtual({
          type: 'string',
          needs: ['title'],
          hooks: { resolveOutput: ({ item }) => `${item.title}` },
        }),
        tenant: relationship({ ref: 'Tenant' }),
        ...(previousListName
          ? { previous: relationship({ ref: `${previousListName}.next`, many: false }) }
          : {}),
        ...(hasNext ? { next: relationship({ ref: `Model${i + 1}.previous`, many: true }) } : {}),
      },
    }
  }

  return { db: { provider: 'postgresql' }, lists }
}

describe('the generated bundle for a 22-list schema', () => {
  let fixture: TypeFixture

  beforeAll(() => {
    fixture = emitTypeFixture('large-schema', buildLargeSchemaConfig())
  }, 300_000)

  afterAll(() => {
    fixture?.cleanup()
  })

  it(
    'type-checks against the emitted contract, with the app-facing names intact',
    { timeout: 300_000 },
    () => {
      const output = fixture.check(`${CONSUMER_PRELUDE}
import type {
  BaseContext,
  Context,
  Model0,
  Model0CreateInput,
  Model0UpdateInput,
  TransactionContext,
} from './.opensaas/types.ts'
import type { Lists } from './.opensaas/lists.ts'

declare const context: Context
declare const base: BaseContext
declare const tx: TransactionContext

// PRD user story 10: these names survive the migration.
declare const row: Model0
declare const create: Model0CreateInput
declare const update: Model0UpdateInput
type Info = Lists.Model0.TypeInfo

assertType<Exact<Info['key'], 'Model0'>>()
assertType<Exact<Info['output'], Model0>>()
assertType<Exact<Info['inputs']['create'], Model0CreateInput>>()
assertType<Exact<Info['inputs']['update'], Model0UpdateInput>>()

async function run() {
  // The self-referential \`sudo()\` over a 22-list \`DB\` is what used to hit TS2589.
  const sudoed = context.sudo()
  const one = await sudoed.db.model0.findUnique({ where: { id: '1' } })
  const many = await context.db.model10.findMany({ include: { previous: true, next: true } })
  const made = await context.db.model5.create({
    data: { title: 't', code: 'c', tenant: { connect: { id: 't1' } } },
  })
  void one
  void many
  void made
  void base.db
  void tx.db
}

void run
void row
void create
void update
`)

      expect(output).toBe('')
    },
  )

  it('types an included to-one as | null and a to-many as []', { timeout: 300_000 }, () => {
    const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Context, Model0, Model1, Tenant } from './.opensaas/types.ts'

declare const context: Context

async function run() {
  const rows = await context.db.model1.findMany({ include: { previous: true, tenant: true } })
  // ADR-0058: arity decides, not the column. \`tenant\` and \`previous\` are both
  // to-one, so both read \`| null\` however their foreign key is declared.
  assertType<Exact<(typeof rows)[number]['previous'], Model0 | null>>()
  assertType<Exact<(typeof rows)[number]['tenant'], Tenant | null>>()

  const withMany = await context.db.model0.findMany({ include: { next: true } })
  assertType<Exact<(typeof withMany)[number]['next'], Model1[]>>()

  // A relation the caller did not name is optional, not present (ADR-0024).
  const bare = await context.db.model1.findMany()
  assertType<Exact<(typeof bare)[number]['previous'], Model0 | null | undefined>>()
}

void run
`)

    expect(output).toBe('')
  })

  it(
    'narrows a resolveOutput hook item to its declared dependency set',
    { timeout: 300_000 },
    () => {
      const output = fixture.check(`${CONSUMER_PRELUDE}
import type { Lists } from './.opensaas/lists.ts'
import { list } from '@opensaas/stack-core'
import { virtual } from '@opensaas/stack-core/fields'

// ADR-0051: the runtime hands the hook exactly its declared set plus the
// list's system fields, and the type says so.
const declared = list<Lists.Model0.TypeInfo>({
  fields: {
    summary: virtual({
      type: 'string',
      needs: ['title'],
      hooks: { resolveOutput: ({ item }) => item.title },
    }),
  },
})

const alsoDeclared = list<Lists.Model0.TypeInfo>({
  fields: {
    summary: virtual({
      type: 'string',
      needs: ['title'],
      // System fields are always fetched, so they are always readable.
      hooks: { resolveOutput: ({ item }) => \`\${item.id}:\${item.title}\` },
    }),
  },
})

const undeclared = list<Lists.Model0.TypeInfo>({
  fields: {
    summary: virtual({
      type: 'string',
      needs: ['title'],
      hooks: {
        // @ts-expect-error \`code\` is not in this field's declared dependency set
        resolveOutput: ({ item }) => item.code,
      },
    }),
  },
})

void declared
void alsoDeclared
void undeclared
`)

      expect(output).toBe('')
    },
  )
})
