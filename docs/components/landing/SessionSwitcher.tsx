import { codeToHtml } from 'shiki'
import { SessionSwitcherClient, type Persona, type Operation } from './SessionSwitcherClient'

const SESSION_LINES: Record<Persona, string> = {
  anonymous: `// Who's asking: an anonymous visitor
const context = await getContext()`,
  alice: `// Who's asking: Alice, signed in
const context = await getContext({ userId: 'alice' })`,
  bob: `// Who's asking: Bob, signed in
const context = await getContext({ userId: 'bob' })`,
}

const OPERATION_LINES: Record<Operation, string> = {
  query: `const posts = await context.db.post.findMany()`,
  update: `const post = await context.db.post.update({
  where: { id: pricingDraft.id }, // Alice's draft
  data: { title: 'Pricing rework, take two' },
})`,
}

async function highlight(content: string): Promise<string> {
  return codeToHtml(content, {
    lang: 'typescript',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}

export async function SessionSwitcher() {
  const personas: Persona[] = ['anonymous', 'alice', 'bob']
  const operations: Operation[] = ['query', 'update']

  const entries = await Promise.all(
    personas.flatMap((persona) =>
      operations.map(async (operation) => {
        const code = `${SESSION_LINES[persona]}\n\n${OPERATION_LINES[operation]}`
        return [`${persona}:${operation}`, await highlight(code)] as const
      }),
    ),
  )

  return <SessionSwitcherClient snippets={Object.fromEntries(entries)} />
}
