import { describe, it, expect } from 'vitest'
import {
  createUserList,
  createSessionList,
  createAccountList,
  createVerificationList,
  getAuthLists,
} from '../src/lists/index.js'
import { text } from '@opensaas/stack-core/fields'

describe('createUserList', () => {
  it('should create User list with required fields', () => {
    const userList = createUserList()

    expect(userList.fields).toHaveProperty('name')
    expect(userList.fields).toHaveProperty('email')
    expect(userList.fields).toHaveProperty('emailVerified')
    expect(userList.fields).toHaveProperty('image')
    expect(userList.fields).toHaveProperty('sessions')
    expect(userList.fields).toHaveProperty('accounts')
  })

  it('should have email field marked as unique', () => {
    const userList = createUserList()

    expect(userList.fields.email.isIndexed).toBe('unique')
  })

  it('should have name field marked as required', () => {
    const userList = createUserList()

    expect(userList.fields.name.validation?.isRequired).toBe(true)
  })

  it('should have email field marked as required', () => {
    const userList = createUserList()

    expect(userList.fields.email.validation?.isRequired).toBe(true)
  })

  it('should have emailVerified field with default false', () => {
    const userList = createUserList()

    expect(userList.fields.emailVerified.defaultValue).toBe(false)
  })

  it('should extend User list with custom fields', () => {
    const userList = createUserList({
      fields: {
        role: text(),
        company: text(),
      },
    })

    expect(userList.fields).toHaveProperty('role')
    expect(userList.fields).toHaveProperty('company')
    // Should also have base fields
    expect(userList.fields).toHaveProperty('email')
  })

  it('should have default access control', () => {
    const userList = createUserList()

    expect(userList.access).toBeDefined()
    expect(userList.access?.operation).toBeDefined()
    expect(userList.access?.operation?.query).toBeDefined()
    expect(userList.access?.operation?.create).toBeDefined()
    expect(userList.access?.operation?.update).toBeDefined()
    expect(userList.access?.operation?.delete).toBeDefined()
  })

  it('should allow querying users', () => {
    const userList = createUserList()
    const queryAccess = userList.access?.operation?.query

    expect(typeof queryAccess).toBe('function')
    expect(queryAccess?.({})).toBe(true)
  })

  it('should allow creating users', () => {
    const userList = createUserList()
    const createAccess = userList.access?.operation?.create

    expect(typeof createAccess).toBe('function')
    expect(createAccess?.({})).toBe(true)
  })

  it('should allow users to update their own record', () => {
    const userList = createUserList()
    const updateAccess = userList.access?.operation?.update

    expect(typeof updateAccess).toBe('function')
    expect(
      updateAccess?.({
        session: { userId: 'user-1' },
        item: { id: 'user-1' },
      }),
    ).toBe(true)
  })

  it('should deny users from updating other users', () => {
    const userList = createUserList()
    const updateAccess = userList.access?.operation?.update

    expect(
      updateAccess?.({
        session: { userId: 'user-1' },
        item: { id: 'user-2' },
      }),
    ).toBe(false)
  })

  it('should allow custom access control', () => {
    const customAccess = {
      operation: {
        query: () => false,
        create: () => false,
        update: () => false,
        delete: () => false,
      },
    }

    const userList = createUserList({
      access: customAccess,
    })

    expect(userList.access).toEqual(customAccess)
  })

  it('should support custom hooks', () => {
    const customHooks = {
      resolveInput: async ({ resolvedData }: { resolvedData: unknown }) => resolvedData,
    }

    const userList = createUserList({
      hooks: customHooks,
    })

    expect(userList.hooks).toEqual(customHooks)
  })
})

describe('createSessionList', () => {
  it('should create Session list with required fields', () => {
    const sessionList = createSessionList()

    expect(sessionList.fields).toHaveProperty('token')
    expect(sessionList.fields).toHaveProperty('expiresAt')
    expect(sessionList.fields).toHaveProperty('ipAddress')
    expect(sessionList.fields).toHaveProperty('userAgent')
    expect(sessionList.fields).toHaveProperty('user')
  })

  it('should have token field marked as unique', () => {
    const sessionList = createSessionList()

    expect(sessionList.fields.token.isIndexed).toBe('unique')
  })

  it('should have token field marked as required', () => {
    const sessionList = createSessionList()

    expect(sessionList.fields.token.validation?.isRequired).toBe(true)
  })

  it('should have user relationship', () => {
    const sessionList = createSessionList()

    expect(sessionList.fields.user.type).toBe('relationship')
    expect(sessionList.fields.user.ref).toBe('User.sessions')
  })

  it('should have restrictive access control', () => {
    const sessionList = createSessionList()

    expect(sessionList.access).toBeDefined()
    expect(sessionList.access?.operation).toBeDefined()
  })

  it('should deny querying sessions without session', () => {
    const sessionList = createSessionList()
    const queryAccess = sessionList.access?.operation?.query

    expect(queryAccess?.({})).toBe(false)
    expect(queryAccess?.({ session: null })).toBe(false)
  })

  it('should allow querying own sessions with filter', () => {
    const sessionList = createSessionList()
    const queryAccess = sessionList.access?.operation?.query

    const result = queryAccess?.({ session: { userId: 'user-1' } })
    expect(result).toEqual({
      user: { id: { equals: 'user-1' } },
    })
  })

  it('should allow creating sessions', () => {
    const sessionList = createSessionList()
    const createAccess = sessionList.access?.operation?.create

    expect(createAccess?.({})).toBe(true)
  })

  it('should deny manual session updates', () => {
    const sessionList = createSessionList()
    const updateAccess = sessionList.access?.operation?.update

    expect(updateAccess?.({})).toBe(false)
  })
})

describe('createAccountList', () => {
  it('should create Account list with required fields', () => {
    const accountList = createAccountList()

    expect(accountList.fields).toHaveProperty('accountId')
    expect(accountList.fields).toHaveProperty('providerId')
    expect(accountList.fields).toHaveProperty('user')
    expect(accountList.fields).toHaveProperty('accessToken')
    expect(accountList.fields).toHaveProperty('refreshToken')
    expect(accountList.fields).toHaveProperty('password')
  })

  it('should have accountId field marked as required', () => {
    const accountList = createAccountList()

    expect(accountList.fields.accountId.validation?.isRequired).toBe(true)
  })

  it('should have providerId field marked as required', () => {
    const accountList = createAccountList()

    expect(accountList.fields.providerId.validation?.isRequired).toBe(true)
  })

  it('should have user relationship', () => {
    const accountList = createAccountList()

    expect(accountList.fields.user.type).toBe('relationship')
    expect(accountList.fields.user.ref).toBe('User.accounts')
  })

  it('should deny querying accounts without session', () => {
    const accountList = createAccountList()
    const queryAccess = accountList.access?.operation?.query

    expect(queryAccess?.({})).toBe(false)
    expect(queryAccess?.({ session: null })).toBe(false)
  })

  it('should allow querying own accounts with filter', () => {
    const accountList = createAccountList()
    const queryAccess = accountList.access?.operation?.query

    const result = queryAccess?.({ session: { userId: 'user-1' } })
    expect(result).toEqual({
      user: { id: { equals: 'user-1' } },
    })
  })

  it('should allow users to update their own accounts', () => {
    const accountList = createAccountList()
    const updateAccess = accountList.access?.operation?.update

    expect(
      updateAccess?.({
        session: { userId: 'user-1' },
        item: { user: { id: 'user-1' } },
      }),
    ).toBe(true)
  })

  it('should deny users from updating other accounts', () => {
    const accountList = createAccountList()
    const updateAccess = accountList.access?.operation?.update

    expect(
      updateAccess?.({
        session: { userId: 'user-1' },
        item: { user: { id: 'user-2' } },
      }),
    ).toBe(false)
  })
})

describe('createVerificationList', () => {
  it('should create Verification list with required fields', () => {
    const verificationList = createVerificationList()

    expect(verificationList.fields).toHaveProperty('identifier')
    expect(verificationList.fields).toHaveProperty('value')
    expect(verificationList.fields).toHaveProperty('expiresAt')
  })

  it('should have identifier field marked as required', () => {
    const verificationList = createVerificationList()

    expect(verificationList.fields.identifier.validation?.isRequired).toBe(true)
  })

  it('should have value field marked as required', () => {
    const verificationList = createVerificationList()

    expect(verificationList.fields.value.validation?.isRequired).toBe(true)
  })

  it('should deny querying verification tokens', () => {
    const verificationList = createVerificationList()
    const queryAccess = verificationList.access?.operation?.query

    expect(queryAccess?.({})).toBe(false)
  })

  it('should allow creating verification tokens', () => {
    const verificationList = createVerificationList()
    const createAccess = verificationList.access?.operation?.create

    expect(createAccess?.({})).toBe(true)
  })

  it('should deny updates to verification tokens', () => {
    const verificationList = createVerificationList()
    const updateAccess = verificationList.access?.operation?.update

    expect(updateAccess?.({})).toBe(false)
  })

  it('should allow deleting verification tokens', () => {
    const verificationList = createVerificationList()
    const deleteAccess = verificationList.access?.operation?.delete

    expect(deleteAccess?.({})).toBe(true)
  })
})

describe('getAuthLists', () => {
  it('should return all auth lists', () => {
    const lists = getAuthLists()

    expect(lists).toHaveProperty('User')
    expect(lists).toHaveProperty('Session')
    expect(lists).toHaveProperty('Account')
    expect(lists).toHaveProperty('Verification')
  })

  it('should pass user config to createUserList', () => {
    const lists = getAuthLists({
      fields: {
        role: text(),
      },
    })

    expect(lists.User.fields).toHaveProperty('role')
  })
})
