import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import type { Session } from './types.js'
import type { SessionVocabularyQuestions } from './session-vocabulary.js'
import { engineContextOf, type AnyStackContext } from '../context/engine-context.js'
import { relationship, text, virtual } from '../fields/index.js'
import { createTestDatabase, untypedRule, type TestDatabase } from '../testing/index.js'

const BOOT = 120_000

const author: Session = { userId: 'author-1', role: 'author' }

let asked: string[] = []

function counting(name: string, answer = true): () => boolean {
  return () => {
    asked.push(name)
    return answer
  }
}

function countedField(name: string) {
  return text({
    access: {
      read: counting(`${name}.read`),
      create: counting(`${name}.create`),
      update: counting(`${name}.update`),
    },
  })
}

function countedOperations(listKey: string) {
  return {
    query: counting(`${listKey}.query`),
    create: counting(`${listKey}.create`),
    update: counting(`${listKey}.update`),
    delete: counting(`${listKey}.delete`),
  }
}

const redirectSignal = Object.assign(new Error('NEXT_REDIRECT'), {
  digest: 'NEXT_REDIRECT;replace;/sign-in;307;',
})
let redirecting = false

const config: OpenSaasConfig = {
  db: { provider: 'postgresql', timestamps: true },
  lists: {
    Related: {
      fields: {
        label: countedField('label'),
        other: countedField('other'),
        third: countedField('third'),
        computed: virtual({ type: 'string', hooks: { resolveOutput: () => 'computed' } }),
        owner: relationship({ ref: 'Owner.related' }),
      },
      access: { operation: countedOperations('Related') },
    },
    Owner: {
      fields: { name: text(), related: relationship({ ref: 'Related.owner', many: true }) },
      access: { operation: countedOperations('Owner') },
    },
    Closed: {
      fields: { label: countedField('closed.label') },
      access: {
        operation: {
          query: counting('Closed.query', false),
          create: counting('Closed.create', false),
        },
      },
    },
    Nothing: {
      fields: { label: countedField('nothing.label') },
      access: {
        operation: {
          query: untypedRule(() => null),
          create: untypedRule(() => undefined),
        },
      },
    },
    Settings: {
      isSingleton: true,
      fields: { siteName: countedField('siteName') },
      access: { operation: countedOperations('Settings') },
    },
    Redirecting: {
      fields: {
        title: text({
          access: {
            read: () => {
              asked.push('Redirecting.title.read')
              if (redirecting) throw redirectSignal
              return true
            },
          },
        }),
      },
      access: { operation: { query: () => true } },
    },
  },
}

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase(config)
}, BOOT)

afterAll(async () => {
  await database?.close()
})

beforeEach(() => {
  asked = []
  vi.restoreAllMocks()
})

function questionsOf(context: AnyStackContext, listKey: string): SessionVocabularyQuestions {
  const questions = engineContextOf(context)._sessionVocabularyQuestions?.(listKey)
  if (questions === undefined || questions === null) {
    throw new Error(`No session vocabulary questions for "${listKey}"`)
  }
  return questions
}

function fieldOf(questions: SessionVocabularyQuestions, fieldName: string) {
  const field = questions.field(fieldName)
  if (field === undefined) throw new Error(`No questions for "${fieldName}"`)
  return field
}

describe('asking the session vocabulary one question at a time', () => {
  test(
    "a related list's query and one field's filterable ask only the rules those answers need",
    async () => {
      const questions = questionsOf(database.context(author), 'Related')

      expect(await questions.operation('query')).toBe('allow')
      expect(await fieldOf(questions, 'label').filterable()).toBe(true)

      expect(asked.sort()).toEqual(['Related.query', 'label.read'])
    },
    BOOT,
  )

  test(
    "one field's sortable asks only the list's query and that field's read",
    async () => {
      const questions = questionsOf(database.context(author), 'Related')

      expect(await fieldOf(questions, 'other').sortable()).toBe(true)

      expect(asked.sort()).toEqual(['Related.query', 'other.read'])
    },
    BOOT,
  )

  test(
    "one field's create asks only the list's create and that field's create",
    async () => {
      const questions = questionsOf(database.context(author), 'Related')

      expect(await fieldOf(questions, 'third').create()).toBe('allow')

      expect(asked.sort()).toEqual(['Related.create', 'third.create'])
    },
    BOOT,
  )

  test(
    'a field that stores nothing answers its writes deny without asking any rule',
    async () => {
      const questions = questionsOf(database.context(author), 'Owner')

      expect(await fieldOf(questions, 'related').create()).toBe('deny')
      expect(await fieldOf(questions, 'related').update()).toBe('deny')
      expect(
        await fieldOf(questionsOf(database.context(author), 'Related'), 'computed').update(),
      ).toBe('deny')

      expect(asked).toEqual([])
    },
    BOOT,
  )

  test(
    'a relationship field names its target list without asking any rule',
    async () => {
      const questions = questionsOf(database.context(author), 'Related')

      expect(fieldOf(questions, 'owner').relationship).toEqual({ targetList: 'Owner' })
      expect(fieldOf(questions, 'label').relationship).toBeNull()
      expect(asked).toEqual([])
    },
    BOOT,
  )

  test(
    'a list denied query answers its fields unreadable without asking their read rules',
    async () => {
      const questions = questionsOf(database.context(author), 'Closed')

      expect(await fieldOf(questions, 'label').read()).toBe('deny')
      expect(await fieldOf(questions, 'label').filterable()).toBe(false)
      expect(await fieldOf(questions, 'id').read()).toBe('deny')

      expect(asked).toEqual(['Closed.query'])
    },
    BOOT,
  )

  test(
    'a rule answering null or undefined denies',
    async () => {
      const questions = questionsOf(database.context(author), 'Nothing')

      expect(await questions.operation('query')).toBe('deny')
      expect(await questions.operation('create')).toBe('deny')
      expect(await questions.operation('update')).toBe('deny')
    },
    BOOT,
  )

  test(
    'each rule is asked at most once per context, across questions, repeats and the whole vocabulary',
    async () => {
      const context = database.context(author)
      const questions = questionsOf(context, 'Related')

      await Promise.all([
        questions.operation('query'),
        questions.operation('query'),
        fieldOf(questions, 'label').filterable(),
        fieldOf(questions, 'label').sortable(),
        fieldOf(questions, 'label').read(),
      ])
      await fieldOf(questionsOf(context, 'Related'), 'label').read()
      await engineContextOf(context)._sessionVocabulary?.('Related')
      await engineContextOf(context)._sessionVocabulary?.('Related')
      await questions.whole()

      const counts = new Map<string, number>()
      for (const name of asked) counts.set(name, (counts.get(name) ?? 0) + 1)
      expect([...counts.values()].every((count) => count === 1)).toBe(true)
      expect([...counts.keys()].sort()).toEqual([
        'Related.create',
        'Related.delete',
        'Related.query',
        'Related.update',
        'label.create',
        'label.read',
        'label.update',
        'other.create',
        'other.read',
        'other.update',
        'third.create',
        'third.read',
        'third.update',
      ])
    },
    BOOT,
  )

  test(
    'the whole vocabulary assembled after single questions equals one resolved at once',
    async () => {
      const piecemeal = database.context(author)
      const questions = questionsOf(piecemeal, 'Related')
      await questions.operation('query')
      await fieldOf(questions, 'label').filterable()
      await fieldOf(questions, 'other').create()

      const fresh = await engineContextOf(database.context(author))._sessionVocabulary?.('Related')
      expect(await engineContextOf(piecemeal)._sessionVocabulary?.('Related')).toEqual(fresh)
    },
    BOOT,
  )

  test(
    'system fields are answered, and a name the list does not have is not',
    async () => {
      const questions = questionsOf(database.context(author), 'Related')

      for (const name of ['id', 'createdAt', 'updatedAt']) {
        const field = fieldOf(questions, name)
        expect(await field.read()).toBe('allow')
        expect(await field.create()).toBe('deny')
        expect(await field.update()).toBe('deny')
        expect(await field.filterable()).toBe(false)
        expect(field.relationship).toBeNull()
      }
      expect(questions.field('missing')).toBeUndefined()
      expect(questions.field('constructor')).toBeUndefined()
      expect(asked).toEqual(['Related.query'])
    },
    BOOT,
  )

  test(
    'a list the config does not declare has no questions',
    async () => {
      const engine = engineContextOf(database.context(author))
      expect(engine._sessionVocabularyQuestions?.('Nope')).toBeNull()
      expect(engine._sessionVocabularyQuestions?.('constructor')).toBeNull()
    },
    BOOT,
  )

  test(
    'sudo answers every operation without asking a rule, and never deletes a singleton',
    async () => {
      const sudo = database.context(author).sudo()
      const related = questionsOf(sudo, 'Related')
      const settings = questionsOf(sudo, 'Settings')

      expect(await related.operation('delete')).toBe('allow')
      expect(await settings.operation('create')).toBe('allow')
      expect(await settings.operation('delete')).toBe('deny')
      expect(asked).toEqual([])
    },
    BOOT,
  )

  test(
    'a singleton field is neither filterable nor sortable, and its delete asks no rule',
    async () => {
      const questions = questionsOf(database.context(author), 'Settings')

      expect(await questions.operation('delete')).toBe('deny')
      expect(await fieldOf(questions, 'siteName').filterable()).toBe(false)
      expect(await fieldOf(questions, 'siteName').sortable()).toBe(false)
      expect(asked).not.toContain('Settings.delete')
    },
    BOOT,
  )

  test(
    'a framework control-flow throw propagates from the one question, and is not kept',
    async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const questions = questionsOf(database.context(author), 'Redirecting')
      redirecting = true
      try {
        await expect(fieldOf(questions, 'title').read()).rejects.toBe(redirectSignal)
      } finally {
        redirecting = false
      }
      expect(warn).not.toHaveBeenCalled()
      expect(await fieldOf(questions, 'title').read()).toBe('allow')
      expect(asked).toEqual(['Redirecting.title.read', 'Redirecting.title.read'])
    },
    BOOT,
  )
})
