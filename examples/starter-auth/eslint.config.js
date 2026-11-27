import tsparser from '@typescript-eslint/parser'

// Guardrails, not a security boundary: code in the same process can still
// reach the context factory another way (a dynamic import, a re-export through
// an ignored file). They keep the wiring in one place by default.

const CONTEXT_MODULE = '(^|/)\\.opensaas/context(\\.[cm]?[jt]s)?$'

const WIRING_MODULE = 'lib/server.ts'
const AUTH_MODULE = 'lib/auth.ts'

const SERVER_ACTION_FILES = ['lib/actions/*.ts', 'app/admin/\\[\\[...admin\\]\\]/page.tsx']

function contextImportRule(importNames, message) {
  return ['error', { patterns: [{ regex: CONTEXT_MODULE, importNames, message }] }]
}

export default [
  {
    ignores: ['.next/**', '.opensaas/**', 'node_modules/**', 'prisma/**', 'migrations/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-imports': contextImportRule(
        ['getContext', 'rawOpensaasContext'],
        `Only ${WIRING_MODULE} imports the context factory. Read through getServerContext() and write through a procedure (lib/procedures.ts).`,
      ),
      'no-restricted-syntax': [
        'error',
        {
          selector: "ExpressionStatement[directive='use server']",
          message: `'use server' belongs only in lib/actions/*.ts and the admin page. Put the action in lib/procedures.ts and call it with callProcedure from lib/actions/.`,
        },
      ],
    },
  },
  {
    files: [WIRING_MODULE],
    rules: {
      'no-restricted-imports': contextImportRule(
        ['rawOpensaasContext'],
        `Only ${AUTH_MODULE} imports rawOpensaasContext, for better-auth's adapter.`,
      ),
    },
  },
  {
    files: [AUTH_MODULE],
    rules: {
      'no-restricted-imports': contextImportRule(
        ['getContext'],
        `Only ${WIRING_MODULE} imports the context factory.`,
      ),
    },
  },
  {
    files: SERVER_ACTION_FILES,
    rules: { 'no-restricted-syntax': 'off' },
  },
]
