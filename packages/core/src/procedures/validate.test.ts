import { describe, expect, test } from 'vitest'
import * as z from 'zod'
import type { AccessControlledDB } from '../access/types.js'
import { config as defineConfig } from '../config/index.js'
import type { OpenSaasConfig } from '../config/types.js'
import { text } from '../fields/index.js'
import type { StackContext } from '../types/context.js'
import { createProcedureHandler } from './http.js'
import { createProcedureBuilder, type ProcedureRegistry } from './procedure.js'
import {
  assertProcedureNamesAvailable,
  assertProcedureRegistry,
  assertProcedureSchemas,
  ProcedureHostError,
} from './validate.js'

type Ctx = StackContext<AccessControlledDB>

const procedure = createProcedureBuilder<Ctx>()

function host(procedures: ProcedureRegistry<Ctx>, config?: OpenSaasConfig) {
  return createProcedureHandler<Ctx>({
    procedures,
    config,
    getContext: async () => {
      throw new Error('host creation never builds a context')
    },
    getSession: async () => null,
    allowedOrigins: ['http://app.test'],
  })
}

function withSchemas(input: z.ZodType, output: z.ZodType) {
  return procedure({
    description: 'A procedure under test',
    input,
    output,
    access: () => true,
    expose: ['web'],
    run: () => ({}),
  })
}

const plain = z.object({})

function refusal(create: () => unknown): string {
  try {
    create()
  } catch (error) {
    if (error instanceof ProcedureHostError) return error.message
    throw error
  }
  throw new Error('expected host creation to be refused')
}

interface SchemaCase {
  label: string
  side: 'input' | 'output'
  refused: z.ZodType
  part: string
  fix: string
  remedy: z.ZodType
}

const loop: z.ZodType = z.lazy(() => z.object({ next: loop.optional(), payload: z.unknown() }))
const fixedLoop: z.ZodType = z.lazy(() =>
  z.object({ next: fixedLoop.optional(), payload: z.string() }),
)

const cases: SchemaCase[] = [
  {
    label: 'a date in the input',
    side: 'input',
    refused: z.object({ when: z.date() }),
    part: '`input.when`',
    fix: 'z.iso.datetime()',
    remedy: z.object({ when: z.iso.datetime() }),
  },
  {
    label: 'a date in the output',
    side: 'output',
    refused: z.object({ rows: z.array(z.object({ createdAt: z.date() })) }),
    part: '`output.rows[].createdAt`',
    fix: 'z.iso.datetime()',
    remedy: z.object({ rows: z.array(z.object({ createdAt: z.iso.datetime() })) }),
  },
  {
    label: 'a bigint in the input',
    side: 'input',
    refused: z.object({ amount: z.bigint() }),
    part: '`input.amount`',
    fix: 'z.string()',
    remedy: z.object({ amount: z.string() }),
  },
  {
    label: 'a bigint in the output',
    side: 'output',
    refused: z.object({ total: z.bigint() }),
    part: '`output.total`',
    fix: 'z.int()',
    remedy: z.object({ total: z.int() }),
  },
  {
    label: 'an output transform',
    side: 'output',
    refused: z.object({ count: z.string().transform(Number) }),
    part: '`output.count`',
    fix: 'Move the transform into `run`',
    remedy: z.object({ count: z.number() }),
  },
  {
    label: 'an input with no JSON form',
    side: 'input',
    refused: z.undefined(),
    part: '`input`',
    fix: 'z.object({}).optional()',
    remedy: z.object({}).optional(),
  },
  {
    label: 'an output with no JSON form',
    side: 'output',
    refused: z.void(),
    part: '`output`',
    fix: 'z.null()',
    remedy: z.null(),
  },
  {
    label: 'any as the whole input',
    side: 'input',
    refused: z.any(),
    part: '`input`',
    fix: 'Declare the shape it carries',
    remedy: z.string(),
  },
  {
    label: 'unknown as the whole output',
    side: 'output',
    refused: z.unknown(),
    part: '`output`',
    fix: 'Declare the shape it carries',
    remedy: z.object({ id: z.string() }),
  },
  {
    label: 'unknown inside an array inside an object',
    side: 'input',
    refused: z.object({ filters: z.array(z.object({ value: z.unknown() })) }),
    part: '`input.filters[].value`',
    fix: 'Declare the shape it carries',
    remedy: z.object({ filters: z.array(z.object({ value: z.string() })) }),
  },
  {
    label: 'any behind an optional',
    side: 'input',
    refused: z.object({ extra: z.any().optional() }),
    part: '`input.extra`',
    fix: 'Declare the shape it carries',
    remedy: z.object({ extra: z.string().optional() }),
  },
  {
    label: 'unknown in a union option',
    side: 'output',
    refused: z.object({ value: z.union([z.string(), z.unknown()]) }),
    part: '`output.value`',
    fix: 'Declare the shape it carries',
    remedy: z.object({ value: z.union([z.string(), z.number()]) }),
  },
  {
    label: 'unknown in a tuple',
    side: 'input',
    refused: z.object({ pair: z.tuple([z.string(), z.unknown()]) }),
    part: '`input.pair[1]`',
    fix: 'Declare the shape it carries',
    remedy: z.object({ pair: z.tuple([z.string(), z.number()]) }),
  },
  {
    label: 'any in an intersection',
    side: 'input',
    refused: z.intersection(z.object({ a: z.string() }), z.object({ b: z.any() })),
    part: '`input.b`',
    fix: 'Declare the shape it carries',
    remedy: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
  },
  {
    label: 'unknown inside a recursive schema',
    side: 'output',
    refused: loop,
    part: '`output.payload`',
    fix: 'Declare the shape it carries',
    remedy: fixedLoop,
  },
  {
    label: 'a loose object in the input',
    side: 'input',
    refused: z.object({ meta: z.looseObject({ tag: z.string() }) }),
    part: '`input.meta`',
    fix: 'z.strictObject',
    remedy: z.object({ meta: z.strictObject({ tag: z.string() }) }),
  },
  {
    label: 'a passthrough object as the whole output',
    side: 'output',
    refused: z.object({ id: z.string() }).passthrough(),
    part: '`output`',
    fix: 'Use `z.object({ … })`',
    remedy: z.object({ id: z.string() }),
  },
  {
    label: 'a record of unknown values',
    side: 'input',
    refused: z.object({ attributes: z.record(z.string(), z.unknown()) }),
    part: '`input.attributes`',
    fix: 'z.record(z.string(), z.string())',
    remedy: z.object({ attributes: z.record(z.string(), z.string()) }),
  },
  {
    label: 'a record of any values in the output',
    side: 'output',
    refused: z.record(z.string(), z.any()),
    part: '`output`',
    fix: 'Declare the value type',
    remedy: z.record(z.string(), z.number()),
  },
  {
    label: 'an output object with a typed catchall',
    side: 'output',
    refused: z.object({ id: z.string() }).catchall(z.string()),
    part: '`output`',
    fix: 'Use `z.object({ … })` or `z.strictObject({ … })`',
    remedy: z.strictObject({ id: z.string() }),
  },
]

describe('schemas a host refuses when it is created', () => {
  for (const { label, side, refused, part, fix, remedy } of cases) {
    test(`${label} is refused, and the remedy the message names is accepted`, () => {
      const define = (schema: z.ZodType) =>
        side === 'input' ? withSchemas(schema, plain) : withSchemas(plain, schema)

      const message = refusal(() => host({ underTest: define(refused) }))
      expect(message).toContain('Procedure "underTest"')
      expect(message).toContain(part)
      expect(message).toContain(fix)

      expect(() => host({ underTest: define(remedy) })).not.toThrow()
    })
  }

  test('each schema is converted on its own side', () => {
    const decoded = z.string().transform((value) => value.length)
    expect(() => host({ sided: withSchemas(z.object({ text: decoded }), plain) })).not.toThrow()

    const message = refusal(() => host({ sided: withSchemas(plain, z.object({ text: decoded })) }))
    expect(message).toContain('on its output side')
    expect(message).toContain('`output.text`')
  })

  test('an input object with a typed catchall and a record of typed values are accepted', () => {
    expect(() =>
      host({
        typed: withSchemas(
          z.object({ id: z.string() }).catchall(z.number()),
          z.record(z.string(), z.string()),
        ),
      }),
    ).not.toThrow()
  })

  test('async refinements are accepted', () => {
    const refined = z.object({ title: z.string().refine(async (title) => title !== 'taken') })
    expect(() => host({ refined: withSchemas(refined, refined) })).not.toThrow()
  })

  test('the schema check is callable without a host', () => {
    expect(() =>
      assertProcedureSchemas('direct', { input: z.object({ at: z.date() }), output: plain }),
    ).toThrow(ProcedureHostError)
    expect(() =>
      assertProcedureSchemas('direct', { input: z.object({ at: z.string() }), output: plain }),
    ).not.toThrow()
  })
})

const ok = withSchemas(plain, plain)

function toolConfig(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Post: {
        fields: { title: text() },
        mcp: {
          customTools: [
            {
              name: 'publishPost',
              description: 'Publish a post',
              inputSchema: z.object({ id: z.string() }),
              handler: async () => ({}),
            },
          ],
        },
      },
    },
  }
}

describe('names a host refuses when it is created', () => {
  test('a name matching the reserved generated-tool pattern is refused with or without a config', () => {
    for (const config of [undefined, toolConfig()]) {
      const message = refusal(() => host({ list_post_update: ok }, config))
      expect(message).toContain('Procedure "list_post_update"')
      expect(message).toContain('reserved list_<list>_<operation> pattern')
      expect(message).toContain('Rename the procedure')
    }
    expect(refusal(() => host({ list_nothingByThatName_delete: ok }))).toContain(
      'Rename the procedure',
    )
    expect(() => host({ updatePost: ok }, toolConfig())).not.toThrow()
  })

  test('a name a list custom tool carries is refused', () => {
    const message = refusal(() => host({ publishPost: ok }, toolConfig()))
    expect(message).toContain('Procedure "publishPost"')
    expect(message).toContain('a custom tool on list "Post"')
    expect(message).toContain('rename the procedure or that tool')

    expect(() => host({ publishPostNow: ok }, toolConfig())).not.toThrow()
    const renamedTool = toolConfig()
    const tool = renamedTool.lists.Post?.mcp?.customTools?.[0]
    if (tool === undefined) throw new Error('fixture has a custom tool')
    tool.name = 'publishPostTool'
    expect(() => host({ publishPost: ok }, renamedTool)).not.toThrow()
  })

  test('a name a plugin-registered tool carries is refused', async () => {
    const withPlugin = (toolName: string) =>
      defineConfig({
        db: { provider: 'postgresql' },
        lists: { Post: { fields: { title: text() } } },
        plugins: [
          {
            name: 'search',
            init: async (context) => {
              context.registerMcpTool?.({
                name: toolName,
                description: 'Search everything',
                inputSchema: z.object({ query: z.string() }),
                handler: async () => ({}),
              })
            },
          },
        ],
      })

    const config = await withPlugin('semanticSearch')
    const message = refusal(() => host({ semanticSearch: ok }, config))
    expect(message).toContain('Procedure "semanticSearch"')
    expect(message).toContain('a plugin tool registered with registerMcpTool')
    expect(message).toContain('rename the procedure or that tool')

    expect(() => host({ searchPosts: ok }, config)).not.toThrow()
    const renamedTool = await withPlugin('pluginSearch')
    expect(() => host({ semanticSearch: ok }, renamedTool)).not.toThrow()
  })

  test('a host given no config checks only the reserved pattern', () => {
    expect(() => host({ publishPost: ok })).not.toThrow()
  })

  test('only a config own list answers to a name', () => {
    const config = toolConfig()
    expect(() => host({ toString: ok, constructor: ok, hasOwnProperty: ok }, config)).not.toThrow()
  })

  test('the collision check is callable without a registry', () => {
    expect(() => assertProcedureNamesAvailable(['publishPost'], toolConfig())).toThrow(
      ProcedureHostError,
    )
    expect(() => assertProcedureNamesAvailable(['list_post_query'])).toThrow(ProcedureHostError)
    expect(() => assertProcedureNamesAvailable(['archivePost'], toolConfig())).not.toThrow()
  })

  test('a registry is checked whole without a host', () => {
    expect(() => assertProcedureRegistry({ publishPost: ok }, { config: toolConfig() })).toThrow(
      ProcedureHostError,
    )
    expect(() => assertProcedureRegistry({ ok }, { config: toolConfig() })).not.toThrow()
  })
})
