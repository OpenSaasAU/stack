import { bundledLanguages } from 'shiki'

const LANGUAGE_ALIASES: Record<string, string> = {
  env: 'dotenv',
}

const SPECIAL_LANGUAGES = new Set(['text', 'plain', 'plaintext', 'txt', 'ansi'])

export function resolveCodeLanguage(language: string) {
  const shikiLanguage = LANGUAGE_ALIASES[language] ?? language
  return SPECIAL_LANGUAGES.has(shikiLanguage) || Object.hasOwn(bundledLanguages, shikiLanguage)
    ? shikiLanguage
    : undefined
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
