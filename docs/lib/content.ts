import fs from 'fs'
import path from 'path'

const contentDirectory = path.join(process.cwd(), 'content')

export interface DocPage {
  slug: string[]
  content: string
  title?: string
}

/**
 * Get all markdown files from the content directory
 */
export function getAllDocSlugs(): string[][] {
  const slugs: string[][] = []

  function walkDir(dir: string, currentPath: string[] = []) {
    const files = fs.readdirSync(dir)

    for (const file of files) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        walkDir(filePath, [...currentPath, file])
      } else if (file.endsWith('.md') || file.endsWith('.mdoc')) {
        const slug = file.replace(/\.(md|mdoc)$/, '')
        slugs.push([...currentPath, slug])
      }
    }
  }

  if (fs.existsSync(contentDirectory)) {
    walkDir(contentDirectory)
  }

  return slugs
}

/**
 * Get markdown content for a specific slug
 */
export function getDocBySlug(slug: string[]): DocPage | null {
  try {
    const filePath = path.join(contentDirectory, ...slug) + '.md'

    // Try .md first, then .mdoc
    let content: string
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8')
    } else {
      const mdocPath = path.join(contentDirectory, ...slug) + '.mdoc'
      if (fs.existsSync(mdocPath)) {
        content = fs.readFileSync(mdocPath, 'utf8')
      } else {
        return null
      }
    }

    // Extract title from frontmatter or first heading
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = titleMatch ? titleMatch[1] : slug[slug.length - 1]

    return {
      slug,
      content,
      title,
    }
  } catch (error) {
    console.error(`Error reading doc: ${slug.join('/')}`, error)
    return null
  }
}

/**
 * Get raw markdown content (for copy button)
 */
export function getRawMarkdown(slug: string[]): string | null {
  const doc = getDocBySlug(slug)
  return doc ? doc.content : null
}
