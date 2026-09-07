import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, virtual, relationship } from '@opensaas/stack-core/fields'

/**
 * Compile-time type tests for #1233: `context.db.<list>.findUnique`/
 * `findFirst`/`findMany`/`get` (singletons) now carry the same fragment-
 * `query` overload as core's `AccessControlledDB` (`AugmentedFindUnique` /
 * `AugmentedFindFirst` / `AugmentedFindMany`), instead of only the generic
 * `*Args`-based overload.
 *
 * Before this fix, passing `query: someFragment` to a generated `CustomDB`
 * method still compiled (the generic overload accepts a `query` member on
 * `*Args`), but the RETURN TYPE stayed the unnarrowed `{List}GetPayload<T>`
 * instead of `ResultOf<typeof someFragment>` — a field the fragment never
 * selected was readable on the result with no compile error. The tests below
 * assert the fix: an unselected field is a genuine `tsc` error, alongside
 * three explicit non-regression checks (bare read still folds in virtual
 * fields, a `select`/`include`-only read is unaffected, and singleton `get`
 * is typed correctly both with and without a fragment).
 */

const COMPILE_TIMEOUT_MS = 60000

/**
 * A faithful-enough `Prisma` stub, matching the pattern in
 * types-write-narrowing.test.ts: scalar `*GetPayload`/`*Args` shapes close
 * enough to Prisma's own to exercise our generated `select`/`include`/
 * `query` wiring without re-implementing Prisma's own deeply-conditional
 * GetPayload machinery.
 */
const PRISMA_STUB = `
export class PrismaClient {}

export namespace Prisma {
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & U

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

  // --- Post (has a relation + a virtual field) ---
  export type PostCreateInput = { title: string; content: string; author?: { connect: { id: string } } }
  export type PostUpdateInput = { title?: string; content?: string; author?: { connect: { id: string } } }
  export type PostSelect = { title?: boolean; content?: boolean; author?: boolean }
  export type PostInclude = { author?: boolean }
  export type PostWhereInput = { title?: string }
  export type PostCreateArgs = { data: PostCreateInput; select?: PostSelect | null; include?: PostInclude | null }
  export type PostUpdateArgs = { where: { id: string }; data: PostUpdateInput; select?: PostSelect | null; include?: PostInclude | null }
  export type PostFindUniqueArgs = { where: { id: string }; select?: PostSelect | null; include?: PostInclude | null }
  export type PostFindManyArgs = { where?: PostWhereInput; select?: PostSelect | null; include?: PostInclude | null }
  export type PostFindFirstArgs = { where?: PostWhereInput; select?: PostSelect | null; include?: PostInclude | null }
  export type PostDeleteArgs = { where: { id: string }; select?: PostSelect | null; include?: PostInclude | null }
  export type PostCountArgs = { where?: PostWhereInput }
  export type PostGetPayload<T> = { id: string; title: string; content: string }

  // --- Settings (singleton) ---
  export type SettingsCreateInput = { siteName: string }
  export type SettingsUpdateInput = { siteName?: string }
  export type SettingsSelect = { siteName?: boolean }
  export type SettingsWhereInput = { siteName?: string }
  export type SettingsCreateArgs = { data: SettingsCreateInput; select?: SettingsSelect | null }
  export type SettingsUpdateArgs = { where: { id: number }; data: SettingsUpdateInput; select?: SettingsSelect | null }
  export type SettingsFindUniqueArgs = { where: { id: number }; select?: SettingsSelect | null }
  export type SettingsFindManyArgs = { where?: SettingsWhereInput; select?: SettingsSelect | null }
  export type SettingsFindFirstArgs = { where?: SettingsWhereInput; select?: SettingsSelect | null }
  export type SettingsDeleteArgs = { where: { id: number }; select?: SettingsSelect | null }
  export type SettingsCountArgs = { where?: SettingsWhereInput }
  export type SettingsGetPayload<T> = { id: number; siteName: string }
}
`

/**
 * Faithful mirror of `packages/core/src/query/index.ts`'s type-only surface
 * (Fragment/FieldSelection/ResultOf/SelectedFields) plus `defineFragment`,
 * condensed to the scalar-only case this fixture needs — narrow enough to
 * keep the fixture self-contained without re-deriving core's relation
 * handling, which #1233 doesn't touch.
 */
const CORE_STUB = `
export interface Session { [key: string]: unknown }
export type AccessContext<P> = { db: unknown; session: Session }
export interface TransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: string
}
export interface StackContext<P> {
  db: unknown
  session: Session | null
  prisma: P
  storage: unknown
  plugins: Record<string, unknown>
  serverAction: (props: unknown) => Promise<unknown>
  transaction: <T>(fn: (tx: StackContext<P>) => Promise<T>, options?: TransactionOptions) => Promise<T>
  sudo: () => StackContext<P>
  withSession: (session: Session | null) => StackContext<P>
  _isSudo: boolean
}

export type FieldSelection<T> = {
  readonly [K in keyof T]?: true
}
export type Fragment<TItem, TFields extends FieldSelection<TItem> = FieldSelection<TItem>> = {
  readonly _type: 'fragment'
  readonly _fields: TFields
}
type SelectedFields<TItem, TFields extends FieldSelection<TItem>> = {
  [K in keyof TFields & keyof TItem]: TItem[K]
}
export type ResultOf<F> = F extends Fragment<infer TItem, infer TFields> ? SelectedFields<TItem, TFields> : never

export function defineFragment<TItem>() {
  return function <TFields extends FieldSelection<TItem>>(fields: TFields): Fragment<TItem, TFields> {
    return { _type: 'fragment', _fields: fields }
  }
}
`

const CORE_INTERNAL_STUB = `
export type StorageUtils = unknown
export type ServerActionProps = unknown
export type AccessControlledDB<P> = Record<string, unknown>
export type { Fragment, FieldSelection, ResultOf } from './core.ts'
`

const PLUGIN_TYPES_STUB = `export type PluginServices = unknown\n`

/**
 * Passing lines must compile; `@ts-expect-error` lines must each catch an
 * error (an unmatched `@ts-expect-error` is itself a diagnostic, so a
 * missing regression fails the test too).
 */
const CONSUMER = `
import type { CustomDB, PostOutput } from './types.ts'
import { defineFragment } from './_stubs/core.ts'

declare const db: CustomDB

async function run() {
  // --- Fragment read narrows to ResultOf (the #1233 fix) ---
  const postFragment = defineFragment<PostOutput>()({ title: true })
  const post = await db.post.findUnique({ where: { id: 'p1' }, query: postFragment })
  if (post) {
    const title: string = post.title
    void title
    // @ts-expect-error 'content' was not selected by the fragment — must not be on the narrowed result
    void post.content
  }

  const posts = await db.post.findMany({ query: postFragment })
  const first = posts[0]
  if (first) {
    void first.title
    // @ts-expect-error findMany's fragment overload narrows each element too
    void first.content
  }

  const firstPost = await db.post.findFirst({ query: postFragment })
  if (firstPost) {
    void firstPost.title
    // @ts-expect-error findFirst's fragment overload narrows the result too
    void firstPost.content
  }

  // --- Bare read still folds in the virtual field (no #1232-style regression here) ---
  const bareUser = await db.user.findUnique({ where: { id: 'u1' } })
  if (bareUser) {
    const label: string = bareUser.label
    void label
  }

  // --- select/include-only reads (no fragment) are unaffected ---
  const selected = await db.user.findUnique({ where: { id: 'u1' }, select: { name: true } })
  void selected
  const included = await db.post.findUnique({ where: { id: 'p1' }, include: { author: true } })
  void included

  // --- Singleton get: both overloads ---
  const settings = await db.settings.get()
  if (settings) {
    const tagline: string = settings.tagline
    void tagline
  }

  const settingsFragment = defineFragment<import('./types.ts').SettingsOutput>()({ siteName: true })
  const narrowedSettings = await db.settings.get({ query: settingsFragment })
  if (narrowedSettings) {
    void narrowedSettings.siteName
    // @ts-expect-error singleton get's fragment overload narrows the result too
    void narrowedSettings.tagline
  }
}

void run
`

function compileFixture(generatedTypes: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-fragment-narrowing-'))
  try {
    const prismaClientDir = path.join(dir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })
    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), PRISMA_STUB)
    fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(dir, 'consumer.ts'), CONSUMER)

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
      paths: {
        '@opensaas/stack-core': [path.join(coreDir, 'core.ts')],
        '@opensaas/stack-core/internal': [path.join(coreDir, 'core-internal.ts')],
      },
    }

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
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        label: virtual({
          type: 'string',
          hooks: { resolveOutput: () => 'label' },
        }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text(),
        author: relationship({ ref: 'User' }),
      },
    },
    Settings: {
      isSingleton: true,
      fields: {
        siteName: text({ validation: { isRequired: true } }),
        tagline: virtual({
          type: 'string',
          hooks: { resolveOutput: () => 'tagline' },
        }),
      },
    },
  },
}

describe('fragment-read narrowing through the generated CustomDB (#1233)', () => {
  it(
    'narrows fragment reads to ResultOf while leaving bare/select/include reads unaffected',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generated = generateTypes(TEST_CONFIG)
      const diagnostics = compileFixture(generated)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      expect(messages).toEqual([])
    },
  )

  it('generates a fragment overload ahead of the generic Args overload for finds and singleton get', () => {
    const generated = generateTypes(TEST_CONFIG)

    for (const method of ['findUnique', 'findFirst', 'findMany']) {
      expect(generated).toContain(`  ${method}: {`)
    }
    expect(generated).toContain('  get: {')
    // Each fragment overload returns ResultOf<Fragment<...>>, not the unnarrowed GetPayload.
    expect(generated).toContain('Promise<ResultOf<Fragment<TItem, TFields>> | null>')
    expect(generated).toContain('Promise<ResultOf<Fragment<TItem, TFields>>[]>')
  })
})
