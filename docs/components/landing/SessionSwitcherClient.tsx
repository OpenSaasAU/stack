'use client'

import { useState } from 'react'
import { EyeOff, Lock, User, UserX } from 'lucide-react'

export type Persona = 'anonymous' | 'alice' | 'bob'
export type Operation = 'query' | 'update'

interface SessionSwitcherClientProps {
  /** Shiki-highlighted HTML keyed by `${persona}:${operation}` */
  snippets: Record<string, string>
}

const PERSONAS: { id: Persona; label: string; detail: string; icon: typeof User }[] = [
  { id: 'anonymous', label: 'Anonymous', detail: 'no session', icon: UserX },
  { id: 'alice', label: 'Alice', detail: 'wrote the draft', icon: User },
  { id: 'bob', label: 'Bob', detail: 'another user', icon: User },
]

const OPERATIONS: { id: Operation; label: string }[] = [
  { id: 'query', label: 'Read posts' },
  { id: 'update', label: "Update Alice's draft" },
]

interface Row {
  id: string
  title: string
  status: 'published' | 'draft'
  author: 'alice' | 'bob'
}

const ROWS: Row[] = [
  { id: 'p1', title: 'Shipping the guardrails story', status: 'published', author: 'alice' },
  { id: 'p2', title: 'Pricing rework', status: 'draft', author: 'alice' },
  { id: 'p3', title: 'Launch retrospective', status: 'published', author: 'bob' },
  { id: 'p4', title: 'Incident notes', status: 'draft', author: 'bob' },
]

/**
 * Precomputed outcomes of the access rules shown in the config snippet above
 * this block on the landing page:
 *
 *   query:  signed-in users see published posts plus their own; anonymous
 *           visitors see published only.
 *   update: only the author — as a row filter, so non-authors match nothing.
 */
const VISIBLE_ROWS: Record<Persona, string[]> = {
  anonymous: ['p1', 'p3'],
  alice: ['p1', 'p2', 'p3'],
  bob: ['p1', 'p3', 'p4'],
}

const UPDATE_OUTCOME: Record<Persona, { result: 'updated' | 'null'; note: string }> = {
  anonymous: {
    result: 'null',
    note: 'The update rule returns false for anonymous sessions — the operation is denied before it reaches the database.',
  },
  alice: {
    result: 'updated',
    note: 'The rule resolves to authorId: { equals: "alice" }, the row matches, and the update goes through.',
  },
  bob: {
    result: 'null',
    note: "The rule resolves to authorId: { equals: 'bob' } — Alice's draft doesn't match, so Bob gets null. Not an error: he can't even learn the draft exists.",
  },
}

export function SessionSwitcherClient({ snippets }: SessionSwitcherClientProps) {
  const [persona, setPersona] = useState<Persona>('anonymous')
  const [operation, setOperation] = useState<Operation>('query')

  const visible = VISIBLE_ROWS[persona]
  const outcome = UPDATE_OUTCOME[persona]

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
      {/* Persona tabs */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span className="text-xs uppercase tracking-wide text-zinc-500 font-mono mr-1">
          Who&apos;s asking
        </span>
        {PERSONAS.map((p) => {
          const Icon = p.icon
          const active = persona === p.id
          return (
            <button
              key={p.id}
              onClick={() => setPersona(p.id)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors ${
                active
                  ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
              <span className={active ? 'text-emerald-400/70' : 'text-zinc-600'}>{p.detail}</span>
            </button>
          )
        })}
      </div>

      {/* Operation tabs */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-4 border-b border-zinc-800">
        <span className="text-xs uppercase tracking-wide text-zinc-500 font-mono mr-1">
          Operation
        </span>
        {OPERATIONS.map((op) => {
          const active = operation === op.id
          return (
            <button
              key={op.id}
              onClick={() => setOperation(op.id)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-mono transition-colors ${
                active
                  ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
              }`}
            >
              {op.label}
            </button>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-2">
        {/* Code panel */}
        <div className="border-b lg:border-b-0 lg:border-r border-zinc-800">
          <div className="px-4 py-2 text-xs font-mono text-zinc-500 border-b border-zinc-800">
            your-feature.ts
          </div>
          <div
            className="session-switcher-code text-sm [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: snippets[`${persona}:${operation}`] }}
          />
        </div>

        {/* Result panel */}
        <div className="bg-zinc-950/50">
          <div className="px-4 py-2 text-xs font-mono text-zinc-500 border-b border-zinc-800">
            result
          </div>

          {operation === 'query' ? (
            <div className="p-4 space-y-2">
              {ROWS.map((row) => {
                const shown = visible.includes(row.id)
                return (
                  <div
                    key={row.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm transition-opacity ${
                      shown
                        ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                        : 'border-dashed border-zinc-800 text-zinc-600'
                    }`}
                  >
                    {shown ? (
                      <span
                        className={`h-2 w-2 rounded-full shrink-0 ${
                          row.status === 'published' ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className={shown ? '' : 'line-through decoration-zinc-700'}>
                      {row.title}
                    </span>
                    <span className="ml-auto font-mono text-xs text-zinc-500">
                      {row.status} · {row.author}
                    </span>
                  </div>
                )
              })}
              <p className="pt-2 text-sm text-zinc-400">
                <span className="font-mono text-emerald-400">
                  → {visible.length} row{visible.length === 1 ? '' : 's'}
                </span>{' '}
                returned. Rows outside the access filter never leave the database — the engine
                merged the rule into the query&apos;s <code className="font-mono">where</code>.
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {outcome.result === 'updated' ? (
                <div className="px-3 py-3 rounded-lg border border-emerald-400/40 bg-emerald-400/5 text-sm">
                  <div className="font-mono text-emerald-300 mb-1">
                    {'{ id: "p2", title: "Pricing rework, take two", … }'}
                  </div>
                  <div className="text-zinc-400">1 row updated and returned.</div>
                </div>
              ) : (
                <div className="px-3 py-3 rounded-lg border border-red-400/30 bg-red-400/5 text-sm">
                  <div className="flex items-center gap-2 font-mono text-red-300 mb-1">
                    <Lock className="h-3.5 w-3.5" /> null
                  </div>
                  <div className="text-zinc-400">
                    Silent failure: a denied write returns <code className="font-mono">null</code>,
                    indistinguishable from &ldquo;not found&rdquo;.
                  </div>
                </div>
              )}
              <p className="text-sm text-zinc-400">{outcome.note}</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-zinc-800 text-xs text-zinc-500">
        Results precomputed from the access-control engine — this block doesn&apos;t hit a live
        database. Run it for real:{' '}
        <code className="font-mono text-zinc-400">npm create opensaas-app@latest</code>
      </div>
    </div>
  )
}
