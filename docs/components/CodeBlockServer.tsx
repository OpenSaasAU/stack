import { codeToHtml } from 'shiki'
import { CodeBlockWrapper } from './CodeBlockWrapper'

interface CodeBlockServerProps {
  language?: string
  content: string
}

export async function CodeBlockServer({ language = 'typescript', content }: CodeBlockServerProps) {
  let html: string

  try {
    html = await codeToHtml(content, {
      lang: language,
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
    })
  } catch (error) {
    console.error('Error highlighting code:', error)
    // Fallback to plain code
    html = `<pre><code class="language-${language}">${content}</code></pre>`
  }

  return <CodeBlockWrapper html={html} code={content} language={language} />
}
