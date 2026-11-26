import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import ts from 'typescript'
import type { OpenSaasConfig } from '@opensaas/stack-core'
import { text } from '@opensaas/stack-core/fields'
import {
  CONSUMER_PRELUDE,
  emitTypeFixture,
  type TypeFixture,
} from '../../tests/emit-type-fixture.js'
import { generateProcedures } from './procedures.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Post: {
      fields: {
        title: text({ validation: { isRequired: true } }),
        body: text(),
      },
    },
  },
}

function importsOf(source: string): Array<{ specifier: string; typeOnly: boolean }> {
  const file = ts.createSourceFile('procedures.ts', source, ts.ScriptTarget.ESNext)
  return file.statements.filter(ts.isImportDeclaration).map((declaration) => ({
    specifier: ts.isStringLiteral(declaration.moduleSpecifier)
      ? declaration.moduleSpecifier.text
      : '',
    typeOnly: declaration.importClause?.isTypeOnly === true,
  }))
}

describe('the generated procedure builder', () => {
  it('reaches neither the config nor the context factory', () => {
    expect(importsOf(generateProcedures())).toEqual([
      { specifier: '@opensaas/stack-core/procedures', typeOnly: false },
      { specifier: './types.ts', typeOnly: true },
    ])
  })

  describe('typed to the app’s own context', () => {
    let fixture: TypeFixture

    beforeAll(async () => {
      fixture = await emitTypeFixture('procedures', config)
    }, 300_000)

    afterAll(() => {
      fixture?.cleanup()
    })

    it(
      'infers input, checks output and db, and omits privileged members',
      { timeout: 300_000 },
      () => {
        const output = fixture.check(`${CONSUMER_PRELUDE}
import * as z from 'zod'
import { procedure } from './.opensaas/procedures.ts'

export const createPost = procedure({
  description: 'Create a post',
  input: z.object({ title: z.string(), count: z.number().optional() }),
  output: z.object({ id: z.string(), title: z.string() }),
  access: (args) => {
    // @ts-expect-error access never receives the input
    void args.input
    return args.session !== null && args.context.session !== null
  },
  expose: ['web'],
  run: async ({ input, context }) => {
    assertType<Exact<typeof input, { title: string; count?: number | undefined }>>()
    // @ts-expect-error the context has no sudo()
    context.sudo()
    // @ts-expect-error the context has no Unsafe surface
    void context.unsafe
    // @ts-expect-error the context cannot switch session
    context.withSession(null)
    // @ts-expect-error the context has no admin action
    void context.serverAction
    // @ts-expect-error the app has no list called Comment
    void context.db.Comment
    const post = await context.db.Post.create({ data: { title: input.title } })
    if (post === null) throw new Error('not created')
    return post
  },
})

procedure({
  description: 'Wrong output',
  input: z.object({}),
  output: z.object({ id: z.string() }),
  access: () => true,
  expose: ['mcp'],
  // @ts-expect-error run must return what the output schema accepts
  run: () => ({ id: 1 }),
})

// @ts-expect-error description is required
procedure({ input: z.object({}), output: z.object({}), access: () => true, expose: ['web'], run: () => ({}) })

// @ts-expect-error access is required
procedure({ description: 'x', input: z.object({}), output: z.object({}), expose: ['web'], run: () => ({}) })

procedure({
  description: 'x',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  // @ts-expect-error exposure may not be empty
  expose: [],
  run: () => ({}),
})

procedure({
  description: 'x',
  input: z.object({}),
  output: z.object({}),
  access: () => true,
  // @ts-expect-error only web and mcp are surfaces
  expose: ['cli'],
  run: () => ({}),
})
`)

        expect(output).toBe('')
      },
    )
  })
})
