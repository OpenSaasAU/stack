import { describe, it, expect } from 'vitest'
import type { ContractModel } from '@opensaas/stack-core'
import { planFkRenames, renderFkRenameSql, FkRenameConflictError } from './fk-renames.js'
import type { LiveSchema } from './fk-renames.js'

function model(name: string, overrides: Partial<ContractModel> = {}): ContractModel {
  return {
    name,
    singleton: false,
    id: { strategy: 'uuid7', type: { pack: 'pg', type: 'uuid' } },
    columns: [],
    foreignKeys: [],
    indexes: [],
    relations: [],
    timestamps: { createdAt: false, updatedAt: false },
    ...overrides,
  }
}

const enrolment = model('Enrolment', {
  columns: [{ name: 'lessonTermId', type: { pack: 'pg', type: 'uuid' }, nullable: false }],
  foreignKeys: [{ column: 'lessonTermId', references: { model: 'LessonTerm', column: 'id' } }],
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
})
const lessonTerm = model('LessonTerm')

function live(columns: string[], extra: Partial<LiveSchema> = {}): LiveSchema {
  return {
    columns: [
      { schema: 'public', table: 'LessonTerm', column: 'id', type: 'uuid' },
      ...columns.map((column) => ({ schema: 'public', table: 'Enrolment', column, type: 'uuid' })),
    ],
    constraints: [],
    indexes: [],
    ...extra,
  }
}

describe('planFkRenames', () => {
  it('renames a 0.43-shaped column to <field>Id', () => {
    const plan = planFkRenames([enrolment, lessonTerm], live(['id', 'lessonTerm']))
    expect(plan.map((r) => [r.table, r.from, r.to])).toEqual([
      ['Enrolment', 'lessonTerm', 'lessonTermId'],
    ])
  })

  it('is idempotent once the column is already renamed', () => {
    expect(planFkRenames([enrolment, lessonTerm], live(['id', 'lessonTermId']))).toEqual([])
  })

  it('skips a column the database has neither of', () => {
    expect(planFkRenames([enrolment, lessonTerm], live(['id']))).toEqual([])
  })

  it('refuses, naming the column, when both spellings exist', () => {
    expect(() =>
      planFkRenames([enrolment, lessonTerm], live(['id', 'lessonTerm', 'lessonTermId'])),
    ).toThrow(FkRenameConflictError)
    expect(() =>
      planFkRenames([enrolment, lessonTerm], live(['id', 'lessonTerm', 'lessonTermId'])),
    ).toThrow(/Enrolment\.lessonTerm/)
  })

  it('skips an old column whose type is not the FK target id type', () => {
    const schema = live([])
    schema.columns.push({
      schema: 'public',
      table: 'Enrolment',
      column: 'lessonTerm',
      type: 'text',
    })
    expect(planFkRenames([enrolment, lessonTerm], schema)).toEqual([])
  })

  it('renames default-named foreign key, unique and index constraints with it', () => {
    const plan = planFkRenames(
      [enrolment, lessonTerm],
      live(['id', 'lessonTerm'], {
        constraints: [{ schema: 'public', table: 'Enrolment', name: 'Enrolment_lessonTerm_fkey' }],
        indexes: [{ schema: 'public', name: 'Enrolment_lessonTerm_idx' }],
      }),
    )
    expect(plan[0].constraints).toEqual([
      { from: 'Enrolment_lessonTerm_fkey', to: 'Enrolment_lessonTermId_fkey' },
    ])
    expect(plan[0].indexes).toEqual([
      { from: 'Enrolment_lessonTerm_idx', to: 'Enrolment_lessonTermId_idx' },
    ])
  })

  it('honours db.map table names and namespaces', () => {
    const mapped = { ...enrolment, table: 'enrolments', namespace: 'school' }
    const target = { ...lessonTerm, namespace: 'school' }
    const schema: LiveSchema = {
      columns: [
        { schema: 'school', table: 'LessonTerm', column: 'id', type: 'uuid' },
        { schema: 'school', table: 'enrolments', column: 'lessonTerm', type: 'uuid' },
      ],
      constraints: [],
      indexes: [],
    }
    const plan = planFkRenames([mapped, target], schema)
    expect(renderFkRenameSql(plan)).toContain(
      'ALTER TABLE "school"."enrolments" RENAME COLUMN "lessonTerm" TO "lessonTermId";',
    )
  })

  it('does not touch a foreign key the application mapped explicitly', () => {
    const mapped = model('Enrolment', {
      ...enrolment,
      columns: [
        {
          name: 'lessonTermId',
          map: 'term_id',
          type: { pack: 'pg', type: 'uuid' },
          nullable: false,
        },
      ],
    })
    expect(planFkRenames([mapped, lessonTerm], live(['id', 'lessonTerm']))).toEqual([])
  })
})

describe('renderFkRenameSql', () => {
  it('emits nothing destructive', () => {
    const sql = renderFkRenameSql(
      planFkRenames(
        [enrolment, lessonTerm],
        live(['id', 'lessonTerm'], {
          constraints: [
            { schema: 'public', table: 'Enrolment', name: 'Enrolment_lessonTerm_fkey' },
          ],
        }),
      ),
    )
    expect(sql).toContain('RENAME COLUMN "lessonTerm" TO "lessonTermId"')
    expect(sql).toContain(
      'RENAME CONSTRAINT "Enrolment_lessonTerm_fkey" TO "Enrolment_lessonTermId_fkey"',
    )
    expect(sql).not.toMatch(/DROP/i)
  })
})

describe('planFkRenames identifier handling', () => {
  it('matches and renames constraint names Postgres truncated to 63 bytes', () => {
    const longTable = 'T'.repeat(50)
    const longModel = model(longTable, { ...enrolment, name: longTable })
    const clip = (n: string) => n.slice(0, 63)
    const plan = planFkRenames([longModel, lessonTerm], {
      columns: [
        { schema: 'public', table: 'LessonTerm', column: 'id', type: 'uuid' },
        { schema: 'public', table: longTable, column: 'lessonTerm', type: 'uuid' },
      ],
      constraints: [
        { schema: 'public', table: longTable, name: clip(`${longTable}_lessonTerm_fkey`) },
      ],
      indexes: [],
    })
    expect(plan[0].constraints).toEqual([
      { from: clip(`${longTable}_lessonTerm_fkey`), to: clip(`${longTable}_lessonTermId_fkey`) },
    ])
  })

  it('uses the supplied default schema for models without a namespace', () => {
    const schema = live(['id', 'lessonTerm'])
    const moved: LiveSchema = {
      ...schema,
      columns: schema.columns.map((c) => ({ ...c, schema: 'app' })),
    }
    expect(planFkRenames([enrolment, lessonTerm], moved)).toEqual([])
    expect(planFkRenames([enrolment, lessonTerm], moved, 'app')).toHaveLength(1)
  })
})

describe('planFkRenames composite indexes', () => {
  const audition = model('Audition', {
    columns: [
      { name: 'studentId', type: { pack: 'pg', type: 'uuid' }, nullable: false },
      { name: 'productionId', type: { pack: 'pg', type: 'uuid' }, nullable: false },
    ],
    relations: ['student', 'production'].map((name) => ({
      name,
      target: 'Person',
      kind: 'belongsTo' as const,
      column: `${name}Id`,
      oneToOne: false,
      synthetic: false,
    })),
  })
  const person = model('Person')
  const schema = (
    name: string,
    columns: string[],
    extra: Partial<LiveSchema> = {},
  ): LiveSchema => ({
    columns: [
      { schema: 'public', table: 'Person', column: 'id', type: 'uuid' },
      ...['student', 'production'].map((column) => ({
        schema: 'public',
        table: 'Audition',
        column,
        type: 'uuid',
      })),
    ],
    constraints: [],
    indexes: [{ schema: 'public', name }],
    compositeIndexes: [{ schema: 'public', table: 'Audition', name, columns }],
    ...extra,
  })

  it('renames a composite unique once, however many columns were renamed', () => {
    const name = 'Audition_student_production_key'
    const plan = planFkRenames([audition, person], schema(name, ['student', 'production']))
    const all = plan.flatMap((r) => [...r.constraints, ...r.indexes])
    expect(all).toEqual([{ from: name, to: 'Audition_studentId_productionId_key' }])
  })

  it('renames a unique constraint as a constraint', () => {
    const name = 'Audition_student_production_key'
    const plan = planFkRenames(
      [audition, person],
      schema(name, ['student', 'production'], {
        constraints: [{ schema: 'public', table: 'Audition', name }],
      }),
    )
    expect(plan.flatMap((r) => r.constraints)).toHaveLength(1)
    expect(plan.flatMap((r) => r.indexes)).toHaveLength(0)
  })

  it('renames an index mixing a renamed and an unrenamed column', () => {
    const name = 'Audition_id_student_key'
    const plan = planFkRenames([audition, person], schema(name, ['id', 'student']))
    expect(plan.flatMap((r) => r.indexes)).toContainEqual({
      from: name,
      to: 'Audition_id_studentId_key',
    })
  })

  it('leaves a name that is not the derived old name untouched', () => {
    const plan = planFkRenames([audition, person], schema('custom_name', ['student', 'production']))
    expect(plan.flatMap((r) => [...r.constraints, ...r.indexes])).toEqual([])
  })

  it('leaves an index pinned by an explicit db.indexes name untouched', () => {
    const name = 'Audition_student_production_key'
    const pinned = {
      ...audition,
      indexes: [{ columns: ['studentId', 'productionId'], unique: true, name }],
    }
    const plan = planFkRenames([pinned, person], schema(name, ['student', 'production']))
    expect(plan.flatMap((r) => [...r.constraints, ...r.indexes])).toEqual([])
  })

  it('renames to exactly the contract-derived name past 63 bytes', () => {
    const table = 'T'.repeat(40)
    const long = { ...audition, name: table }
    const oldCols = ['student', 'production']
    const clip = (base: string) => `${base.slice(0, 59)}_key`
    const name = clip(`${table}_${oldCols.join('_')}`)
    const live2: LiveSchema = {
      columns: [
        { schema: 'public', table: 'Person', column: 'id', type: 'uuid' },
        ...oldCols.map((column) => ({ schema: 'public', table, column, type: 'uuid' })),
      ],
      constraints: [],
      indexes: [{ schema: 'public', name }],
      compositeIndexes: [{ schema: 'public', table, name, columns: oldCols }],
    }
    const plan = planFkRenames([long, person], live2)
    expect(plan.flatMap((r) => r.indexes)).toEqual([
      { from: name, to: clip(`${table}_studentId_productionId`) },
    ])
  })
})
