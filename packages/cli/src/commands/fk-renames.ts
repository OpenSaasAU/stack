import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import pg from 'pg'
import { deriveContract, resolveDatabaseUrl } from '@opensaas/stack-core'
import { loadOpenSaasConfig, loadProjectEnvFile } from '../generator/index.js'
import { planFkRenames, renderFkRenameSql } from '../migration/fk-renames.js'
import type { LiveSchema } from '../migration/fk-renames.js'

export interface FkRenamesOptions {
  apply?: boolean
  out?: string
}

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema')`

async function introspect(client: pg.Client): Promise<LiveSchema> {
  const columns = await client.query<{
    schema: string
    table: string
    column: string
    type: string
  }>(
    `SELECT table_schema AS schema, table_name AS "table", column_name AS "column", udt_name AS type
       FROM information_schema.columns WHERE table_schema NOT IN ${SYSTEM_SCHEMAS}`,
  )
  const constraints = await client.query<{ schema: string; table: string; name: string }>(
    `SELECT n.nspname AS schema, t.relname AS "table", c.conname AS name
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype IN ('f', 'u') AND n.nspname NOT IN ${SYSTEM_SCHEMAS}`,
  )
  const indexes = await client.query<{ schema: string; name: string }>(
    `SELECT schemaname AS schema, indexname AS name FROM pg_indexes
      WHERE schemaname NOT IN ${SYSTEM_SCHEMAS}`,
  )
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }
}

/**
 * `opensaas migrate fk-renames` — emits the ADR-0069 `<field>` → `<field>Id`
 * column renames against the live database. Without `--apply` it prints the
 * SQL (or writes it to `--out`); with `--apply` it runs it in one transaction.
 */
export async function fkRenamesCommand(options: FkRenamesOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('opensaas.config.ts not found in current directory'))
    process.exitCode = 1
    return
  }
  loadProjectEnvFile(cwd)
  const { config } = await loadOpenSaasConfig(cwd, configPath)
  const { models } = deriveContract(config)

  const client = new pg.Client({ connectionString: resolveDatabaseUrl().url })
  await client.connect()
  try {
    const plan = planFkRenames(models, await introspect(client))
    if (plan.length === 0) {
      console.log(chalk.green('No foreign-key columns need renaming.'))
      return
    }
    const sql = renderFkRenameSql(plan)

    if (options.apply) {
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      console.log(chalk.green(`Renamed ${plan.length} foreign-key column(s).`))
      return
    }
    if (options.out) {
      fs.writeFileSync(path.resolve(cwd, options.out), `${sql}\n`)
      console.log(chalk.green(`Wrote ${plan.length} rename(s) to ${options.out}`))
      return
    }
    console.log(sql)
  } finally {
    await client.end()
  }
}
