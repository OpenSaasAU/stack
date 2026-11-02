import { describe, it, expect } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { planFkRenames, renderFkRenameSql } from './fk-renames.js'
import type { LiveSchema } from './fk-renames.js'

const models = [
  { name: 'LessonTerm', singleton: false, columns: [], relations: [], foreignKeys: [] },
  {
    name: 'Enrolment',
    singleton: false,
    columns: [{ name: 'lessonTermId', type: { pack: 'pg', type: 'uuid' }, nullable: false }],
    foreignKeys: [],
    relations: [
      {
        name: 'lessonTerm',
        target: 'LessonTerm',
        kind: 'belongsTo',
        column: 'lessonTermId',
        oneToOne: false,
        synthetic: false,
      },
    ],
  },
] as never

async function introspect(db: PGlite): Promise<LiveSchema> {
  const columns = await db.query<LiveSchema['columns'][number]>(
    `SELECT table_schema AS schema, table_name AS "table", column_name AS "column", udt_name AS type
       FROM information_schema.columns WHERE table_schema = 'public'`,
  )
  const constraints = await db.query<LiveSchema['constraints'][number]>(
    `SELECT n.nspname AS schema, t.relname AS "table", c.conname AS name
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype IN ('f','u') AND n.nspname = 'public'`,
  )
  const indexes = await db.query<LiveSchema['indexes'][number]>(
    `SELECT schemaname AS schema, indexname AS name FROM pg_indexes WHERE schemaname = 'public'`,
  )
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }
}

describe('fk renames against Postgres', () => {
  it('renames the column, constraint and index, then plans nothing', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE "LessonTerm" (id uuid PRIMARY KEY);
      CREATE TABLE "Enrolment" (id uuid PRIMARY KEY, "lessonTerm" uuid NOT NULL,
        CONSTRAINT "Enrolment_lessonTerm_fkey" FOREIGN KEY ("lessonTerm") REFERENCES "LessonTerm"(id));
      CREATE INDEX "Enrolment_lessonTerm_idx" ON "Enrolment"("lessonTerm");
    `)
    const plan = planFkRenames(models, await introspect(db))
    await db.exec(renderFkRenameSql(plan))

    const after = await introspect(db)
    expect(after.columns.map((c) => c.column)).toContain('lessonTermId')
    expect(after.columns.map((c) => c.column)).not.toContain('lessonTerm')
    expect(after.constraints.map((c) => c.name)).toEqual(['Enrolment_lessonTermId_fkey'])
    expect(after.indexes.map((i) => i.name)).toContain('Enrolment_lessonTermId_idx')
    expect(planFkRenames(models, after)).toEqual([])
    await db.close()
  })
})
