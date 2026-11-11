import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@/.opensaas/context', replacement: here('./lib/context-stub.ts') },
      { find: /^@\//, replacement: here('./') },
    ],
  },
})
