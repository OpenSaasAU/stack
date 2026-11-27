import { describe, expect, it } from 'vitest'
import { pluralize } from '../../src/lib/utils.js'

describe('pluralize', () => {
  it('follows the regular English rules', () => {
    expect(pluralize('post')).toBe('posts')
    expect(pluralize('category')).toBe('categories')
    expect(pluralize('day')).toBe('days')
    expect(pluralize('address')).toBe('addresses')
    expect(pluralize('box')).toBe('boxes')
    expect(pluralize('batch')).toBe('batches')
    expect(pluralize('blog post')).toBe('blog posts')
  })
})
