import { notFound } from 'next/navigation'
import Markdoc from '@markdoc/markdoc'
import React from 'react'
import { getDocBySlug, getAllDocSlugs } from '@/lib/content'
import { markdocConfig } from '@/lib/markdoc'
import { DocLayout } from '@/components/DocLayout'
import { CodeBlockServer } from '@/components/CodeBlockServer'
import { Callout } from '@/components/Callout'

interface DocPageProps {
  params: Promise<{
    slug?: string[]
  }>
}

export async function generateStaticParams() {
  const slugs = getAllDocSlugs()
  return slugs.map((slug) => ({ slug }))
}

export default async function DocPage({ params }: DocPageProps) {
  const resolvedParams = await params
  const slug = resolvedParams.slug || ['quick-start']

  const doc = getDocBySlug(slug)

  if (!doc) {
    notFound()
  }

  // Parse and render markdown with Markdoc
  const ast = Markdoc.parse(doc.content)
  const content = Markdoc.transform(ast, markdocConfig)

  // Custom components for Markdoc
  const components = {
    CodeBlock: CodeBlockServer,
    Callout,
  }

  return (
    <DocLayout slug={slug} title={doc.title}>
      {Markdoc.renderers.react(content, React, { components })}
    </DocLayout>
  )
}

export async function generateMetadata({ params }: DocPageProps) {
  const resolvedParams = await params
  const slug = resolvedParams.slug || ['quick-start']
  const doc = getDocBySlug(slug)

  if (!doc) {
    return {
      title: 'Page Not Found',
    }
  }

  return {
    title: `${doc.title} | OpenSaaS Stack`,
    description: `Documentation for ${doc.title}`,
  }
}
