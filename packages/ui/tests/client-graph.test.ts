// @vitest-environment node
import { builtinModules, isBuiltin } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const BUNDLE = 120_000

const NODE_BUILTINS = [...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'node:*']

function entry(path: string): string {
  return fileURLToPath(new URL(`../src/${path}`, import.meta.url))
}

/**
 * The Node builtins imported by any module that reaches a browser bundle of
 * `entryPoint`. A `'use client'` module importing `@opensaas/stack-ui` puts this
 * whole index in the client graph, where `next dev` refuses a builtin and `next
 * build` does not.
 *
 * It reads each included module's own imports rather than the bundle's, because
 * `next dev` keeps a module whole where esbuild shakes an unused builtin import
 * away. It starts from what contributes code rather than walking every import,
 * because core's root barrel re-exports server modules that only `sideEffects:
 * false` keeps out.
 */
async function builtinsReachedFrom(entryPoint: string): Promise<string[]> {
  const { metafile } = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    outdir: 'client-graph-out',
    logLevel: 'silent',
    external: NODE_BUILTINS,
    loader: { '.css': 'empty' },
  })
  return Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0)
      .flatMap(([path]) =>
        (metafile.inputs[path]?.imports ?? [])
          .filter((reached) => isBuiltin(reached.path))
          .map((reached) => `${reached.path} via ${path}`),
      ),
  )
}

describe('the client graph reaches no Node builtin', () => {
  it.each([
    ['@opensaas/stack-ui', 'index.ts'],
    ['@opensaas/stack-ui/primitives', 'primitives/index.ts'],
    ['@opensaas/stack-ui/fields', 'components/fields/index.ts'],
    ['@opensaas/stack-ui/standalone', 'components/standalone/index.ts'],
  ])(
    '%s',
    async (_name, path) => {
      expect(await builtinsReachedFrom(entry(path))).toEqual([])
    },
    BUNDLE,
  )
})
