import { bundledLanguages } from 'shiki'

const LANGUAGE_ALIASES: Record<string, string> = {
  env: 'dotenv',
}

export function resolveCodeLanguage(language: string) {
  const shikiLanguage = LANGUAGE_ALIASES[language] ?? language
  return Object.hasOwn(bundledLanguages, shikiLanguage) ? shikiLanguage : undefined
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  )
}

export function renderPlainCode(content: string, language?: string) {
  const languageClass = language ? ` class="language-${escapeHtml(language)}"` : ''
  return `<pre><code${languageClass}>${escapeHtml(content)}</code></pre>`
}
