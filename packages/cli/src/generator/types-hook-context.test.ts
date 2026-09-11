import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import { generateListsNamespace } from './lists.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'

/**
 * Compile-time regression test for #1211: a list/field hook's `context` was
 * typed as `StackContext<PrismaClientLike>` (`PrismaClientLike = any`), so
 * `context.db` resolved to `AccessControlledDB<any>` — a mapped type over
 * `keyof any` that contributes no named property, making the hook's
 * `context` assignable to nothing app-specific. `TypeInfo` now carries a
 * `prisma` member keyed to the app's own generated `PrismaClient`
 * (threaded by the generator into `Lists.<List>.TypeInfo`), and every hook-
 * args type reads its `context`'s client type off it.
 *
 * Unlike the other generator fixtures in this directory, this one points
 * `@opensaas/stack-core`'s path mapping at the package's REAL built `dist`
 * (not a hand-rolled stub) — the defect and its fix live entirely in core's
 * own hook-args/`AccessControlledDB` types, so a stub would risk drifting
 * from, or accidentally masking, the exact thing under test. This couples
 * the test to `packages/core` having been built first, which the turbo
 * pipeline already guarantees (`cli#test` depends on `cli#build`, which
 * depends on `^build`).
 */

const COMPILE_TIMEOUT_MS = 60000

/**
 * A minimal but structurally real `PrismaClient`: each list is a genuine
 * instance property (so `keyof PrismaClient` includes it, the same way
 * `AccessControlledDB`'s mapped type walks a real Prisma client) whose
 * delegate exposes the seven methods `AccessControlledDB`'s conditional
 * check requires (`findUnique`/`findFirst`/`findMany`/`create`/`update`/
 * `delete`/`count`). Signatures are simplified (no `Prisma.SelectSubset`
 * generics) — the check only requires the keys to be present, not an exact
 * Prisma-shaped signature, and `types-write-narrowing.test.ts` already
 * covers the narrowed write-path shapes in depth.
 */
const PRISMA_STUB = `
export namespace Prisma {
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & U

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

  export interface UserDelegate {
    findUnique(args: UserFindUniqueArgs): Promise<UserGetPayload<UserFindUniqueArgs> | null>
    findFirst(args?: UserFindFirstArgs): Promise<UserGetPayload<UserFindFirstArgs> | null>
    findMany(args?: UserFindManyArgs): Promise<UserGetPayload<UserFindManyArgs>[]>
    create(args: UserCreateArgs): Promise<UserGetPayload<UserCreateArgs>>
    update(args: UserUpdateArgs): Promise<UserGetPayload<UserUpdateArgs>>
    delete(args: UserDeleteArgs): Promise<UserGetPayload<UserDeleteArgs>>
    count(args?: UserCountArgs): Promise<number>
  }

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
  declare user: Prisma.UserDelegate
  declare post: Prisma.PostDelegate
}
`

const PLUGIN_TYPES_STUB = `export type PluginServices = unknown\n`

/**
 * The consumer: a hook authored the documented way
 * (`list<Lists.Post.TypeInfo>({ hooks: { validate: ... } })`), against the
 * REAL `list()` and field builders from core's built package — proving the
 * fix end to end, not just at the type-definition level.
 *
 * The assignability probes below target `context.db` (assignable to the
 * generated `CustomDB`) and a narrow structural seam over it — the exact
 * two repros the issue's body gives for "context is assignable to
 * nothing" — rather than the whole generated `Context`/`BaseContext`.
 * Assigning the FULL context also trips a second, pre-existing and
 * unrelated mismatch: `StackContext.session` is `Session | null` (a
 * request can be anonymous) while the generated `Context<TSession =
 * OpensaasSession>` requires a non-null `TSession`. That gap is about
 * session nullability, not the Prisma client this issue threads through —
 * it predates this fix, survives it, and belongs to a separate issue.
 */
const CONSUMER = `
import { list } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import type { Lists } from './lists.ts'
import type { CustomDB } from './types.ts'

function useDb(db: CustomDB) {
  void db
}

// The issue's own "narrow structural seam" repro: before this fix, even a
// hand-picked slice of the real shape was rejected because the named
// delegates were ABSENT from AccessControlledDB<any>, not loosely typed.
function useConflictContext(x: { db: { post: { findMany(args?: unknown): Promise<{ id: string; title: string }[]> } } }) {
  void x
}

list<Lists.Post.TypeInfo>({
  fields: {
    title: text(),
  },
  hooks: {
    validate: async ({ context }) => {
      // Probe 1: context.db is assignable to the app's own generated
      // CustomDB with NO cast (the #1211 bug: this used to need
      // 'context as unknown as Context').
      useDb(context.db)

      // Probe 2: the narrow structural seam the issue's body shows failing
      // now succeeds too.
      useConflictContext({ db: context.db })

      // Probe 3: a real, named delegate — not AccessControlledDB<any>'s
      // index signature. Reading a real column compiles...
      const posts = await context.db.post.findMany()
      posts[0]?.title.toUpperCase()
      const users = await context.db.user.findMany()
      users[0]?.name.toUpperCase()

      // ...and reading a column that doesn't exist on the row is a compile
      // error, proving the row type is real and not the loose 'any' escape.
      // @ts-expect-error 'doesNotExist' is not a property of the Post row
      posts[0]?.doesNotExist
    },
  },
})

void run
async function run() {}
`

function compileFixture(generatedTypes: string, generatedLists: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-hook-context-'))
  try {
    const prismaClientDir = path.join(dir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })
    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), PRISMA_STUB)
    fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(dir, 'lists.ts'), generatedLists)
    fs.writeFileSync(path.join(dir, 'consumer.ts'), CONSUMER)
    fs.writeFileSync(path.join(dir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)

    // core's own package root, so the fixture resolves the REAL
    // @opensaas/stack-core / /fields / /internal entry points and zod
    // (a real, non-relative dependency of core's generated .d.ts files).
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

const TEST_CONFIG: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    User: { fields: { name: text({ validation: { isRequired: true } }) } },
    Post: { fields: { title: text({ validation: { isRequired: true } }) } },
  },
}

describe("a hook's context is keyed to the app's own Prisma client (#1211)", () => {
  it(
    'context.db is assignable to the generated CustomDB with no cast, and resolves real per-list row types',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generatedTypes = generateTypes(TEST_CONFIG)
      const generatedLists = generateListsNamespace(TEST_CONFIG)

      const diagnostics = compileFixture(generatedTypes, generatedLists)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      // Zero diagnostics: both assignments compiled with no cast, both real
      // delegates returned their row types, AND the @ts-expect-error above
      // caught its intended error (an unmet one is itself a diagnostic).
      expect(messages).toEqual([])
    },
  )

  it(
    "does not (yet) reject a misspelled db delegate — AccessControlledDB's " +
      'catch-all index signature is unchanged by #1211, by design',
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      // Documents a known, deliberately out-of-scope limitation (see the
      // issue's "Aside" and its "Out of scope" list): closing this needs
      // removing/narrowing AccessControlledDB's `& { [key: string]: any }`
      // catch-all, which ADR-0052 owns under the Prisma 8 contract-keying
      // migration, not this fix. A typo'd delegate still silently resolves
      // to `any` rather than failing to compile.
      const typoConsumer = CONSUMER.replace(
        'const users = await context.db.user.findMany()',
        'const users = await context.db.typoedListName.findMany()',
      )
      const generatedTypes = generateTypes(TEST_CONFIG)
      const generatedLists = generateListsNamespace(TEST_CONFIG)

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-hook-context-typo-'))
      try {
        const prismaClientDir = path.join(dir, 'prisma-client')
        fs.mkdirSync(prismaClientDir, { recursive: true })
        fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), PRISMA_STUB)
        fs.writeFileSync(path.join(dir, 'types.ts'), generatedTypes)
        fs.writeFileSync(path.join(dir, 'lists.ts'), generatedLists)
        fs.writeFileSync(path.join(dir, 'consumer.ts'), typoConsumer)
        fs.writeFileSync(path.join(dir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)

        const coreRoot = path.resolve(__dirname, '../../../core')
        const program = ts.createProgram({
          rootNames: [
            path.join(dir, 'types.ts'),
            path.join(dir, 'lists.ts'),
            path.join(dir, 'consumer.ts'),
            path.join(prismaClientDir, 'client.ts'),
          ],
          options: {
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
          },
        })
        const diagnostics = [...ts.getPreEmitDiagnostics(program)]
        // No diagnostic at all: the typo'd delegate silently type-checks
        // via the index signature, same as before #1211 — a pre-existing,
        // separately-tracked gap, not a regression this PR introduces.
        expect(diagnostics).toEqual([])
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
