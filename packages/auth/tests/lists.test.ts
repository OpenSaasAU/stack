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

  it('ships closed (no access control) by default, per ADR-0013', () => {
    const userList = createUserList()

    expect(userList.access).toBeUndefined()
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

  it('ships closed (no access control) by default, per ADR-0013', () => {
    const sessionList = createSessionList()

    expect(sessionList.access).toBeUndefined()
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

  it('ships closed (no access control) by default, per ADR-0013', () => {
    const accountList = createAccountList()

    expect(accountList.access).toBeUndefined()
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

  it('ships closed (no access control) by default, per ADR-0013', () => {
    const verificationList = createVerificationList()

    expect(verificationList.access).toBeUndefined()
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

  it('applies the accessConfig passthrough to each list, keyed by model name', () => {
    const queryTrue = () => true
    const lists = getAuthLists(undefined, undefined, {
      user: { operation: { query: queryTrue } },
      session: { operation: { query: queryTrue } },
      account: { operation: { query: queryTrue } },
      verification: { operation: { query: queryTrue } },
    })

    expect(lists.User.access?.operation?.query).toBe(queryTrue)
    expect(lists.Session.access?.operation?.query).toBe(queryTrue)
    expect(lists.Account.access?.operation?.query).toBe(queryTrue)
    expect(lists.Verification.access?.operation?.query).toBe(queryTrue)
  })

  it('prefers extendUserList.access over accessConfig.user when both are set', () => {
    const extendAccess = { operation: { query: () => false } }
    const accessConfigUser = { operation: { query: () => true } }

    const lists = getAuthLists({ access: extendAccess }, undefined, { user: accessConfigUser })

    expect(lists.User.access).toBe(extendAccess)
  })

  it('leaves lists with no accessConfig entry closed', () => {
    const lists = getAuthLists(undefined, undefined, {
      user: { operation: { query: () => true } },
    })

    expect(lists.Session.access).toBeUndefined()
    expect(lists.Account.access).toBeUndefined()
    expect(lists.Verification.access).toBeUndefined()
  })
})
