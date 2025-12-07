import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KeystoneIntrospector } from '../../src/migration/introspectors/keystone-introspector.js'
import fs from 'fs-extra'
import path from 'path'
import os from 'os'

describe('KeystoneIntrospector', () => {
  let introspector: KeystoneIntrospector
  let tempDir: string

  beforeEach(async () => {
    introspector = new KeystoneIntrospector()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-test-'))
  })

  afterEach(async () => {
    await fs.remove(tempDir)
  })

  it('should load and parse a KeystoneJS config', async () => {
    const config = `
export default {
  db: {
    provider: 'sqlite',
    url: 'file:./keystone.db',
  },
  lists: {
    User: {
      fields: {
        name: {
          type: 'text',
          validation: { isRequired: true },
        },
        email: {
          type: 'text',
          validation: { isRequired: true },
        },
        posts: {
          type: 'relationship',
          ref: 'Post.author',
          many: true,
        },
      },
    },
    Post: {
      fields: {
        title: {
          type: 'text',
          validation: { isRequired: true },
        },
        author: {
          type: 'relationship',
          ref: 'User.posts',
        },
      },
    },
  },
}
`
    await fs.writeFile(path.join(tempDir, 'keystone.config.js'), config)

    const result = await introspector.introspect(tempDir, 'keystone.config.js')

    expect(result.provider).toBe('sqlite')
    expect(result.models).toHaveLength(2)

    const user = result.models.find((m) => m.name === 'User')
    expect(user).toBeDefined()
    expect(user!.fields).toHaveLength(3)

    const post = result.models.find((m) => m.name === 'Post')
    expect(post).toBeDefined()
    expect(post!.hasRelations).toBe(true)
  })

  it('should map KeystoneJS types to OpenSaaS types', () => {
    expect(introspector.mapKeystoneTypeToOpenSaas('text')).toEqual({ type: 'text', import: 'text' })
    expect(introspector.mapKeystoneTypeToOpenSaas('integer')).toEqual({
      type: 'integer',
      import: 'integer',
    })
    expect(introspector.mapKeystoneTypeToOpenSaas('checkbox')).toEqual({
      type: 'checkbox',
      import: 'checkbox',
    })
    expect(introspector.mapKeystoneTypeToOpenSaas('timestamp')).toEqual({
      type: 'timestamp',
      import: 'timestamp',
    })
    expect(introspector.mapKeystoneTypeToOpenSaas('relationship')).toEqual({
      type: 'relationship',
      import: 'relationship',
    })
  })

  it('should handle file and image fields', () => {
    expect(introspector.mapKeystoneTypeToOpenSaas('image')).toEqual({
      type: 'image',
      import: 'image',
    })
    expect(introspector.mapKeystoneTypeToOpenSaas('file')).toEqual({ type: 'file', import: 'file' })
  })

  it('should handle virtual fields', () => {
    expect(introspector.mapKeystoneTypeToOpenSaas('virtual')).toEqual({
      type: 'virtual',
      import: 'virtual',
    })
  })

  it('should generate warnings for migration reminders', async () => {
    const config = `
export default {
  db: {
    provider: 'postgresql',
  },
  lists: {
    Media: {
      fields: {
        image: {
          type: 'image',
        },
        document: {
          type: 'file',
        },
        computed: {
          type: 'virtual',
        },
      },
    },
  },
}
`
    await fs.writeFile(path.join(tempDir, 'keystone.config.js'), config)

    const result = await introspector.introspect(tempDir, 'keystone.config.js')
    const warnings = introspector.getWarnings(result)

    expect(warnings.length).toBeGreaterThan(0)
    // Should warn about storage configuration (helpful reminder)
    expect(warnings.some((w) => w.includes('storage'))).toBe(true)
    // Should remind about manual migration for virtual field hooks
    expect(warnings.some((w) => w.includes('virtual') && w.includes('manually migrate'))).toBe(true)
  })

  it('should throw for missing config', async () => {
    await expect(introspector.introspect(tempDir, 'nonexistent.ts')).rejects.toThrow(
      'KeystoneJS config not found',
    )
  })

  it('should try alternative config paths', async () => {
    const config = `
export default {
  db: {
    provider: 'sqlite',
  },
  lists: {
    User: {
      fields: {
        name: {
          type: 'text',
        },
      },
    },
  },
}
`
    // Create config at alternative path
    await fs.writeFile(path.join(tempDir, 'keystone.ts'), config)

    // Should find it even if we specify the default path
    const result = await introspector.introspect(tempDir)

    expect(result.models).toHaveLength(1)
    expect(result.models[0].name).toBe('User')
  })

  it('should parse relationship fields correctly', async () => {
    const config = `
export default {
  db: {
    provider: 'sqlite',
  },
  lists: {
    Post: {
      fields: {
        author: {
          type: 'relationship',
          ref: 'User.posts',
        },
      },
    },
    User: {
      fields: {
        posts: {
          type: 'relationship',
          ref: 'Post.author',
          many: true,
        },
      },
    },
  },
}
`
    await fs.writeFile(path.join(tempDir, 'keystone.config.js'), config)

    const result = await introspector.introspect(tempDir, 'keystone.config.js')

    const post = result.models.find((m) => m.name === 'Post')
    const authorField = post!.fields.find((f) => f.name === 'author')
    expect(authorField!.relation).toBeDefined()
    expect(authorField!.relation!.model).toBe('User')
    expect(authorField!.relation!.references).toEqual(['posts'])

    const user = result.models.find((m) => m.name === 'User')
    const postsField = user!.fields.find((f) => f.name === 'posts')
    expect(postsField!.isList).toBe(true)
  })

  it('should handle field validation options', async () => {
    const config = `
export default {
  db: {
    provider: 'sqlite',
  },
  lists: {
    User: {
      fields: {
        email: {
          type: 'text',
          validation: { isRequired: true },
          isRequired: true,
        },
        age: {
          type: 'integer',
          defaultValue: 0,
        },
      },
    },
  },
}
`
    await fs.writeFile(path.join(tempDir, 'keystone.config.js'), config)

    const result = await introspector.introspect(tempDir, 'keystone.config.js')
    const user = result.models[0]

    const emailField = user.fields.find((f) => f.name === 'email')
    expect(emailField!.isRequired).toBe(true)

    const ageField = user.fields.find((f) => f.name === 'age')
    expect(ageField!.defaultValue).toBe('0')
  })
})
