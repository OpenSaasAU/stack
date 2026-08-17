import * as path from 'path'
import * as fs from 'fs'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'

/**
 * Absolute path to this package's own pinned native TypeScript 7 `tsc`
 * binary, resolved via the `@typescript/native` dependency (an alias for the
 * real `typescript` package — the plain `typescript` dependency is itself
 * aliased to the `@typescript/typescript6` compatibility shim so this
 * package's own code/tests can still use the classic Program API) rather
 * than shelled out to via `npx`. The Node build must always compile with the
 * version `@opensaas/stack-cli` ships, not whatever (if anything) happens to
 * be on `PATH`/installed in the target project.
 */
const tscBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')),
  'bin',
  'tsc',
)

/**
 * The **Node build** (ADR-0011): an opt-in, plain-Node-loadable form of the
 * Generated bundle, compiled to `<opensaasDir>/dist/` alongside the default
 * `.ts` bundler form (ADR-0008).
 *
 * Why this exists
 * ---------------
 * The default `.opensaas/` bundle ships as TypeScript with explicit `.ts`
 * import extensions so the host's bundler traces and transpiles it. That form
 * cannot execute under plain Node (`Cannot use import statement outside a
 * module`, and `.ts` specifiers don't resolve). A live module that must run in
 * BOTH a bundled and a bundler-less runtime — better-auth's Prisma adapter,
 * imported by the Next server AND by a Playwright e2e helper / build-time
 * script — therefore has no Node-loadable entry to point at. Setting
 * `output: { buildTarget: 'node' }` emits one.
 *
 * What it emits
 * -------------
 * A compiled ESM build under `<opensaasDir>/dist/`:
 *   - `context.js` — the compiled entry (mirrors `<opensaasDir>/context.ts`)
 *   - `prisma-client/**` — the compiled Prisma client subtree
 *   - `opensaas.config.js` — the project config, compiled in as a sibling of
 *     `context.js` so the entry's config import resolves without reaching
 *     outside `dist/`
 *   - matching `.d.ts` declarations
 *   - `package.json` containing exactly `{"type":"module"}` so the emitted
 *     `.js` are unambiguous ESM regardless of the host package's `type`
 *
 * How the layout is achieved
 * --------------------------
 * The on-disk `context.ts` imports the project config via
 * `../opensaas.config.ts` — one level ABOVE `<opensaasDir>`, outside the compile
 * root. To keep the compiled entry at `<opensaasDir>/dist/context.js` (per
 * ADR-0011) with a config import that resolves inside `dist/`, we stage the
 * bundle plus a copy of `opensaas.config.ts` into a hidden source directory
 * inside the bundle, rewrite the bundle's relative `opensaas.config` imports
 * (of any `../` depth) to the sibling `./opensaas.config.ts`, and compile that
 * staging root to
 * `<opensaasDir>/dist/`. Staging inside the project (rather than a temp dir)
 * keeps `node_modules` resolution intact so `@opensaas/*` and `@prisma/*`
 * resolve during the type-check pass. The staging directory is removed after
 * the emit.
 *
 * `rewriteRelativeImportExtensions` turns the bundle's `.ts`-extension imports
 * into runnable `.js` specifiers; `skipLibCheck` + `noEmitOnError: false` keep
 * third-party `.d.ts` noise (and the host's `@/*` path alias in the config,
 * which is type-only and elided from JS) from blocking emit.
 */

/** Bundle files copied into the staging root before compilation. */
const STAGED_BUNDLE_FILES = ['context.ts', 'types.ts', 'lists.ts', 'plugin-types.ts'] as const

/** The compiled Prisma client subtree, copied wholesale into the staging root. */
const PRISMA_CLIENT_DIR = 'prisma-client'

/** Name of the project config file copied into the staging root. */
const CONFIG_FILENAME = 'opensaas.config.ts'

/** Hidden staging directory created inside the bundle during compilation. */
const STAGING_DIRNAME = '.node-build'

/** Output directory name for the compiled Node build. */
const DIST_DIRNAME = 'dist'

/**
 * Matches a relative config specifier of ANY depth — one-or-more `../` segments
 * followed by `opensaas.config` (with or without a `.ts`/`.js` extension), in
 * either quote style. The generator emits that specifier from a configurable
 * source (`configImport ?? '../opensaas.config'` in `context.ts`), so a
 * non-default project layout (e.g. a deeper `../../opensaas.config.ts`) would
 * otherwise make a literal-string rewrite silently no-op. Capture group 1
 * preserves the quote style.
 */
const CONFIG_IMPORT_RE = /(['"])(?:\.\.\/)+opensaas\.config(?:\.ts|\.js)?\1/g

/**
 * The sibling specifier the config import is rewritten to so the compiled entry
 * imports the config from inside `dist/`. Mirrors the source `.ts` extension
 * (TypeScript's `rewriteRelativeImportExtensions` turns it into `.js` on emit).
 */
const CONFIG_IMPORT_TO = './opensaas.config.ts'

/**
 * Detects a relative config import that still escapes the staging/`dist` root
 * after the rewrite — one-or-more `../` segments followed by `opensaas.config`.
 * Non-global so it can be used with `String.prototype.match` to capture the
 * offending specifier for the error message.
 */
const ESCAPING_CONFIG_IMPORT_RE = /(['"])(?:\.\.\/)+opensaas\.config(?:\.ts|\.js)?\1/

export interface BuildNodeBundleOptions {
  /**
   * Absolute path to the resolved `.opensaas` bundle directory (the one holding
   * `context.ts`, `prisma-client/`, etc.).
   */
  opensaasDir: string
  /**
   * Absolute path to the project's `opensaas.config.ts`. Compiled in as a
   * sibling of the entry so the Node build is self-contained.
   */
  configPath: string
}

export interface BuildNodeBundleResult {
  /** Absolute path to the emitted `<opensaasDir>/dist/` directory. */
  distDir: string
  /** Absolute path to the compiled entry, `<opensaasDir>/dist/context.js`. */
  entry: string
  /**
   * Formatted `tsc` error lines surfaced during the compile (non-fatal; emit
   * still proceeds since the Node build never sets `--noEmitOnError`).
   */
  diagnostics: readonly string[]
}

/**
 * Recursively copy a directory tree. Used to stage the `prisma-client/`
 * subtree, which is many small files.
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Rewrite any relative `../`-rooted `opensaas.config` import (of any depth) in a
 * source string to the sibling `./opensaas.config.ts`, preserving the original
 * quote style, so the compiled output's config import resolves inside `dist/`.
 * Exported for unit testing of the any-depth rewrite.
 */
export function rewriteConfigImport(source: string): string {
  return source.replace(CONFIG_IMPORT_RE, (_match, quote: string) => {
    return `${quote}${CONFIG_IMPORT_TO}${quote}`
  })
}

/**
 * Return the first relative config import that still escapes the staging/`dist`
 * root (one-or-more `../` segments before `opensaas.config`), or `undefined` if
 * none remains. Exported so the silent-failure guard is unit-testable.
 */
export function findEscapingConfigImport(source: string): string | undefined {
  return source.match(ESCAPING_CONFIG_IMPORT_RE)?.[0]
}

/**
 * Copy a bundle source file into the staging root, rewriting the config import
 * to the sibling `./opensaas.config.ts`.
 */
function stageBundleFile(src: string, dest: string): void {
  const source = fs.readFileSync(src, 'utf-8')
  fs.writeFileSync(dest, rewriteConfigImport(source))
}

/**
 * The `tsconfig.json` compiler options for the Node build, as plain JSON
 * (TypeScript 7 dropped the synchronous `ts.createProgram`/`Program#emit()`
 * API from the `typescript` package's public surface, so the Node build now
 * shells out to the `tsc` CLI against a generated config instead). ESM output
 * (`esnext` + `bundler`) with the import-extension rewrite, declaration emit,
 * and the lenient settings that keep third-party `.d.ts` noise from blocking
 * the emit on an opt-in path.
 */
function nodeBuildCompilerOptions(outDir: string): Record<string, unknown> {
  return {
    // Rewrites the bundle's explicit `.ts`-extension imports (e.g.
    // `./prisma-client/client.ts`) to runnable `.js` specifiers.
    rewriteRelativeImportExtensions: true,
    // The on-disk bundle imports `.ts` extensions; permit reading them.
    allowImportingTsExtensions: true,
    // Emit `.d.ts` so the Node build is a fully typed import target.
    declaration: true,
    // ESM output. `bundler` resolution permits the `.ts`-extension imports while
    // `esnext` keeps `import`/`export` syntax (the `{"type":"module"}` marker
    // written into `dist/` makes the emitted `.js` unambiguous ESM).
    module: 'esnext',
    moduleResolution: 'bundler',
    target: 'es2022',
    rootDir: '.',
    outDir,
    // Third-party `.d.ts` (e.g. Prisma's) must not fail the type-check pass.
    skipLibCheck: true,
    // A production auth path must still emit even if a stray type error remains
    // (the bundle itself type-checks clean; this guards against host-config
    // noise like the `@/*` path alias, which is type-only and elided from JS).
    // `tsc` already defaults to emitting on type error when `--noEmitOnError`
    // is omitted, so no explicit option is needed here.
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
  }
}

/**
 * Compile the Generated bundle to a plain-Node-loadable ESM build under
 * `<opensaasDir>/dist/` (ADR-0011). Additive: the caller only invokes this when
 * `output.buildTarget === 'node'`, and it never touches the default `.ts` form.
 *
 * Assumes the `.ts` bundle and the Prisma client subtree
 * (`<opensaasDir>/prisma-client/**`) already exist on disk — i.e. it runs after
 * the bundle is written and after `prisma generate`.
 */
export function buildNodeBundle(options: BuildNodeBundleOptions): BuildNodeBundleResult {
  const { opensaasDir, configPath } = options
  const stagingDir = path.join(opensaasDir, STAGING_DIRNAME)
  const distDir = path.join(opensaasDir, DIST_DIRNAME)

  // Clean any prior staging/dist so re-runs are deterministic.
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.rmSync(distDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    // Stage the bundle source files, rewriting the config import to a sibling.
    for (const file of STAGED_BUNDLE_FILES) {
      const src = path.join(opensaasDir, file)
      if (!fs.existsSync(src)) continue
      const dest = path.join(stagingDir, file)
      stageBundleFile(src, dest)

      // Silent-failure guard (`noEmitOnError: false` lets TS emit even when a
      // config import escapes `dist/`): if a staged file STILL contains a
      // `../`-rooted `opensaas.config` import after the rewrite, the compiled
      // entry's config import would escape `dist/` and fail under plain Node
      // with no error surfaced. Fail loudly instead of emitting a broken build.
      const escaping = findEscapingConfigImport(fs.readFileSync(dest, 'utf-8'))
      if (escaping) {
        throw new Error(
          `Node build: staged bundle file "${file}" still imports the config ` +
            `via a relative path that escapes dist/ (${escaping}). The config ` +
            `import must be rewritten to a sibling of the entry. This is a ` +
            `silent-failure guard — compiling it would emit a Node build whose ` +
            `config import resolves outside dist/ and fails under plain Node.`,
        )
      }
    }

    // Stage the compiled Prisma client subtree as-is.
    const prismaClientSrc = path.join(opensaasDir, PRISMA_CLIENT_DIR)
    if (fs.existsSync(prismaClientSrc)) {
      copyDir(prismaClientSrc, path.join(stagingDir, PRISMA_CLIENT_DIR))
    }

    // Stage the project config as a sibling of the entry.
    fs.copyFileSync(configPath, path.join(stagingDir, CONFIG_FILENAME))

    // Write a throwaway tsconfig.json for the staged compile and shell out to
    // `tsc` (see `nodeBuildCompilerOptions` for why: TS 7 no longer exposes a
    // synchronous, emit-to-disk Program API from the `typescript` package).
    const tsconfigPath = path.join(stagingDir, 'tsconfig.json')
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: nodeBuildCompilerOptions(distDir),
          include: ['**/*.ts'],
        },
        null,
        2,
      ),
    )
    const diagnostics = runTsc(tsconfigPath, stagingDir)

    // Write the ESM marker so the emitted `.js` are unambiguous ESM.
    fs.writeFileSync(path.join(distDir, 'package.json'), '{"type":"module"}\n')

    return {
      distDir,
      entry: path.join(distDir, 'context.js'),
      diagnostics,
    }
  } finally {
    // Always remove the staging directory, even if the compile threw.
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
}

/**
 * Run `tsc -p <tsconfigPath>` and return its reported error lines. `tsc`
 * emits on type error by default (no `--noEmitOnError` is passed), so a
 * non-zero exit here means "compiled with diagnostics", not "failed to
 * compile" — `execFileSync` throws on that exit code, so both the success and
 * failure paths are handled to recover the captured stdout either way.
 */
function runTsc(tsconfigPath: string, cwd: string): string[] {
  let stdout: string
  try {
    stdout = execFileSync(process.execPath, [tscBin, '-p', tsconfigPath, '--pretty', 'false'], {
      cwd,
      encoding: 'utf-8',
    })
  } catch (err) {
    const execErr = err as { stdout?: string }
    stdout = execErr.stdout ?? ''
  }
  // Non-pretty `tsc` output is one diagnostic per line, e.g.
  // `src/context.ts(12,3): error TS2304: Cannot find name 'console'.`
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /: error TS\d+:/.test(line))
}

/**
 * Format Node-build diagnostics into a short, human-readable list. The Node
 * build is best-effort (`tsc` emits despite type errors here), so these are
 * surfaced as a warning rather than a failure.
 */
export function formatNodeBuildDiagnostics(diagnostics: readonly string[]): string {
  return diagnostics.join('\n')
}
