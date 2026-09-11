import { describe, it, expect } from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import ts from 'typescript'
import { generateContext } from './context.js'
import { generateTypes } from './types.js'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text, virtual } from '@opensaas/stack-core/fields'

/**
 * Compile-time regression test for #1328: the generated context factory
 * (`getContext`/`rawOpensaasContext` in `.opensaas/context.ts`) used to
 * `as unknown as Context<TSession>` its way past core's returned
 * `StackContext`, because core's `getContext` had no way to be told the
 * `db` description the generator wants (`CustomDB`) — it always returned
 * `StackContext<TPrisma>` with `db` defaulted to the plain
 * `AccessControlledDB<TPrisma>`, which a virtual field or a singleton list
 * makes genuinely incompatible with `CustomDB` (neither has an
 * `AccessControlledDB` counterpart — see the file-level comment on
 * `generateContext` in `./context.ts`).
 *
 * Core's `getContext` now takes a third, unconstrained `TDb` type parameter
 * (defaulting to `AccessControlledDB<TPrisma>` so every existing two-argument
 * call site is unaffected). The generator pins it to `CustomDB`, so the
 * returned value is already `StackContext<PrismaClient, CustomDB>` — no `db`
 * cast needed. A single, honest `as Context<TSession>` remains for the
 * unrelated `session` mismatch (`Context`'s `session: TSession` vs
 * `StackContext`'s always-nullable `session: Session | null` — core has no
 * session-generic parameter), but `as unknown as` is gone.
 *
 * This fixture compiles the REAL generated `context.ts` + `types.ts` against
 * core's REAL built `dist` (matching the pattern in
 * types-crud-seam-assignability.test.ts) for a schema carrying both a virtual
 * field and a singleton list — the two shapes the old cast's own comment
 * named as unrepresentable through `AccessControlledDB` — and asserts:
 *
 *  - the emitted source contains no `as unknown as`, and calls core's
 *    `getContext` with the `CustomDB` type argument;
 *  - the whole bundle type-checks with zero diagnostics;
 *  - `context.sudo()`, `context.withSession()`, and the `txContext` handed to
 *    `context.transaction()` all keep `db` typed as `CustomDB` (not widened
 *    back to a plain/untyped delegate) — an unselected field is still a
 *    compile error through each of them.
 */

const COMPILE_TIMEOUT_MS = 60000

const PRISMA_STUB = `
export class PrismaClient {}

export namespace Prisma {
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } & U

  // --- User (virtual field) ---
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

  // --- Settings (singleton) ---
  export type SettingsCreateInput = { siteName: string }
  export type SettingsUpdateInput = { siteName?: string }
  export type SettingsSelect = { siteName?: boolean }
  export type SettingsWhereInput = { siteName?: string }
  export type SettingsCreateArgs = { data: SettingsCreateInput; select?: SettingsSelect | null }
  export type SettingsUpdateArgs = { where: { id: string }; data: SettingsUpdateInput; select?: SettingsSelect | null }
  export type SettingsFindUniqueArgs = { where: { id: string }; select?: SettingsSelect | null }
  export type SettingsFindManyArgs = { where?: SettingsWhereInput; select?: SettingsSelect | null }
  export type SettingsFindFirstArgs = { where?: SettingsWhereInput; select?: SettingsSelect | null }
  export type SettingsDeleteArgs = { where: { id: string }; select?: SettingsSelect | null }
  export type SettingsCountArgs = { where?: SettingsWhereInput }
  export type SettingsGetPayload<T> = { id: string; siteName: string }
}
`

const PLUGIN_TYPES_STUB = `export type PluginServices = unknown\n`

/**
 * Exercises the generated `getContext()` end to end: a bare read still folds
 * in the virtual field, singleton `get()` works, and `db` stays typed as
 * `CustomDB` (not widened) through `sudo()`, `withSession()`, and a
 * `transaction()` callback alike — each probed with an `@ts-expect-error` on
 * a field neither list has, so a silent widening back to `any`/`unknown`
 * would be caught by an unused-directive error.
 */
const CONSUMER = `
import { getContext, rawOpensaasContext } from './context.ts'

async function run() {
  const context = await getContext()

  const user = await context.db.user.findUnique({ where: { id: 'u1' } })
  if (user) {
    const label: string = user.label
    void label
    // @ts-expect-error 'nope' is not a field on User
    void user.nope
  }

  const settings = await context.db.settings.get({})
  if (settings) {
    const siteName: string = settings.siteName
    void siteName
  }

  const sudoContext = context.sudo()
  const sudoSettings = await sudoContext.db.settings.get({})
  if (sudoSettings) {
    // @ts-expect-error 'nope' is not a field on Settings
    void sudoSettings.nope
  }

  const asOther = context.withSession({ userId: 'u2' })
  void (await asOther.db.user.findMany())

  await context.transaction(async (tx) => {
    const txUser = await tx.db.user.findUnique({ where: { id: 'u1' } })
    if (txUser) {
      // @ts-expect-error 'nope' is not a field on User
      void txUser.nope
    }
    return null
  })

  const raw = await rawOpensaasContext
  void (await raw.db.settings.get({}))
}

void run
`

function compileFixture(generatedTypes: string, generatedContext: string): ts.Diagnostic[] {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opensaas-context-typed-db-'))
  try {
    const opensaasDir = path.join(projectRoot, '.opensaas')
    const prismaClientDir = path.join(opensaasDir, 'prisma-client')
    fs.mkdirSync(prismaClientDir, { recursive: true })

    fs.writeFileSync(path.join(prismaClientDir, 'client.ts'), PRISMA_STUB)
    fs.writeFileSync(path.join(opensaasDir, 'types.ts'), generatedTypes)
    fs.writeFileSync(path.join(opensaasDir, 'context.ts'), generatedContext)
    fs.writeFileSync(path.join(opensaasDir, 'consumer.ts'), CONSUMER)
    fs.writeFileSync(path.join(opensaasDir, 'plugin-types.ts'), PLUGIN_TYPES_STUB)
    fs.writeFileSync(
      path.join(projectRoot, 'opensaas.config.ts'),
      [
        "import type { OpenSaasConfig } from '@opensaas/stack-core'",
        '',
        'const config: OpenSaasConfig = {',
        "  db: { provider: 'postgresql', prismaClientConstructor: (PrismaClientClass: any) => new PrismaClientClass() },",
        '  lists: {},',
        '}',
        'export default config',
      ].join('\n') + '\n',
    )

    // context.ts reads `process.env.NODE_ENV`; a minimal ambient declaration
    // stands in for @types/node so the fixture doesn't need it on the path.
    const globalsPath = path.join(projectRoot, 'globals.d.ts')
    fs.writeFileSync(
      globalsPath,
      'declare const process: { env: Record<string, string | undefined> }\n',
    )

    // core's own package root, so the fixture resolves the REAL
    // @opensaas/stack-core / /fields / /internal entry points (matching
    // types-crud-seam-assignability.test.ts / types-hook-context.test.ts) —
    // the new `TDb` parameter on `getContext` lives entirely in core's built
    // dist here, not a stub.
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
      path.join(opensaasDir, 'consumer.ts'),
      path.join(opensaasDir, 'context.ts'),
      path.join(opensaasDir, 'types.ts'),
      path.join(prismaClientDir, 'client.ts'),
      globalsPath,
    ]
    const program = ts.createProgram({ rootNames, options: compilerOptions })
    return [...ts.getPreEmitDiagnostics(program)]
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true })
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
    Settings: {
      isSingleton: true,
      fields: {
        siteName: text({ validation: { isRequired: true } }),
      },
    },
  },
}

describe('generated getContext()/rawOpensaasContext carry no `as unknown as` (#1328)', () => {
  it('emits getContext<..., CustomDB> with a single `as Context` cast, no `as unknown as`', () => {
    const generatedContext = generateContext(TEST_CONFIG)

    // The unrelated `globalThis as unknown as {...}` singleton-cache cast is
    // untouched by this fix — only the `getContext`/`rawOpensaasContext`
    // return-statement casts are asserted here.
    expect(generatedContext).not.toContain('as unknown as Context')
    expect(generatedContext).toContain('getOpensaasContext<typeof config, PrismaClient, CustomDB>')
    expect(generatedContext).toContain('as Context<TSession>')
    expect(generatedContext).toContain('as Context\n')
  })

  it(
    "type-checks a generated Context/CustomDB with a virtual field and a singleton list, uncast, against core's real dist",
    { timeout: COMPILE_TIMEOUT_MS },
    () => {
      const generatedTypes = generateTypes(TEST_CONFIG)
      const generatedContext = generateContext(TEST_CONFIG)

      const diagnostics = compileFixture(generatedTypes, generatedContext)
      const messages = diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))

      expect(messages).toEqual([])
    },
  )
})
