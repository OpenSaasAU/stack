import { describe, it, expect } from 'vitest'
import type { ContractModel } from '@opensaas/stack-core'
import { PGlite } from '@electric-sql/pglite'
import { planJunctionIds, renderJunctionIdSql } from './junction-ids.js'
import type { LiveSchema } from './fk-renames.js'

const junction = (id: ContractModel['id']): ContractModel => ({
  name: 'LessonTeachers',
  table: '_Lesson_teachers',
  singleton: false,
  id,
  columns: [],
  foreignKeys: [],
  indexes: [],
  relations: [],
  timestamps: { createdAt: false, updatedAt: false },
})

async function columns(db: PGlite): Promise<LiveSchema> {
  const rows = await db.query<LiveSchema['columns'][number]>(
    `SELECT table_schema AS schema, table_name AS "table", column_name AS "column", udt_name AS type
       FROM information_schema.columns WHERE table_schema = 'public'`,
  )
  return { columns: rows.rows, constraints: [], indexes: [] }
}

const ids: Array<[string, ContractModel['id']]> = [
  ['uuid7', { strategy: 'uuid7', type: { pack: 'pg', type: 'uuid' } }],
  ['cuid2', { strategy: 'cuid2', type: { pack: 'pg', type: 'char', args: [24] } }],
  ['int autoincrement', { strategy: 'int autoincrement', type: { pack: 'pg', type: 'int' } }],
]

describe('junction id backfill against Postgres', () => {
  for (const [label, id] of ids) {
    it(`adds a unique ${label} id to every existing row, then plans nothing`, async () => {
      const db = new PGlite()
      await db.exec(`
        CREATE TABLE "_Lesson_teachers" ("A" text NOT NULL, "B" text NOT NULL);
        INSERT INTO "_Lesson_teachers" VALUES ('a1','b1'),('a1','b2'),('a2','b1');
      `)
      const models = [junction(id)]
      const plan = planJunctionIds(models, await columns(db))
      expect(plan).toHaveLength(1)
      await db.exec(renderJunctionIdSql(plan))

      const rows = await db.query<{ id: string | number }>(`SELECT id FROM "_Lesson_teachers"`)
      expect(rows.rows).toHaveLength(3)
      expect(new Set(rows.rows.map((r) => r.id)).size).toBe(3)
      if (label === 'uuid7') {
        for (const row of rows.rows) expect(String(row.id)[14]).toBe('7')
      }
      if (label === 'cuid2') {
        for (const row of rows.rows) expect(String(row.id)).toMatch(/^c[0-9a-f]{23}$/)
      }
      expect(planJunctionIds(models, await columns(db))).toEqual([])
      await db.close()
    })
  }

  it('skips tables that already have a primary key', async () => {
    const db = new PGlite()
    await db.exec(`CREATE TABLE "_Lesson_teachers" ("A" text, "B" text, PRIMARY KEY ("A", "B"));`)
    const plan = planJunctionIds([junction(ids[0][1])], await columns(db), 'public', [
      { schema: 'public', table: '_Lesson_teachers' },
    ])
    expect(plan).toEqual([])
    await db.close()
  })

  it('skips tables that do not exist or already have an id', async () => {
    const db = new PGlite()
    await db.exec(`CREATE TABLE "Other" (id uuid PRIMARY KEY);`)
    const models = [
      junction(ids[0][1]),
      { ...junction(ids[0][1]), name: 'Other', table: undefined },
    ]
    expect(planJunctionIds(models, await columns(db))).toEqual([])
    await db.close()
  })
})
