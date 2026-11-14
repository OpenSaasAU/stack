// @vitest-environment node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as internal from '@opensaas/stack-core/internal'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

const EVALUATORS = new Set([
  'checkFieldAccess',
  'checkAccess',
  'checkCreateAccess',
  'classifyWriteForRow',
  'isListQueryStaticallyDenied',
])

const RULE_KEYS = new Set(['operation', 'read', 'create', 'update', 'delete', 'write'])

const WRITE_AFFORDANCES = [
  'components/Dashboard.tsx',
  'components/ItemForm.tsx',
  'components/ListView.tsx',
  'components/SingletonView.tsx',
]

interface Offence {
  readonly rule: 'evaluator' | 'rule-read' | 'access-destructure'
  readonly at: string
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return await sourceFiles(path)
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
    }),
  )
  return nested.flat()
}

function parse(fileName: string, text: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind)
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function memberName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) {
    const argument = unwrap(node.argumentExpression)
    if (ts.isStringLiteralLike(argument)) return argument.text
  }
  return undefined
}

function isEvaluatorName(name: string): boolean {
  return EVALUATORS.has(name) || name.startsWith('classifyRowIndependent')
}

function bindingKey(element: ts.BindingElement): string | undefined {
  const key = element.propertyName ?? element.name
  if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) return key.text
  return undefined
}

/** Every place `source` names an access evaluator or reads an access rule off a config. */
function offencesIn(fileName: string, text: string): Offence[] {
  const source = parse(fileName, text)
  const offences: Offence[] = []
  const report = (rule: Offence['rule'], node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    offences.push({ rule, at: `${fileName}:${line + 1}: ${node.getText(source)}` })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isEvaluatorName(node.text)) report('evaluator', node)
    if (ts.isStringLiteralLike(node) && isEvaluatorName(node.text)) report('evaluator', node)

    const name = memberName(node)
    if (
      name !== undefined &&
      RULE_KEYS.has(name) &&
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      memberName(unwrap(node.expression)) === 'access'
    ) {
      report('rule-read', node)
    }

    if (ts.isBindingElement(node) && bindingKey(node) === 'access') {
      report('access-destructure', node)
    }

    ts.forEachChild(node, visit)
  }
  visit(source)
  return offences
}

async function adminOffences(): Promise<Offence[]> {
  const offences: Offence[] = []
  for (const file of await sourceFiles(SRC)) {
    offences.push(...offencesIn(relative(SRC, file), await readFile(file, 'utf8')))
  }
  return offences
}

function referencesVocabulary(text: string, fileName: string): boolean {
  const source = parse(fileName, text)
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'operationAvailable') found = true
    if (memberName(node) === 'operations') found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('the admin package classifies access only through the Session vocabulary', () => {
  it('names no access evaluator and reads no access rule off a list or field config', async () => {
    expect((await adminOffences()).map((offence) => offence.at)).toEqual([])
  })

  it.each(WRITE_AFFORDANCES)('%s gates its write affordances on the vocabulary', async (path) => {
    expect(referencesVocabulary(await readFile(join(SRC, path), 'utf8'), path)).toBe(true)
  })

  it('cannot reach the field-access evaluator through core’s internal entry point', () => {
    expect(Object.keys(internal)).not.toContain('checkFieldAccess')
  })
})

describe('the boundary scan', () => {
  it.each([
    ['an evaluator import', `import { checkFieldAccess } from '@opensaas/stack-core/internal'`],
    ['an evaluator call', `await checkAccess(rule, args)`],
    ['a create evaluator', `checkCreateAccess(rule, args)`],
    ['a row-independent classifier', `classifyRowIndependentFieldAccess(rule, args)`],
    ['a row classifier', `classifyWriteForRow(rule, args)`],
    ['the static nav classification', `isListQueryStaticallyDenied(listConfig)`],
    ['a namespaced evaluator', `core.checkAccess(rule, args)`],
    ['a bracketed evaluator', `core['checkAccess'](rule, args)`],
    ['a dotted rule read', `listConfig.access.operation`],
    ['an optional rule read', `listConfig.access?.operation?.query`],
    ['a write rule read', `field.access?.write`],
    ['a delete rule read', `listConfig.access.delete`],
    ['a bracketed rule read', `listConfig.access?.['operation']`],
    ['a fully bracketed rule read', `listConfig['access']['read']`],
    ['a parenthesised rule read', `(listConfig.access)!.create`],
    ['a rule read across lines', `listConfig\n  .access\n  ?.update`],
    ['a destructured access', `const { access } = listConfig`],
    ['a renamed destructured access', `const { access: rules } = field`],
    ['a nested destructured access', `const { access: { operation } } = listConfig`],
    ['a destructured access parameter', `function f({ access }: Props) { return access }`],
  ])('catches %s', (_label, text) => {
    expect(offencesIn('scratch.tsx', text)).not.toEqual([])
  })

  it.each([
    ['an access field name', `const label = 'access'`],
    ['a vocabulary read', `vocabulary.operations.create !== 'deny'`],
    ['an unrelated property', `field.ui?.access`],
  ])('passes %s', (_label, text) => {
    expect(offencesIn('scratch.tsx', text)).toEqual([])
  })
})
