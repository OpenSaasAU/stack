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
  } as ContractModel
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
