import { describe, it, expect } from 'vitest'
import type { ContractModel } from '@opensaas/stack-core'
import { PGlite } from '@electric-sql/pglite'
import { planJunctionIds, renderJunctionIdSql, type PrimaryKey } from './junction-ids.js'
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

async function keys(db: PGlite): Promise<PrimaryKey[]> {
  const rows = await db.query<PrimaryKey>(
    `SELECT n.nspname AS schema, t.relname AS "table", c.conname AS name,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) AS k(num)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num) AS columns
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE c.contype = 'p' AND n.nspname = 'public'`,
  )
  return rows.rows
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

  for (const [label, id] of ids) {
    it(`replaces an A,B primary key with a ${label} id and the pair unique`, async () => {
      const db = new PGlite()
      await db.exec(`
        CREATE TABLE "_Lesson_teachers" ("A" text NOT NULL, "B" text NOT NULL, CONSTRAINT "custom_pkey" PRIMARY KEY ("A", "B"));
        INSERT INTO "_Lesson_teachers" VALUES ('a1','b1'),('a1','b2'),('a2','b1');
      `)
      const model = {
        ...junction(id),
        foreignKeys: [
          { column: 'A', references: { model: 'Lesson', column: 'id' as const } },
          { column: 'B', references: { model: 'Teacher', column: 'id' as const } },
        ],
        indexes: [{ columns: ['A', 'B'], unique: true, name: 'pair_idx', asIndex: true }],
      }
      const plan = planJunctionIds([model], await columns(db), 'public', await keys(db))
      expect(plan).toHaveLength(1)
      await db.exec(renderJunctionIdSql(plan))

      const rows = await db.query<{ id: string | number }>(`SELECT id FROM "_Lesson_teachers"`)
      expect(rows.rows).toHaveLength(3)
      expect(new Set(rows.rows.map((r) => r.id)).size).toBe(3)
      const pk = await keys(db)
      expect(pk.map((k) => k.columns)).toEqual([['id']])
      const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'pair_idx'`)
      expect(idx.rows).toHaveLength(1)
      await expect(
        db.exec(`INSERT INTO "_Lesson_teachers" ("A","B") VALUES ('a1','b1')`),
      ).rejects.toThrow()
      expect(planJunctionIds([model], await columns(db), 'public', pk)).toEqual([])
      await db.close()
    })
  }

  it('leaves a table with any other primary key alone', async () => {
    const db = new PGlite()
    await db.exec(
      `CREATE TABLE "_Lesson_teachers" ("A" text, "B" text, "C" text, PRIMARY KEY ("A", "C"));`,
    )
    const model = {
      ...junction(ids[0][1]),
      foreignKeys: [
        { column: 'A', references: { model: 'Lesson', column: 'id' as const } },
        { column: 'B', references: { model: 'Teacher', column: 'id' as const } },
      ],
    }
    const plan = planJunctionIds([model], await columns(db), 'public', await keys(db))
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
