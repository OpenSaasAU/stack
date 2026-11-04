import { describe, it, expect } from 'vitest'
import { deriveContract, list, type ContractModel } from '@opensaas/stack-core'
import { relationship, text } from '@opensaas/stack-core/fields'
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

  describe('a junction list declared with foreignKey.map', () => {
    const recipe = () => {
      const contract = deriveContract({
        db: { provider: 'postgresql', idField: 'cuid2' },
        lists: {
          Lesson: list({
            fields: {
              title: text(),
              teachers: relationship({ ref: 'LessonTeacher.lesson', many: true }),
            },
          }),
          Teacher: list({
            fields: {
              name: text(),
              lessons: relationship({ ref: 'LessonTeacher.teacher', many: true }),
            },
          }),
          LessonTeacher: list({
            fields: {
              lesson: relationship({
                ref: 'Lesson.teachers',
                db: { foreignKey: { map: 'A' }, isNullable: false },
              }),
              teacher: relationship({
                ref: 'Teacher.lessons',
                db: { foreignKey: { map: 'B' }, isNullable: false },
              }),
            },
            db: {
              map: '_Lesson_teachers',
              indexes: [{ fields: ['lesson', 'teacher'], unique: true }, { fields: ['teacher'] }],
            },
          }),
        },
      })
      const model = contract.models.find((m) => m.name === 'LessonTeacher')
      if (model === undefined) throw new Error('LessonTeacher missing')
      return model
    }

    it('replaces the (A,B) key, names physical columns, and re-plans empty', async () => {
      const db = new PGlite()
      await db.exec(`
        CREATE TABLE "_Lesson_teachers" ("A" text NOT NULL, "B" text NOT NULL, PRIMARY KEY ("A", "B"));
        INSERT INTO "_Lesson_teachers" VALUES ('a1','b1'),('a1','b2'),('a2','b1');
      `)
      const model = recipe()
      const plan = planJunctionIds([model], await columns(db), 'public', await keys(db))
      expect(plan).toHaveLength(1)
      expect(plan[0]?.pairUnique?.columns).toEqual(['A', 'B'])
      const sql = renderJunctionIdSql(plan)
      expect(sql).not.toContain('lessonId')
      expect(sql).not.toContain('teacherId')
      await db.exec(sql)

      const rows = await db.query<{ id: string }>(`SELECT id FROM "_Lesson_teachers"`)
      expect(new Set(rows.rows.map((r) => r.id)).size).toBe(3)
      await expect(
        db.exec(`INSERT INTO "_Lesson_teachers" ("A","B") VALUES ('a1','b1')`),
      ).rejects.toThrow()
      expect(planJunctionIds([model], await columns(db), 'public', await keys(db))).toEqual([])
      await db.close()
    })

    it('still skips a table whose key is not the two physical columns', async () => {
      const db = new PGlite()
      await db.exec(
        `CREATE TABLE "_Lesson_teachers" ("A" text, "B" text, "C" text, PRIMARY KEY ("A", "C"));`,
      )
      const plan = planJunctionIds([recipe()], await columns(db), 'public', await keys(db))
      expect(plan).toEqual([])
      await db.close()
    })
  })
})
