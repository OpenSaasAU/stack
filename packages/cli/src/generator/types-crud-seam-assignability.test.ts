import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import { generateListsNamespace } from './lists.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, virtual, relationship } from '@opensaas/stack-core/fields'

/**
 * Compile-time regression test for #1287: a regression introduced by #1264.
 * `findUnique`/`findFirst`/`findMany` (and singleton `get`) each carry a
 * two-member overload set — a fragment-`query` member, then a generic
 * `<T extends {List}FindXArgs>(args: Prisma.SelectSubset<T, ...>)` member.
 * That pair is not assignable, with no cast, to a plain structural seam
 * (`{ findUnique(args: { where: {...} }): Promise<...> }` — the pattern
 * #1214's own changelog recommends for keeping app code off the generated
 * types) once `Prisma.SelectSubset` carries Prisma's real
 * conditional-intersection shape (the `SelectAndInclude`/`SelectAndOmit`
 * branches below). The same pair also breaks `Parameters<>`, which resolves
 * against an overloaded type's LAST member only — with the generic member
 * last, the unresolved `T` collapses to `never`.
 *
 * Neither symptom reproduces against the simplified `& U` `SelectSubset` stub
 * (or an `unknown`-typed seam parameter) the OTHER generator fixtures in this
 * directory use for speed — see the file-level comment on
 * `generateListCrudInterface` in `./types.ts`. This fixture's `SelectSubset`
 * is the real shape, and its seam parameters are concretely typed, on
 * purpose: it is the one guard actually capable of catching this class of
 * regression again.
 *
 * The fix (see `./types.ts`) adds a third, trailing, NON-generic overload
 * member — closing the assignability gap and giving `Parameters<>`
 * something concrete to resolve to — while overload resolution still
 * prefers the generic member for ordinary calls (a `select`/`include`-
 * narrowed call, or a bare call), so #1264's and #1268's guarantees are
 * unaffected. That member's parameter type deliberately omits
 * `select`/`include`/`query` rather than reusing the full `{List}FindXArgs`
 * as-is: an unrestricted trailing member would give overload resolution a
 * fallback that silently accepts `select`+`include` together — a
 * combination Prisma itself forbids, and the generic member's own
 * `SelectSubset` guard already rejects — the moment that guard's error
 * kicks in. The `run()` probe below asserts that combination is still a
 * compile error.
 */

const COMPILE_TIMEOUT_MS = 60000

/**
 * `Prisma.SelectSubset`'s real shape (mirrored from Prisma's generated
 * client runtime) — an intersection with a conditional branch that resolves
 * to an error-message string literal when `T` carries both `select` and
 * `include`, or both `select` and `omit`. This, not the simplified `& U`
 * stub the other fixtures use, is what makes the generic overload member
 * incompatible with a concretely-typed structural seam.
 */
const SELECT_SUBSET_STUB = `
  export type SelectAndInclude = { select: any; include: any }
  export type SelectAndOmit = { select: any; omit: any }
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & (T extends SelectAndInclude
    ? 'Please either choose \`select\` or \`include\`.'
    : T extends SelectAndOmit
      ? 'Please either choose \`select\` or \`omit\`.'
      : {})
`

/**
 * A faithful-enough `Prisma` stub for the standalone-`CustomDB` probe,
 * matching the pattern in types-fragment-narrowing.test.ts — scalar
 * `*GetPayload`/`*Args` shapes close enough to Prisma's own to exercise our
 * generated `select`/`include`/`query` wiring, with the real `SelectSubset`
 * above swapped in.
 */
const PRISMA_STUB = `
export class PrismaClient {}

export namespace Prisma {
${SELECT_SUBSET_STUB}
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
}
`

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
 * Concretely-typed structural seams — no `unknown`, which (per the #1287
 * triage) is satisfied by any parameter type and so can't catch this
 * regression — for each of the three read methods, plus the `Parameters<>`
 * probe over `findMany`.
 */
const CONSUMER = `
import type { CustomDB, PostOutput } from './types.ts'
import { defineFragment } from './_stubs/core.ts'

declare const db: CustomDB

type FindUniqueSeam = {
  findUnique(args: { where: { id: string } }): Promise<{ id: string; title: string } | null>
}
type FindFirstSeam = {
  findFirst(args?: { where?: { title?: string } }): Promise<{ id: string; title: string } | null>
}
type FindManySeam = {
  findMany(args?: { where?: { title?: string } }): Promise<Array<{ id: string; title: string }>>
}

// --- #1287: each read method is assignable, with no cast, to a plain
// structural seam declaring a concretely-typed argument. ---
const findUniqueSeam: FindUniqueSeam = db.post
const findFirstSeam: FindFirstSeam = db.post
const findManySeam: FindManySeam = db.post
void findUniqueSeam
void findFirstSeam
void findManySeam

// --- #1287: Parameters<> over the delegate resolves concretely, not to
// 'never'. ---
type FindManyParams = NonNullable<Parameters<typeof db.post.findMany>[0]>
const whereFromParams: FindManyParams['where'] = { title: 'hello' }
void whereFromParams

async function run() {
  // --- #1264 unaffected: a fragment read still narrows to ResultOf. ---
  const postFragment = defineFragment<PostOutput>()({ title: true })
  const post = await db.post.findUnique({ where: { id: 'p1' }, query: postFragment })
  if (post) {
    const title: string = post.title
    void title
    // @ts-expect-error 'content' was not selected by the fragment
    void post.content
  }

  // --- #1268 unaffected: a direct call with select/include still compiles
  // and resolves through the generic (narrowing) overload member, not the
  // new trailing plain member. ---
  const included = await db.post.findUnique({ where: { id: 'p1' }, include: { author: true } })
  void included

  // --- The new trailing member must not reopen a hole in Prisma's
  // select/include mutual-exclusivity check: passing both together is
  // still a compile error, caught previously by the generic member's
  // Prisma.SelectSubset guard. An unrestricted trailing member (one that
  // still allowed 'select'/'include') would give overload resolution a
  // fallback that silently accepts this once the generic member rejects
  // it — the trailing member here omits those keys entirely so it can't
  // become that fallback. ---
  // @ts-expect-error passing both 'select' and 'include' is not allowed
  await db.post.findUnique({ where: { id: 'p1' }, select: { title: true }, include: { author: true } })
}

void run
`

function compileFixture(generatedTypes: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-crud-seam-'))
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
  },
}

describe('generated CustomDB read methods are assignable to a concrete structural seam (#1287)', () => {
  it(
    'findUnique/findFirst/findMany are assignable with no cast, and Parameters<> resolves concretely',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generated = generateTypes(TEST_CONFIG)
      const diagnostics = compileFixture(generated)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      expect(messages).toEqual([])
    },
  )
})

/**
 * Second probe: the same seam, reached as `context.db.<list>` from inside a
 * hook authored the documented way (`list<Lists.Post.TypeInfo>({ ... })`),
 * against core's REAL built `dist` — matching the pattern in
 * types-hook-context.test.ts. `TypeInfo['db']` resolves to the generated
 * `CustomDB`, so a hook's `context.db.<list>` is the exact same
 * `{List}Crud` type the first probe above already covers; this proves the
 * fix holds through that indirection too, not only at the type-definition
 * level.
 */
const HOOK_PRISMA_STUB = `
export namespace Prisma {
${SELECT_SUBSET_STUB}
  export type PostCreateInput = { title: string }
  export type PostUpdateInput = { title?: string }
  export type PostSelect = { title?: boolean }
  export type PostWhereInput = { title?: string }
  export type PostCreateArgs = { data: PostCreateInput; select?: PostSelect | null }
  export type PostUpdateArgs = { where: { id: string }; data: PostUpdateInput; select?: PostSelect | null }
  export type PostFindUniqueArgs = { where: { id: string }; select?: PostSelect | null }
  export type PostFindManyArgs = { where?: PostWhereInput; select?: PostSelect | null }
  export type PostFindFirstArgs = { where?: PostWhereInput; select?: PostSelect | null }
  export type PostDeleteArgs = { where: { id: string }; select?: PostSelect | null }
  export type PostCountArgs = { where?: PostWhereInput }
  export type PostGetPayload<T> = { id: string; title: string }

  export interface PostDelegate {
    findUnique(args: PostFindUniqueArgs): Promise<PostGetPayload<PostFindUniqueArgs> | null>
    findFirst(args?: PostFindFirstArgs): Promise<PostGetPayload<PostFindFirstArgs> | null>
    findMany(args?: PostFindManyArgs): Promise<PostGetPayload<PostFindManyArgs>[]>
    create(args: PostCreateArgs): Promise<PostGetPayload<PostCreateArgs>>
    update(args: PostUpdateArgs): Promise<PostGetPayload<PostUpdateArgs>>
    delete(args: PostDeleteArgs): Promise<PostGetPayload<PostDeleteArgs>>
    count(args?: PostCountArgs): Promise<number>
  }
}

export class PrismaClient {
  declare post: Prisma.PostDelegate
}
`

const HOOK_CONSUMER = `
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { Lists } from './lists.ts'

type FindUniqueSeam = {
  findUnique(args: { where: { id: string } }): Promise<{ id: string; title: string } | null>
}

list<Lists.Post.TypeInfo>({
  fields: {
    title: text(),
  },
  hooks: {
    validate: async ({ context }) => {
      // #1287: context.db.post, reached from inside a hook, is assignable
      // to the same concrete structural seam with no cast.
      const seam: FindUniqueSeam = context.db.post
      void seam
    },
  },
})

void run
async function run() {}
`

function compileHookFixture(generatedTypes: string, generatedLists: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-crud-seam-hook-'))
  try {
    const prismaClientDir = path.join(dir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })
    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), HOOK_PRISMA_STUB)
    fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(dir, 'lists.ts'), generatedLists)
    fs.writeFileSync(path.join(dir, 'consumer.ts'), HOOK_CONSUMER)
    fs.writeFileSync(path.join(dir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)

    // core's own package root, so the fixture resolves the REAL
    // @opensaas/stack-core / /fields / /internal entry points (matching
    // types-hook-context.test.ts) — the #1211 threading this probe rides on
    // lives entirely in core's built dist, not a stub.
    const coreRoot = path.resolve(__dirname, '../../../core')

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      paths: {
        '@opensaas/stack-core': [path.join(coreRoot, 'dist/index.d.ts')],
        '@opensaas/stack-core/fields': [path.join(coreRoot, 'dist/fields/index.d.ts')],
        '@opensaas/stack-core/internal': [path.join(coreRoot, 'dist/internal.d.ts')],
        '@opensaas/stack-core/extend': [path.join(coreRoot, 'dist/extend.d.ts')],
        zod: [path.join(coreRoot, 'node_modules/zod')],
      },
    }

    const rootNames = [
      path.join(dir, 'types.ts'),
      path.join(dir, 'lists.ts'),
      path.join(dir, 'consumer.ts'),
      path.join(prismaClientDir, 'client.ts'),
    ]
    const program = ts.createProgram({ rootNames, options: compilerOptions })
    return [...ts.getPreEmitDiagnostics(program)]
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const HOOK_TEST_CONFIG: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: { fields: { title: text({ validation: { isRequired: true } }) } },
  },
}

describe('context.db.<list> reached inside a hook is assignable to the same seam (#1287)', () => {
  it(
    'a list-level hook can assign context.db.post to a concrete structural seam with no cast',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generatedTypes = generateTypes(HOOK_TEST_CONFIG)
      const generatedLists = generateListsNamespace(HOOK_TEST_CONFIG)

      const diagnostics = compileHookFixture(generatedTypes, generatedLists)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      expect(messages).toEqual([])
    },
  )
})
