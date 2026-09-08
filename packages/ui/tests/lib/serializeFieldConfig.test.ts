import { describe, it, expect } from 'vitest'
import type { FieldConfig, OpenSaasConfig } from '@opensaas/stack-core'
import {
  markUnwritableRelationships,
  serializeFieldConfig,
  serializeFieldConfigs,
  UNWRITABLE_RELATIONSHIP_REASON,
} from '../../src/lib/serializeFieldConfig.js'

function makeFields(fields: Record<string, Record<string, unknown>>): Record<string, FieldConfig> {
  return fields as unknown as Record<string, FieldConfig>
}

/**
 * `Profile.user` holds the one-to-one column (`Profile` sorts before `User`),
 * so `User.profile` is the non-owning end — a fact no field config carries.
 */
function makeConfig(): OpenSaasConfig {
  return {
    db: { provider: 'sqlite', url: 'file:./test.db' },
    lists: {
      User: {
        fields: { name: { type: 'text' }, profile: { type: 'relationship', ref: 'Profile.user' } },
      },
      Profile: {
        fields: { bio: { type: 'text' }, user: { type: 'relationship', ref: 'User.profile' } },
      },
    },
  } as unknown as OpenSaasConfig
}

/**
 * The read-only marking `serializeFieldConfig` makes from the field alone.
 *
 * This is the only thing standing behind the STANDALONE forms when they are
 * given no config: they serialize their own field configs and never reach
 * `prepareItemForm`. So it is asserted here, against this function, rather
 * than through a caller that runs `markUnwritableRelationships` over the
 * result and would keep passing without it.
 */
describe('serializeFieldConfig relationship writability', () => {
  it('marks a to-many read-only', () => {
    const { tags } = serializeFieldConfigs(
      makeFields({ tags: { type: 'relationship', ref: 'Tag.posts', many: true } }),
    )

    expect(tags.readOnly).toBe(true)
    expect(tags.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
  })

  it('leaves a to-one unmarked — it may own the column, which the field cannot say', () => {
    const { author } = serializeFieldConfigs(
      makeFields({ author: { type: 'relationship', ref: 'User.posts' } }),
    )

    expect(author.readOnly).toBeUndefined()
    expect(author.readOnlyReason).toBeUndefined()
  })

  it('leaves a non-relationship field unmarked', () => {
    const fields = makeFields({ title: { type: 'text' } })

    expect(serializeFieldConfig(fields.title).readOnly).toBeUndefined()
  })
})

describe('markUnwritableRelationships', () => {
  it('marks the non-owning end of a one-to-one and leaves the owning end alone', () => {
    const config = makeConfig()

    const userFields = serializeFieldConfigs(config.lists.User.fields)
    markUnwritableRelationships(userFields, 'User', config.lists.User.fields, config)

    const profileFields = serializeFieldConfigs(config.lists.Profile.fields)
    markUnwritableRelationships(profileFields, 'Profile', config.lists.Profile.fields, config)

    expect(userFields.profile.readOnly).toBe(true)
    expect(userFields.profile.readOnlyReason).toBe(UNWRITABLE_RELATIONSHIP_REASON)
    expect(profileFields.user.readOnly).toBeUndefined()
  })

  it('leaves a field alone when its ref names a list the config does not declare', () => {
    const fields = makeFields({ ghost: { type: 'relationship', ref: 'Nowhere.here' } })
    const serialized = serializeFieldConfigs(fields)

    expect(() =>
      markUnwritableRelationships(serialized, 'User', fields, makeConfig()),
    ).not.toThrow()
    expect(serialized.ghost.readOnly).toBeUndefined()
  })
})
