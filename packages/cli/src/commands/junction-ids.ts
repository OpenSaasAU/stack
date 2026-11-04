import * as fs from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import pg from 'pg'
import { deriveContract, resolveDatabaseUrl } from '@opensaas/stack-core'
import { loadOpenSaasConfig, loadProjectEnvFile } from '../generator/index.js'
import { planJunctionIds, renderJunctionIdSql, type PrimaryKey } from '../migration/junction-ids.js'
import { introspect } from './fk-renames.js'

export interface JunctionIdsOptions {
  apply?: boolean
  out?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `opensaas migrate junction-ids` — adds and backfills the surrogate `id` on
 * existing tables a list is mapped onto that have none, such as Prisma's
 * implicit `_X_y(A, B)` many-to-many tables (ADR-0048).
 */
export async function junctionIdsCommand(options: JunctionIdsOptions = {}): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'opensaas.config.ts')
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('opensaas.config.ts not found in current directory'))
    process.exitCode = 1
    return
  }
  if (options.apply && options.out) {
    console.error(chalk.red('--apply and --out cannot be combined'))
    process.exitCode = 1
    return
  }
  loadProjectEnvFile(cwd)
  const { config } = await loadOpenSaasConfig(cwd, configPath)
  const { models } = deriveContract(config)

  const client = new pg.Client({ connectionString: resolveDatabaseUrl().url })
  try {
    await client.connect()
  } catch (error) {
    console.error(chalk.red(`Could not connect to the database: ${errorMessage(error)}`))
    process.exitCode = 1
    return
  }
  try {
    const current = await client.query<{ schema: string }>('SELECT current_schema() AS schema')
    const primaryKeys = await client.query<PrimaryKey>(
      `SELECT n.nspname AS schema, t.relname AS "table", c.conname AS name,
              ARRAY(SELECT a.attname::text FROM unnest(c.conkey) AS k(num)
                      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS columns
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE c.contype = 'p' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`,
    )
    const plan = planJunctionIds(
      models,
      await introspect(client),
      current.rows[0]?.schema,
      primaryKeys.rows,
    )
    if (plan.length === 0) {
      console.log(chalk.green('No tables need an id column.'))
      return
    }
    const sql = renderJunctionIdSql(plan)

    if (options.apply) {
      try {
        await client.query(sql)
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
      console.log(chalk.green(`Added an id column to ${plan.length} table(s).`))
      return
    }
    if (options.out) {
      fs.writeFileSync(path.resolve(cwd, options.out), `${sql}\n`)
      console.log(chalk.green(`Wrote ${plan.length} table change(s) to ${options.out}`))
      return
    }
    console.log(sql)
  } catch (error) {
    console.error(chalk.red(errorMessage(error)))
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
