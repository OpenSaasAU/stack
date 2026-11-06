import { describe, expect, test } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'
import { guardedRuleItem, NO_RULE_VIEWS, ruleRowOf, type RuleViewTree } from './rule-item.js'

const config: OpenSaasConfig = {
  db: { provider: 'postgresql' },
  lists: {
    Ticket: {
      fields: {
        name: text(),
        notes: relationship({ ref: 'Note.ticket', many: true }),
        assignee: relationship({ ref: 'Agent' }),
      },
    },
    Note: {
      fields: { body: text(), ticket: relationship({ ref: 'Ticket.notes' }) },
    },
    Agent: { fields: { name: text() } },
  },
}

const fields: Record<string, FieldConfig> = config.lists.Ticket.fields

function guarded(row: Record<string, unknown>, views: RuleViewTree = NO_RULE_VIEWS) {
  return guardedRuleItem(ruleRowOf(row, views, fields, config, 'Ticket'))
}

function delivered(): Record<string, unknown> {
  return {
    id: 't1',
    name: 'ticket',
    meta: { tags: ['a'] },
    openedAt: new Date(0),
    assignee: null,
    notes: [
      { id: 'n2', body: 'two', ticket: null },
      { id: 'n1', body: 'one', ticket: null },
    ],
  }
}

describe('a rule item on a row withholding a relation', () => {
  const asks: readonly (readonly [string, (item: Record<string, unknown>) => unknown])[] = [
    ['a property read', (item) => item.notes],
    ['optional chaining', (item) => (item.notes as unknown[] | undefined)?.length],
    ['destructuring', ({ notes }) => notes],
    ['in', (item) => 'notes' in item],
    ['Object.hasOwn', (item) => Object.hasOwn(item, 'notes')],
    ['hasOwnProperty', (item) => Object.prototype.hasOwnProperty.call(item, 'notes')],
    ['a descriptor', (item) => Object.getOwnPropertyDescriptor(item, 'notes')],
    ['Object.keys', (item) => Object.keys(item)],
    ['Object.entries', (item) => Object.entries(item)],
    ['Object.values', (item) => Object.values(item)],
    ['Reflect.ownKeys', (item) => Reflect.ownKeys(item)],
    ['getOwnPropertyNames', (item) => Object.getOwnPropertyNames(item)],
    ['descriptors', (item) => Object.getOwnPropertyDescriptors(item)],
    ['a spread', (item) => ({ ...item })],
    ['a rest binding', ({ id: _id, ...rest }) => rest.notes],
    ['Object.assign', (item) => Object.assign({}, item)],
    ['JSON.stringify', (item) => JSON.stringify(item)],
    [
      'for...in',
      (item) => {
        const keys: string[] = []
        for (const key in item) keys.push(key)
        return keys
      },
    ],
  ]

  test.each(asks)('%s trips it', (_, ask) => {
    const { item, tripped } = guarded({ id: 't1', name: 'ticket', assignee: null })
    expect(tripped()).toBe(false)
    ask(item)
    expect(tripped()).toBe(true)
  })

  test('a rule that catches its own TypeError has still tripped it', () => {
    const { item, tripped } = guarded({ id: 't1', name: 'ticket', assignee: null })
    try {
      void (item.notes as unknown[]).length
    } catch {
      /* the rule swallows it */
    }
    expect(tripped()).toBe(true)
  })

  test('reading what the row carries does not', () => {
    const { item, tripped } = guarded({ id: 't1', name: 'ticket', assignee: null })
    expect(item.name).toBe('ticket')
    expect(item.assignee).toBeNull()
    expect('name' in item).toBe(true)
    expect(item.unknownColumn).toBeUndefined()
    expect(tripped()).toBe(false)
  })
})

describe('a rule item on a row carrying every relation', () => {
  test('looks like the plain object it stands for', () => {
    const row = delivered()
    const { item, tripped } = guarded(row)

    expect(Object.keys(item)).toEqual(Object.keys(row))
    expect({ ...item }).toEqual(row)
    expect(JSON.parse(JSON.stringify(item))).toEqual(JSON.parse(JSON.stringify(row)))
    expect(item.assignee).toBeNull()
    expect(Array.isArray(item.notes)).toBe(true)
    expect(item.openedAt).toBeInstanceOf(Date)
    expect(item.meta).toBe(item.meta)
    expect(tripped()).toBe(false)
  })

  test('a null relation is a fetched one, an undefined one is not', () => {
    const { item, tripped } = guarded({ id: 't1', notes: [], assignee: null })
    expect(item.assignee).toBeNull()
    expect(item.notes).toEqual([])
    expect(tripped()).toBe(false)

    const undefinedRelation = guarded({ id: 't1', notes: [], assignee: undefined })
    void undefinedRelation.item.assignee
    expect(undefinedRelation.tripped()).toBe(true)
  })

  test('a relation on a delivered row is tracked one level down', () => {
    const { item, tripped } = guarded({
      id: 't1',
      assignee: null,
      notes: [{ id: 'n1', body: 'one' }],
    })
    const [note] = item.notes as Record<string, unknown>[]
    expect(note.body).toBe('one')
    expect(tripped()).toBe(false)
    expect(note.ticket).toBeUndefined()
    expect(tripped()).toBe(true)
  })

  test('a relation key inside a JSON column is not a relation', () => {
    const { item, tripped } = guarded({ id: 't1', assignee: null, notes: [], meta: {} })
    expect((item.meta as Record<string, unknown>).notes).toBeUndefined()
    expect(tripped()).toBe(false)
  })

  test('a synthetic back-relation is a relation of the list it lands on', () => {
    const agent = guardedRuleItem(
      ruleRowOf({ id: 'a1' }, NO_RULE_VIEWS, config.lists.Agent.fields, config, 'Agent'),
    )
    expect(agent.item.from_Ticket_assignee).toBeUndefined()
    expect(agent.tripped()).toBe(true)
  })
})

describe('a rule item resists being written through', () => {
  const writes: readonly (readonly [string, (item: Record<string, unknown>) => void])[] = [
    ['assignment', (item) => (item.name = 'x')],
    ['delete', (item) => delete item.name],
    ['defineProperty', (item) => Object.defineProperty(item, 'name', { value: 'x' })],
    ['setPrototypeOf', (item) => Object.setPrototypeOf(item, null)],
    ['freeze', (item) => Object.freeze(item)],
    ['a nested array', (item) => (item.notes as unknown[]).pop()],
    ['a nested array sort', (item) => (item.notes as unknown[]).sort()],
    ['a nested row', (item) => ((item.notes as Record<string, unknown>[])[0].body = 'x')],
    ['a JSON column', (item) => ((item.meta as Record<string, unknown>).tags = [])],
    [
      'a nested JSON array',
      (item) => ((item.meta as Record<string, unknown[]>).tags as unknown[]).push('b'),
    ],
    [
      'a descriptor value',
      (item) => (Object.getOwnPropertyDescriptor(item, 'notes')?.value as unknown[]).pop(),
    ],
  ]

  test.each(writes)('%s changes nothing and trips it', (_, write) => {
    const row = delivered()
    const before = structuredClone(row)
    const { item, tripped } = guarded(row)

    try {
      write(item)
    } catch {
      /* a strict-mode write through the membrane throws */
    }

    expect(row).toEqual(before)
    expect(tripped()).toBe(true)
  })

  test('a Date cannot be moved under the next rule', () => {
    const row = delivered()
    const { item } = guarded(row)
    ;(item.openedAt as Date).setFullYear(2000)
    expect(row.openedAt).toEqual(new Date(0))
  })

  test('a frozen value is still readable', () => {
    const { item, tripped } = guarded({
      id: 't1',
      assignee: null,
      notes: [],
      meta: Object.freeze({ fixed: Object.freeze({ a: 1 }) }),
    })
    expect((item.meta as Record<string, Record<string, unknown>>).fixed.a).toBe(1)
    expect(tripped()).toBe(false)
  })
})

describe('each evaluation has its own record', () => {
  test('one rule tripping leaves the next rule on the same row alone', () => {
    const row = ruleRowOf({ id: 't1', assignee: null }, NO_RULE_VIEWS, fields, config, 'Ticket')
    const first = guardedRuleItem(row)
    const second = guardedRuleItem(row)

    void first.item.notes

    expect(first.tripped()).toBe(true)
    expect(second.tripped()).toBe(false)
  })
})

describe('without a config to name the list', () => {
  test("the row's own relationship fields are still withheld", () => {
    const { item, tripped } = guardedRuleItem(
      ruleRowOf({ id: 't1' }, NO_RULE_VIEWS, fields, undefined, undefined),
    )
    void item.notes
    expect(tripped()).toBe(true)
  })
})
