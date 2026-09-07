import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateTypes } from './types.js'
import { generateListsNamespace } from './lists.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, password, virtual } from '@opensaas/stack-core/fields'

/**
 * Compile-time regression test for #1232: a hook's `context` resolved its
 * client type from `TypeInfo['prisma']` alone, so `context.db.<list>`
 * resolved through `AccessControlledDB<PrismaClient>` — Prisma's own
 * payload, physical columns only. The generated `CustomDB` instead folds
 * each list's virtual fields and transformed-field output overrides (e.g.
 * `password` as `HashedPassword`) into its payload — two descriptions of the
 * same runtime rows, and the hook side under-described them. `TypeInfo` now
 * carries a second `db` member (the generator points it at `CustomDB`), and
 * every hook-args type — list-level and field-level alike — keys its
 * `context`'s `db` off it too.
 *
 * Uses core's REAL built `dist` (matching `types-hook-context.test.ts`,
 * #1211's guard) rather than a hand-rolled stub — the defect and its fix
 * live entirely in core's own hook-args/`StackContext`/`AccessContext`
 * types, so a stub would risk masking the exact thing under test.
 */

const COMPILE_TIMEOUT_MS = 60000

const PRISMA_STUB = `
export namespace Prisma {
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & U

  export type UserCreateInput = { name: string; password: string }
  export type UserUpdateInput = { name?: string; password?: string }
  export type UserSelect = { name?: boolean; password?: boolean }
  export type UserWhereInput = { name?: string }
  export type UserCreateArgs = { data: UserCreateInput; select?: UserSelect | null }
  export type UserUpdateArgs = { where: { id: string }; data: UserUpdateInput; select?: UserSelect | null }
  export type UserFindUniqueArgs = { where: { id: string }; select?: UserSelect | null }
  export type UserFindManyArgs = { where?: UserWhereInput; select?: UserSelect | null }
  export type UserFindFirstArgs = { where?: UserWhereInput; select?: UserSelect | null }
  export type UserDeleteArgs = { where: { id: string }; select?: UserSelect | null }
  export type UserCountArgs = { where?: UserWhereInput }
  export type UserGetPayload<T> = { id: string; name: string; password: string }

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
 * Two hooks, exercising both hook-arg families the generic-`Hooks<>`/
 * `FieldHooks<>` split feeds separately (`StackContext` for
 * resolveInput/validate/beforeOperation/afterOperation,
 * `AccessContext` for the rest) — both were threaded through
 * `TypeInfo['db']` by this fix, not just one:
 *
 * - Post's list-level `beforeOperation` reads `context.db.user` — the
 *   issue's own repro shape, one list's hook reading ANOTHER list's row.
 * - User's own field-level `validate` reads `context.db.post` — proves the
 *   field-level hook-args family (`AccessContext`) got the same fix.
 */
const CONSUMER = `
import { list } from '@opensaas/stack-core'
import { text, password, virtual } from '@opensaas/stack-core/fields'
import type { HashedPassword } from '@opensaas/stack-core/internal'
import type { Lists } from './lists.ts'

list<Lists.Post.TypeInfo>({
  fields: {
    title: text(),
  },
  hooks: {
    beforeOperation: async ({ context }) => {
      const user = await context.db.user.findUnique({ where: { id: 'u1' } })
      if (user) {
        // Probe 1: a virtual field folded into CustomDB's payload — the
        // exact #1232 repro — compiles and resolves its real type.
        const label: string = user.label
        void label

        // Probe 2: a transformed field's output override (password ->
        // HashedPassword) is visible too, not just plain virtual scalars.
        const hashed: HashedPassword | undefined = user.password
        void hashed

        // A field that exists on neither surface is still a compile error —
        // the row type stays real, it must not regress to 'any'.
        // @ts-expect-error 'doesNotExist' is not a property of the User row
        void user.doesNotExist
      }
    },
  },
})

list<Lists.User.TypeInfo>({
  fields: {
    name: text(),
    password: password(),
    label: virtual({
      type: 'string',
      hooks: { resolveOutput: () => 'label' },
    }),
  },
  hooks: {
    validate: async ({ context, addValidationError }) => {
      // Field-level hook-args family (AccessContext, not StackContext):
      // reading another list's row still resolves through CustomDB.
      const posts = await context.db.post.findMany()
      posts[0]?.title.toUpperCase()
      // @ts-expect-error 'doesNotExist' is not a property of the Post row
      posts[0]?.doesNotExist
      void addValidationError
    },
  },
})

void run
async function run() {}
`

function compileFixture(generatedTypes: string, generatedLists: string): ts.Diagnostic[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-hook-context-virtual-'))
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
    User: {
      fields: {
        name: text({ validation: { isRequired: true } }),
        password: password(),
        label: virtual({
          type: 'string',
          hooks: { resolveOutput: () => 'label' },
        }),
      },
    },
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
      },
    },
  },
}

describe("a hook's context.db folds in virtual and transformed fields, like CustomDB (#1232)", () => {
  it(
    'a list-level and a field-level hook both read a virtual field and a transformed field ' +
      "off another list's row through context.db, with no cast",
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generatedTypes = generateTypes(TEST_CONFIG)
      const generatedLists = generateListsNamespace(TEST_CONFIG)

      const diagnostics = compileFixture(generatedTypes, generatedLists)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      // Zero diagnostics: both probes compiled with no cast, AND both
      // @ts-expect-error lines above caught their intended error (an unmet
      // one is itself a diagnostic).
      expect(messages).toEqual([])
    },
  )

  it('generates a db member on every list TypeInfo, pointing at the generated CustomDB', () => {
    const generatedLists = generateListsNamespace(TEST_CONFIG)

    expect(generatedLists).toContain(`db: import('./types.ts').CustomDB`)
  })
})
