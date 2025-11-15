/**
 * Feature catalog - Defines all available features with their configuration wizards
 */

import type { Feature } from '../types.js'

export const AUTHENTICATION_FEATURE: Feature = {
  id: 'authentication',
  name: 'User Authentication',
  description: 'Complete authentication system with sessions, sign-up/sign-in, and access control',
  category: 'authentication',
  includes: [
    'User list with email, password, name, and optional fields',
    'Better-auth integration with session management',
    'Sign-up and sign-in pages with form validation',
    'Access control helpers (isAuthenticated, isAdmin, isOwner)',
    'OAuth providers (optional)',
    'Email verification (optional)',
  ],
  questions: [
    {
      id: 'auth-methods',
      text: 'Which authentication methods do you want to support?',
      type: 'multiselect',
      required: true,
      options: ['Email & Password', 'Google OAuth', 'GitHub OAuth', 'Magic Links'],
      defaultValue: ['Email & Password'],
    },
    {
      id: 'user-roles',
      text: 'Do you need user roles for access control?',
      type: 'boolean',
      required: true,
      defaultValue: true,
      followUp: {
        if: true,
        ask: 'What roles do you need? (Enter comma-separated, e.g., admin,editor,user)',
        type: 'text',
      },
    },
    {
      id: 'user-fields',
      text: 'Select additional user profile fields',
      type: 'multiselect',
      required: false,
      options: ['Avatar', 'Bio', 'Phone', 'Location', 'Website'],
      defaultValue: [],
    },
    {
      id: 'email-verification',
      text: 'Require email verification for new accounts?',
      type: 'boolean',
      required: true,
      defaultValue: false,
    },
  ],
}

export const BLOG_FEATURE: Feature = {
  id: 'blog',
  name: 'Blog System',
  description: 'Complete blog with posts, authors, and rich content editing',
  category: 'content',
  includes: [
    'Post list with title, content, and metadata',
    'Author relationship to User',
    'Draft/publish workflow with status field',
    'Access control (authors can edit own posts)',
    'Rich text editor or markdown support',
    'SEO-friendly slugs',
  ],
  dependsOn: ['authentication'],
  questions: [
    {
      id: 'content-editor',
      text: 'How should users write posts?',
      type: 'select',
      required: true,
      options: ['Rich text editor (Tiptap)', 'Markdown', 'Plain text'],
      defaultValue: 'Rich text editor (Tiptap)',
    },
    {
      id: 'post-status',
      text: 'Enable draft/publish workflow?',
      type: 'boolean',
      required: true,
      defaultValue: true,
    },
    {
      id: 'taxonomy',
      text: 'Add categories or tags for organizing posts?',
      type: 'multiselect',
      required: false,
      options: ['Categories', 'Tags'],
      defaultValue: [],
    },
    {
      id: 'post-fields',
      text: 'Select additional post fields',
      type: 'multiselect',
      required: false,
      options: [
        'Featured image',
        'Excerpt/summary',
        'SEO metadata (title, description)',
        'Published date',
        'Reading time estimate',
      ],
      defaultValue: ['Featured image', 'Excerpt/summary'],
    },
    {
      id: 'comments-enabled',
      text: 'Enable comments on blog posts?',
      type: 'boolean',
      required: false,
      defaultValue: false,
    },
  ],
}

export const COMMENTS_FEATURE: Feature = {
  id: 'comments',
  name: 'Comments System',
  description: 'Add threaded comments to your content with moderation',
  category: 'content',
  includes: [
    'Comment list with content and author',
    'Relationship to commentable content',
    'Nested replies support (optional)',
    'Moderation workflow',
    'Access control for comment management',
  ],
  dependsOn: ['authentication'],
  questions: [
    {
      id: 'comment-targets',
      text: 'What content types can users comment on?',
      type: 'multiselect',
      required: true,
      options: ['Posts', 'Products', 'Other'],
      defaultValue: ['Posts'],
    },
    {
      id: 'nested-replies',
      text: 'Allow nested/threaded replies?',
      type: 'boolean',
      required: true,
      defaultValue: true,
    },
    {
      id: 'moderation',
      text: 'Comment moderation approach?',
      type: 'select',
      required: true,
      options: [
        'Auto-approve all comments',
        'Require admin approval',
        'Auto-approve for verified users only',
      ],
      defaultValue: 'Auto-approve all comments',
    },
    {
      id: 'comment-features',
      text: 'Additional comment features?',
      type: 'multiselect',
      required: false,
      options: ['Upvotes/downvotes', 'Report/flag comments', 'Markdown support'],
      defaultValue: [],
    },
  ],
}

export const FILE_UPLOAD_FEATURE: Feature = {
  id: 'file-upload',
  name: 'File Uploads',
  description: 'Upload and manage files with cloud storage integration',
  category: 'storage',
  includes: [
    'File list with name, URL, size, and type',
    'Storage plugin integration',
    'Upload UI components',
    'Access control for files',
    'Image optimization (optional)',
  ],
  questions: [
    {
      id: 'storage-provider',
      text: 'Which storage provider do you want to use?',
      type: 'select',
      required: true,
      options: ['AWS S3', 'Cloudflare R2', 'Vercel Blob', 'Local filesystem (development only)'],
      defaultValue: 'Vercel Blob',
    },
    {
      id: 'file-associations',
      text: 'Where will files be used?',
      type: 'multiselect',
      required: true,
      options: ['User avatars', 'Post featured images', 'General attachments', 'Product images'],
      defaultValue: ['User avatars'],
    },
    {
      id: 'file-types',
      text: 'What file types should be allowed?',
      type: 'multiselect',
      required: true,
      options: ['Images (jpg, png, webp)', 'PDFs', 'Videos', 'Any file type'],
      defaultValue: ['Images (jpg, png, webp)'],
    },
    {
      id: 'image-processing',
      text: 'Enable automatic image optimization and resizing?',
      type: 'boolean',
      required: false,
      defaultValue: true,
      dependsOn: {
        questionId: 'file-types',
        value: 'Images (jpg, png, webp)',
      },
    },
  ],
}

export const SEMANTIC_SEARCH_FEATURE: Feature = {
  id: 'semantic-search',
  name: 'Semantic Search',
  description: 'AI-powered search using RAG (Retrieval Augmented Generation)',
  category: 'search',
  includes: [
    'RAG plugin integration',
    'Automatic embeddings generation',
    'Search API endpoint',
    'Search UI component',
    'Relevance scoring',
  ],
  questions: [
    {
      id: 'searchable-content',
      text: 'What content should be searchable?',
      type: 'multiselect',
      required: true,
      options: ['Posts', 'Products', 'Documentation', 'User profiles'],
      defaultValue: ['Posts'],
    },
    {
      id: 'embedding-provider',
      text: 'Which embedding provider?',
      type: 'select',
      required: true,
      options: ['OpenAI (text-embedding-3-small)', 'Cohere', 'Anthropic'],
      defaultValue: 'OpenAI (text-embedding-3-small)',
    },
    {
      id: 'search-fields',
      text: 'Which fields should be indexed for search?',
      type: 'multiselect',
      required: true,
      options: ['Title', 'Content/body', 'Excerpt', 'Tags/categories'],
      defaultValue: ['Title', 'Content/body'],
    },
    {
      id: 'real-time-indexing',
      text: 'Update search index in real-time when content changes?',
      type: 'boolean',
      required: true,
      defaultValue: true,
    },
  ],
}

/**
 * Feature catalog - maps feature IDs to feature definitions
 */
export const FeatureCatalog = new Map<string, Feature>([
  ['authentication', AUTHENTICATION_FEATURE],
  ['blog', BLOG_FEATURE],
  ['comments', COMMENTS_FEATURE],
  ['file-upload', FILE_UPLOAD_FEATURE],
  ['semantic-search', SEMANTIC_SEARCH_FEATURE],
])

/**
 * Get feature by ID
 */
export function getFeature(featureId: string): Feature | undefined {
  return FeatureCatalog.get(featureId)
}

/**
 * Get all available features
 */
export function getAllFeatures(): Feature[] {
  return Array.from(FeatureCatalog.values())
}

/**
 * Get features by category
 */
export function getFeaturesByCategory(category: Feature['category']): Feature[] {
  return getAllFeatures().filter((f) => f.category === category)
}
