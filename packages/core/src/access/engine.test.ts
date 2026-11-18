import { describe, it, expect } from 'vitest'
import { resolveSyntheticReverseRelation } from './engine.js'
import type { OpenSaasConfig } from '../config/types.js'
import { relationship, text } from '../fields/index.js'

/**
 * #978: a list-only `ref` (`ref: 'ListName'`, no target field) generates a
 * synthetic back-relation on its target — `from_<SourceList>_<sourceField>`
 * (see `getSyntheticFieldName` in fields/index.ts). `resolveSyntheticReverseRelation`
 * is the runtime counterpart that recognises the same name and resolves it
 * back to the declared field that owns it, so a nested write addressed to it
 * gets the same hook pipeline a declared relationship field gets.
 */
describe('resolveSyntheticReverseRelation', () => {
  const config: OpenSaasConfig = {
    db: { provider: 'postgresql' },
    lists: {
      Account: { fields: { name: text() } },
      ChargeRequest: {
        fields: {
          kind: text(),
          // List-only ref — no field named on Account, so a back-relation is
          // synthesized on it as `from_ChargeRequest_account`.
          account: relationship({ ref: 'Account' }),
        },
      },
      // A bidirectional relationship — Post.author names User.posts directly,
      // so no back-relation is synthesized anywhere for it.
      User: { fields: { posts: relationship({ ref: 'Post.author', many: true }) } },
      Post: { fields: { author: relationship({ ref: 'User.posts' }) } },
    },
  }

  it('resolves the synthetic back-relation name to its owning field', () => {
    const result = resolveSyntheticReverseRelation('from_ChargeRequest_account', 'Account', config)
    expect(result).not.toBeNull()
    expect(result?.sourceListName).toBe('ChargeRequest')
    expect(result?.sourceFieldName).toBe('account')
    expect(result?.sourceFieldConfig).toBe(config.lists.ChargeRequest.fields.account)
  })

  it('returns null for a name that does not match the synthetic construction', () => {
    expect(
      resolveSyntheticReverseRelation('from_ChargeRequest_amount', 'Account', config),
    ).toBeNull()
    expect(resolveSyntheticReverseRelation('chargeRequests', 'Account', config)).toBeNull()
  })

  it('returns null on the wrong parent list', () => {
    expect(
      resolveSyntheticReverseRelation('from_ChargeRequest_account', 'ChargeRequest', config),
    ).toBeNull()
  })

  it('returns null for a bidirectional ref — its other side is a real declared field, not a synthetic one', () => {
    expect(resolveSyntheticReverseRelation('from_Post_author', 'User', config)).toBeNull()
  })

  it('returns null for a genuinely unknown key', () => {
    expect(resolveSyntheticReverseRelation('totallyBogusKey', 'Account', config)).toBeNull()
  })

  it('throws for a list the config does not have', () => {
    expect(() =>
      resolveSyntheticReverseRelation('from_ChargeRequest_account', 'Nope', config),
    ).toThrow('List "Nope" is not in the config')
  })

  it('returns null for a declared field, a foreign key or a system field on the parent', () => {
    expect(resolveSyntheticReverseRelation('name', 'Account', config)).toBeNull()
    expect(resolveSyntheticReverseRelation('id', 'Account', config)).toBeNull()
    expect(resolveSyntheticReverseRelation('accountId', 'ChargeRequest', config)).toBeNull()
  })
})
