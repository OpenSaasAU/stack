import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { expect, test } from 'vitest'

test('a production bundle cannot discover Dev state from its deployed working directory', async () => {
  const project = await mkdtemp(path.join(tmpdir(), 'opensaas-production-trace-'))
  try {
    await mkdir(path.join(project, '.opensaas'))
    await writeFile(
      path.join(project, '.opensaas', 'dev-db.json'),
      JSON.stringify({ url: 'postgres://development-only', pid: process.pid }),
    )
    const entry = path.join(project, 'runtime.mjs')
    await build({
      entryPoints: [fileURLToPath(new URL('./url.ts', import.meta.url))],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      define: { 'process.env.NODE_ENV': '"production"' },
    })

    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { findDatabaseUrl } from ${JSON.stringify(pathToFileURL(entry).href)};
         console.log(findDatabaseUrl());`,
      ],
      {
        cwd: project,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'development',
          DATABASE_URL: '',
          DIRECT_DATABASE_URL: '',
          OPENSAAS_DEV_DATABASE_STATE_FILE: '',
        },
      },
    )

    expect(output.trim()).toBe('undefined')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
