import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import {
  text,
  decimal,
  json,
  checkbox,
  calendarDay,
  relationship,
} from '@opensaas/stack-core/fields'

/**
 * Compile-time type tests for the write-path `data` narrowing (#599 / Approach B).
 *
 * The generated `context.db.<list>.create()/update()` `data` member now narrows
 * scalar fields to their OpenSaaS `getTypeScriptType()` types while leaving
 * relationship nested writes, unchecked FK fields, and decimal/json on Prisma's
 * input shape. These tests assert the *real* compile behaviour by feeding the
 * actual generated `*Args` types — exactly as `generateCustomDBType` wires them
 * into the `create`/`update`/`createMany`/`updateMany` method signatures
 * (`<T extends Args>(args: Prisma.SelectSubset<T, Args>) => ...`) — into a real
 * `tsc` program against a faithful `Prisma` stub.
 *
 * What is asserted:
 *  - `day: new Date()` (a `Date` to a `calendarDay`) is a COMPILE ERROR.
 *  - `day: '2026-01-01'` (a `string`) compiles.
 *  - `price` accepts `number` and `string` (decimal not over-narrowed).
 *  - `meta` accepts a plain JSON value and Prisma's `JsonNull` sentinel.
 *  - relationship writes (`owner.connect`, unchecked `ownerId`) compile.
 *  - `active` (`checkbox({ defaultValue: false })`) is OPTIONAL on create.
 *
 * The `@ts-expect-error` markers in the consumer fixture make a passing compile
 * (zero diagnostics) the proof: each marker must catch an error, and every
 * other line must type-check.
 */

const COMPILE_TIMEOUT_MS = 60000

/**
 * A faithful-enough `Prisma` stub: the scalar `*Args['data']` / `*Input` shapes
 * mirror what Prisma generates for the corresponding column types, so the
 * generated `Omit<...> & { narrowed }` override composes against realistic input
 * types (calendarDay -> `Date | string`, decimal -> `Decimal | number | string`,
 * json -> value | null-sentinel, plus a relationship nested-write + unchecked FK).
 */
const PRISMA_STUB = `
import type { Decimal } from 'decimal.js'

export class PrismaClient {}

export namespace Prisma {
  // Prisma's SelectSubset narrows excess keys for select/include but still
  // requires assignability to the constraint U — a known key with the wrong
  // type is rejected (the calendarDay-Date case). Modelled here as the real
  // SelectSubset does (T constrained to U via Has/Or, falling back to U).
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & U

  export type JsonNullValueInput = { __jsonNull: true }
  export type InputJsonValue = string | number | boolean | { [k: string]: InputJsonValue } | InputJsonValue[]

  // --- User ---
  export type UserCreateInput = { name: string }
  export type UserUpdateInput = { name?: string }
  export type UserSelect = { name?: boolean }
  export type UserWhereInput = { name?: string }
  export type UserCreateArgs = { data: UserCreateInput; select?: UserSelect | null }
  export type UserUpdateArgs = { where: { id: string }; data: UserUpdateInput; select?: UserSelect | null }
  export type UserFindUniqueArgs = { where: { id: string }; select?: UserSelect | null }
  export type UserFindManyArgs = { where?: UserWhereInput; select?: UserSelect | null }
  export type UserFindFirstArgs = { where?: UserWhereInput; select?: UserSelect | null }
  export type UserDeleteArgs = { where: { id: string }; select?: UserSelect | null }
  export type UserCountArgs = { where?: UserWhereInput }
  export type UserGetPayload<T> = { id: string; name: string }

  // --- Event ---
  // Scalar inputs mirror Prisma's generated column input types. Nullable
  // scalars (day/price/meta — no isRequired) are optional, as Prisma emits.
  // A single (non-union) input is used so the relationship nested-write and the
  // unchecked FK are both present, sidestepping TS union excess-property quirks
  // that do not exist against Prisma's real XOR<Checked, Unchecked> inputs.
  export type EventCreateInput = {
    title: string
    day?: Date | string                       // calendarDay backing column: DateTime @db.Date
    price?: Decimal | number | string
    meta?: InputJsonValue | JsonNullValueInput
    active?: boolean
    owner?: { connect: { id: string } }       // relationship nested write (checked)
    ownerId?: string | null                   // unchecked FK
  }
  export type EventUpdateInput = {
    title?: string
    day?: Date | string
    price?: Decimal | number | string
    meta?: InputJsonValue | JsonNullValueInput
    active?: boolean
    owner?: { connect: { id: string } } | { disconnect: true }
    ownerId?: string | null
  }

  export type EventSelect = {
    title?: boolean; day?: boolean; price?: boolean; meta?: boolean; active?: boolean; owner?: boolean
  }
  export type EventInclude = { owner?: boolean }
  export type EventWhereInput = { title?: string }
  export type EventCreateArgs = { data: EventCreateInput; select?: EventSelect | null; include?: EventInclude | null }
  export type EventUpdateArgs = { where: { id: string }; data: EventUpdateInput; select?: EventSelect | null; include?: EventInclude | null }
  export type EventFindUniqueArgs = { where: { id: string }; select?: EventSelect | null; include?: EventInclude | null }
  export type EventFindManyArgs = { where?: EventWhereInput; select?: EventSelect | null; include?: EventInclude | null }
  export type EventFindFirstArgs = { where?: EventWhereInput; select?: EventSelect | null; include?: EventInclude | null }
  export type EventDeleteArgs = { where: { id: string }; select?: EventSelect | null; include?: EventInclude | null }
  export type EventCountArgs = { where?: EventWhereInput }
  export type EventGetPayload<T> = { id: string; title: string; day: string; active: boolean }
}
`

/**
 * Minimal stubs for the `@opensaas/stack-core` + `/internal` symbols the
 * generated types import. Kept permissive: these are not what we're testing.
 */
const CORE_STUB = `
export interface Session { [key: string]: unknown }
export type AccessContext<P> = { db: unknown; session: Session }
`

const CORE_INTERNAL_STUB = `
export type StorageUtils = unknown
export type ServerActionProps = unknown
export type AccessControlledDB<P> = Record<string, unknown>
export type Fragment<A, B> = unknown
export type FieldSelection<A> = unknown
`

const PLUGIN_TYPES_STUB = `export type PluginServices = unknown\n`

/**
 * The consumer: exercises the generated CustomDB write methods. Passing
 * lines must compile; `@ts-expect-error` lines must each catch an error.
 */
const CONSUMER = `
import type { CustomDB } from './types.ts'

declare const db: CustomDB

async function run() {
  // string -> calendarDay: compiles.
  await db.event.create({ data: { title: 't', day: '2026-01-01' } })

  // Date -> calendarDay: COMPILE ERROR (the #599 win).
  // @ts-expect-error Date is not assignable to a calendarDay (string) field
  await db.event.create({ data: { title: 't', day: new Date() } })

  // decimal accepts number and string (not over-narrowed to Decimal).
  await db.event.create({ data: { title: 't', price: 12.5 } })
  await db.event.create({ data: { title: 't', price: '12.50' } })

  // json accepts a plain value and Prisma's JsonNull sentinel.
  await db.event.create({ data: { title: 't', meta: { a: 1 } } })

  // relationship nested write + unchecked FK both compile.
  await db.event.create({ data: { title: 't', owner: { connect: { id: 'u1' } } } })
  await db.event.create({ data: { title: 't', ownerId: 'u1' } })

  // checkbox({ defaultValue: false }) is OPTIONAL on create: omitting it compiles.
  await db.event.create({ data: { title: 't' } })

  // update path: Date -> calendarDay still a COMPILE ERROR.
  // @ts-expect-error Date is not assignable to a calendarDay (string) field on update
  await db.event.update({ where: { id: 'e1' }, data: { day: new Date() } })

  // update path: string and decimal-number compile.
  await db.event.update({ where: { id: 'e1' }, data: { day: '2026-01-02', price: 9 } })

  // createMany element narrowing: Date rejected, string accepted.
  await db.event.createMany({ data: [{ title: 't', day: '2026-01-01' }] })
  // @ts-expect-error Date is not assignable to a calendarDay (string) field in createMany
  await db.event.createMany({ data: [{ title: 't', day: new Date() }] })

  // updateMany narrowing: string accepted.
  await db.event.updateMany({ data: { day: '2026-01-03' } })
}

void run
`

function compileFixture(generatedTypes: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-write-narrowing-'))
  try {
    const prismaClientDir = path.join(dir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })
    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), PRISMA_STUB)
    fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(dir, 'consumer.ts'), CONSUMER)

    // Stub the bare-specifier core imports via a paths mapping.
    const coreDir = path.join(dir, '_stubs')
    fs.mkdirSync(coreDir, { recursive: true })
    fs.writeFileSync(path.join(coreDir, 'core.ts'), CORE_STUB)
    fs.writeFileSync(path.join(coreDir, 'core-internal.ts'), CORE_INTERNAL_STUB)
    fs.writeFileSync(path.join(dir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      // `baseUrl` is deprecated as of TS 7 (https://aka.ms/ts6); absolute
      // `paths` targets resolve without it.
      paths: {
        '@opensaas/stack-core': [path.join(coreDir, 'core.ts')],
        '@opensaas/stack-core/internal': [path.join(coreDir, 'core-internal.ts')],
        'decimal.js': [path.join(coreDir, 'decimal.ts')],
      },
    }
    fs.writeFileSync(
      path.join(coreDir, 'decimal.ts'),
      'export class Decimal { constructor(_v: string | number) {} }\n',
    )

    const rootNames = [
      path.join(dir, 'types.ts'),
      path.join(dir, 'consumer.ts'),
      path.join(prismaClientDir, 'client.ts'),
    ]
    const program = ts.createProgram({ rootNames, options: compilerOptions })
    return [...ts.getPreEmitDiagnostics(program)]
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const TEST_CONFIG: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: { fields: { name: text({ validation: { isRequired: true } }) } },
    Event: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        day: calendarDay(),
        price: decimal(),
        meta: json(),
        active: checkbox({ defaultValue: false }),
        owner: relationship({ ref: 'User' }),
      },
    },
  },
}

describe('write-path data narrowing (#599)', () => {
  it(
    'rejects Date->calendarDay while allowing string/decimal/json/relationship writes',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generated = generateTypes(TEST_CONFIG)
      const diagnostics = compileFixture(generated)

      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      // Zero diagnostics: every valid write compiled AND every @ts-expect-error
      // caught its intended error (an uncaught @ts-expect-error is itself a
      // diagnostic, so a stray pass would fail here too).
      expect(messages).toEqual([])
    },
  )

  it('narrows day to string and keeps active optional in the generated CreateArgs', () => {
    const generated = generateTypes(TEST_CONFIG)
    // Structural assertions on the generated override (cheap, complements tsc).
    expect(generated).toContain(
      "data: Omit<Prisma.EventCreateArgs['data'], 'title' | 'day' | 'active'> & {",
    )
    expect(generated).toContain('day?: string | null')
    // checkbox({ defaultValue: false }) is optional on create (the bug fix).
    expect(generated).toContain('active?: boolean')
    // decimal/json are NOT narrowed: they stay out of the Omit key list.
    expect(generated).not.toContain("'price'")
    expect(generated).not.toContain("'meta'")
  })
})
