import { describe, expect, test } from 'vitest'
import type { OpenSaasConfig } from '../config/types.js'
import { checkbox, integer, json, select, text } from '../fields/index.js'
import { fieldToJsonSchema } from './field-schema.js'

function config(): OpenSaasConfig {
  return {
    db: { provider: 'postgresql' },
    lists: {
      Counter: { fields: { label: text() }, db: { idField: 'int autoincrement' } },
    },
  }
}

describe('fieldToJsonSchema', () => {
  test('carries a text field’s length bounds', () => {
    expect(
      fieldToJsonSchema('t', text({ validation: { length: { min: 2, max: 9 } } }), config()),
    ).toEqual({ type: 'string', minLength: 2, maxLength: 9 })
  })

  test('carries an integer field’s range', () => {
    expect(fieldToJsonSchema('n', integer({ validation: { min: 1, max: 5 } }), config())).toEqual({
      type: 'number',
      minimum: 1,
      maximum: 5,
    })
  })

  test('a select advertises its options, a checkbox a boolean, anything else a string', () => {
    expect(
      fieldToJsonSchema(
        's',
        select({
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        }),
        config(),
      ),
    ).toEqual({ type: 'string', enum: ['a', 'b'] })
    expect(fieldToJsonSchema('c', checkbox(), config())).toEqual({ type: 'boolean' })
    expect(fieldToJsonSchema('j', json(), config())).toEqual({ type: 'string' })
  })

  test('a relation takes its connect id schema from the related list it is given', () => {
    const schema = fieldToJsonSchema('counter', text(), config(), 'Counter')
    expect(schema).toMatchObject({
      type: ['object', 'null'],
      required: ['connect'],
      additionalProperties: false,
      properties: { connect: { properties: { id: { type: 'integer' } }, required: ['id'] } },
    })
  })
})
