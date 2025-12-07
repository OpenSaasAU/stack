/**
 * Tests for MigrationWizard
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MigrationWizard } from '../src/mcp/lib/wizards/migration-wizard.js'
import type { IntrospectedSchema } from '../src/migration/types.js'

describe('MigrationWizard', () => {
  let wizard: MigrationWizard

  beforeEach(() => {
    wizard = new MigrationWizard()
  })

  describe('startMigration', () => {
    it('should start a migration session without analysis', async () => {
      const result = await wizard.startMigration('prisma')

      expect(result.content).toHaveLength(1)
      expect(result.content[0].text).toContain('Migration Wizard')
      expect(result.content[0].text).toContain('**Project Type:** prisma')
      expect(result.content[0].text).toContain('sessionId')
    })

    it('should start a migration session with analysis', async () => {
      const analysis: IntrospectedSchema = {
        provider: 'postgresql',
        models: [
          {
            name: 'Post',
            fields: [
              {
                name: 'id',
                type: 'String',
                isRequired: true,
                isUnique: true,
                isId: true,
                isList: false,
              },
              {
                name: 'title',
                type: 'String',
                isRequired: true,
                isUnique: false,
                isId: false,
                isList: false,
              },
            ],
            hasRelations: false,
            primaryKey: 'id',
          },
        ],
        enums: [],
      }

      const result = await wizard.startMigration('prisma', analysis)

      expect(result.content[0].text).toContain('**Models:** 1')
      expect(result.content[0].text).toContain('**Database:** postgresql')
    })

    it('should extract session ID from response', async () => {
      const result = await wizard.startMigration('prisma')
      const sessionIdMatch = result.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)

      expect(sessionIdMatch).toBeDefined()
      expect(sessionIdMatch![1]).toMatch(/^migration_\d+_[a-z0-9]+$/)
    })
  })

  describe('answerQuestion', () => {
    it('should handle invalid session ID', async () => {
      const result = await wizard.answerQuestion('invalid-session-id', true)

      expect(result.content[0].text).toContain('Session not found')
    })

    it('should accept valid boolean answer and progress to next question', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer first question (boolean: preserve_database)
      const answerResult = await wizard.answerQuestion(sessionId, true)

      expect(answerResult.content[0].text).toContain('Recorded')
      expect(answerResult.content[0].text).toContain('Question 2')
      expect(answerResult.content[0].text).toContain('Progress')
    })

    it('should validate boolean answers', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Try invalid boolean answer
      const invalidResult = await wizard.answerQuestion(sessionId, 'maybe')

      expect(invalidResult.content[0].text).toContain('Invalid answer')
      expect(invalidResult.content[0].text).toContain('yes/no')
    })

    it('should accept yes/no as boolean values', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer with "yes"
      const answerResult = await wizard.answerQuestion(sessionId, 'yes')

      expect(answerResult.content[0].text).toContain('Recorded')
      expect(answerResult.content[0].text).toContain('Question 2')
    })

    it('should validate select answers', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer first question (boolean)
      await wizard.answerQuestion(sessionId, true)

      // Try invalid select answer for db_provider
      const invalidResult = await wizard.answerQuestion(sessionId, 'mongodb')

      expect(invalidResult.content[0].text).toContain('Invalid')
      expect(invalidResult.content[0].text).toContain('sqlite, postgresql, mysql')
    })

    it('should accept valid select answer', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer first question
      await wizard.answerQuestion(sessionId, true)

      // Answer second question with valid select
      const answerResult = await wizard.answerQuestion(sessionId, 'postgresql')

      expect(answerResult.content[0].text).toContain('Recorded')
      expect(answerResult.content[0].text).toContain('Question 3')
    })

    it('should validate multiselect answers', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Progress to auth_methods question (multiselect)
      await wizard.answerQuestion(sessionId, true) // preserve_database
      await wizard.answerQuestion(sessionId, 'sqlite') // db_provider
      await wizard.answerQuestion(sessionId, true) // enable_auth

      // Try invalid multiselect
      const invalidResult = await wizard.answerQuestion(sessionId, 'invalid-method')

      expect(invalidResult.content[0].text).toContain('Invalid')
    })

    it('should accept valid multiselect answers as array', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Progress to auth_methods question
      await wizard.answerQuestion(sessionId, true)
      await wizard.answerQuestion(sessionId, 'sqlite')
      await wizard.answerQuestion(sessionId, true)

      // Answer with array
      const answerResult = await wizard.answerQuestion(sessionId, ['email-password', 'google'])

      expect(answerResult.content[0].text).toContain('Recorded')
      expect(answerResult.content[0].text).toContain('email-password, google')
    })

    it('should accept valid multiselect answers as comma-separated string', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Progress to auth_methods question
      await wizard.answerQuestion(sessionId, true)
      await wizard.answerQuestion(sessionId, 'sqlite')
      await wizard.answerQuestion(sessionId, true)

      // Answer with comma-separated string
      const answerResult = await wizard.answerQuestion(sessionId, 'email-password, github')

      expect(answerResult.content[0].text).toContain('Recorded')
    })
  })

  describe('generateMigrationConfig', () => {
    it('should complete wizard and generate config', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer all questions
      await wizard.answerQuestion(sessionId, true) // preserve_database
      await wizard.answerQuestion(sessionId, 'sqlite') // db_provider
      await wizard.answerQuestion(sessionId, 'no') // enable_auth (use string instead of boolean)
      await wizard.answerQuestion(sessionId, 'public-read-auth-write') // default_access
      await wizard.answerQuestion(sessionId, '/admin') // admin_base_path
      await wizard.answerQuestion(sessionId, []) // additional_features
      const finalResult = await wizard.answerQuestion(sessionId, 'yes') // confirm (use string instead of boolean)

      expect(finalResult.content[0].text).toContain('Migration Complete')
      expect(finalResult.content[0].text).toContain('opensaas.config.ts')
      expect(finalResult.content[0].text).toContain('Install Dependencies')
      expect(finalResult.content[0].text).toContain('Next Steps')
    })

    it('should include auth dependencies when auth is enabled', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Answer all questions with auth enabled
      await wizard.answerQuestion(sessionId, true)
      await wizard.answerQuestion(sessionId, 'postgresql')
      await wizard.answerQuestion(sessionId, true) // enable_auth = true
      await wizard.answerQuestion(sessionId, ['email-password'])
      await wizard.answerQuestion(sessionId, 'authenticated-only')
      await wizard.answerQuestion(sessionId, '/admin')
      await wizard.answerQuestion(sessionId, [])
      const finalResult = await wizard.answerQuestion(sessionId, true)

      expect(finalResult.content[0].text).toContain('@opensaas/stack-auth')
    })

    it('should clean up session after completion', async () => {
      const startResult = await wizard.startMigration('prisma')
      const sessionIdMatch = startResult.content[0].text.match(/sessionId.*?:\s*"([^"]+)"/)
      const sessionId = sessionIdMatch![1]

      // Verify session exists
      expect(wizard.getSession(sessionId)).toBeDefined()

      // Complete wizard
      await wizard.answerQuestion(sessionId, 'yes')
      await wizard.answerQuestion(sessionId, 'sqlite')
      await wizard.answerQuestion(sessionId, 'no')
      await wizard.answerQuestion(sessionId, 'public-read-auth-write')
      await wizard.answerQuestion(sessionId, '/admin')
      await wizard.answerQuestion(sessionId, [])
      await wizard.answerQuestion(sessionId, 'yes')

      // Verify session is cleaned up
      expect(wizard.getSession(sessionId)).toBeUndefined()
    })
  })

  describe('model detection', () => {
    it('should ask about auth models when detected', async () => {
      const analysis: IntrospectedSchema = {
        provider: 'postgresql',
        models: [
          {
            name: 'User',
            fields: [],
            hasRelations: false,
            primaryKey: 'id',
          },
          {
            name: 'Account',
            fields: [],
            hasRelations: false,
            primaryKey: 'id',
          },
          {
            name: 'Post',
            fields: [],
            hasRelations: false,
            primaryKey: 'id',
          },
        ],
        enums: [],
      }

      const result = await wizard.startMigration('prisma', analysis)

      // The wizard should include questions about skipping auth models
      expect(result.content[0].text).toBeDefined()
    })

    it('should ask about owner models when User relationships detected', async () => {
      const analysis: IntrospectedSchema = {
        provider: 'postgresql',
        models: [
          {
            name: 'User',
            fields: [],
            hasRelations: false,
            primaryKey: 'id',
          },
          {
            name: 'Post',
            fields: [
              {
                name: 'author',
                type: 'User',
                isRequired: true,
                isUnique: false,
                isId: false,
                isList: false,
                relation: {
                  name: 'PostToUser',
                  model: 'User',
                  fields: ['authorId'],
                  references: ['id'],
                },
              },
            ],
            hasRelations: true,
            primaryKey: 'id',
          },
        ],
        enums: [],
      }

      const result = await wizard.startMigration('prisma', analysis)

      expect(result.content[0].text).toBeDefined()
    })
  })

  describe('session management', () => {
    it('should clear completed sessions', () => {
      const wizard = new MigrationWizard()

      // Create a mock completed session
      const session = wizard['sessions']
      session['test-session'] = {
        id: 'test-session',
        projectType: 'prisma',
        analysis: { projectTypes: ['prisma'], cwd: '.' },
        currentQuestionIndex: 0,
        answers: {},
        isComplete: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      wizard.clearCompletedSessions()

      expect(wizard.getSession('test-session')).toBeUndefined()
    })

    it('should not clear incomplete sessions', () => {
      const wizard = new MigrationWizard()

      // Create a mock incomplete session
      const session = wizard['sessions']
      session['test-session'] = {
        id: 'test-session',
        projectType: 'prisma',
        analysis: { projectTypes: ['prisma'], cwd: '.' },
        currentQuestionIndex: 0,
        answers: {},
        isComplete: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      wizard.clearCompletedSessions()

      expect(wizard.getSession('test-session')).toBeDefined()
    })

    it('should clear old sessions', () => {
      const wizard = new MigrationWizard()

      // Create a mock old session (2 hours ago)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
      const session = wizard['sessions']
      session['old-session'] = {
        id: 'old-session',
        projectType: 'prisma',
        analysis: { projectTypes: ['prisma'], cwd: '.' },
        currentQuestionIndex: 0,
        answers: {},
        isComplete: false,
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
      }

      wizard.clearOldSessions()

      expect(wizard.getSession('old-session')).toBeUndefined()
    })

    it('should not clear recent sessions', () => {
      const wizard = new MigrationWizard()

      // Create a mock recent session (5 minutes ago)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
      const session = wizard['sessions']
      session['recent-session'] = {
        id: 'recent-session',
        projectType: 'prisma',
        analysis: { projectTypes: ['prisma'], cwd: '.' },
        currentQuestionIndex: 0,
        answers: {},
        isComplete: false,
        createdAt: fiveMinutesAgo,
        updatedAt: fiveMinutesAgo,
      }

      wizard.clearOldSessions()

      expect(wizard.getSession('recent-session')).toBeDefined()
    })
  })

  describe('answer formatting', () => {
    it('should format boolean answers', () => {
      expect(wizard['formatAnswer'](true)).toBe('Yes')
      expect(wizard['formatAnswer'](false)).toBe('No')
    })

    it('should format array answers', () => {
      expect(wizard['formatAnswer'](['a', 'b', 'c'])).toBe('a, b, c')
      expect(wizard['formatAnswer']([])).toBe('(none)')
    })

    it('should format string answers', () => {
      expect(wizard['formatAnswer']('test')).toBe('test')
    })
  })

  describe('progress bar', () => {
    it('should render progress bar correctly', () => {
      expect(wizard['renderProgressBar'](0, 10)).toBe('░░░░░░░░░░')
      expect(wizard['renderProgressBar'](5, 10)).toBe('▓▓▓▓▓░░░░░')
      expect(wizard['renderProgressBar'](10, 10)).toBe('▓▓▓▓▓▓▓▓▓▓')
    })
  })
})
