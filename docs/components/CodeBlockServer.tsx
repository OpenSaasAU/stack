import { codeToHtml } from 'shiki'
import { renderPlainCode, resolveCodeLanguage } from '@/lib/code-highlighting'
import { CodeBlockWrapper } from './CodeBlockWrapper'

interface CodeBlockServerProps {
  language?: string
  content: string
}

export async function CodeBlockServer({ language = 'typescript', content }: CodeBlockServerProps) {
  const shikiLanguage = resolveCodeLanguage(language)
  let html = renderPlainCode(content, language)

  if (shikiLanguage) {
    try {
      html = await codeToHtml(content, {
        lang: shikiLanguage,
        themes: {
          light: 'github-light',
          dark: 'github-dark',
        },
        defaultColor: false,
      })
    } catch (error) {
      console.error('Error highlighting code:', error)
    }
  }

  return <CodeBlockWrapper html={html} code={content} language={language} />
}
