import { config, list } from '@opensaas/stack-core'
import { text, relationship } from '@opensaas/stack-core/fields'
import { localStorage } from '@opensaas/stack-storage'
import { file, image } from '@opensaas/stack-storage/fields'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

export default config({
  db: {
    provider: 'sqlite',
    prismaClientConstructor: (PrismaClient) => {
      const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || './dev.db' })
      return new PrismaClient({ adapter })
    },
  },

  storage: {
    // Local filesystem storage for documents
    documents: localStorage({
      uploadDir: './public/uploads/documents',
      serveUrl: '/uploads/documents',
    }),

    // Local storage for avatars (in production, use S3 or Vercel Blob)
    avatars: localStorage({
      uploadDir: './public/uploads/avatars',
      serveUrl: '/uploads/avatars',
    }),

    // Example S3 configuration (commented out)
    // avatars: s3Storage({
    //   bucket: process.env.AWS_BUCKET || 'my-avatars',
    //   region: process.env.AWS_REGION || 'us-east-1',
    //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    //   acl: 'public-read',
    // }),
  },

  lists: {
    User: list({
      fields: {
        name: text({ validation: { isRequired: true } }),
        email: text({ validation: { isRequired: true } }),

        // Avatar image with transformations
        avatar: image({
          storage: 'avatars',
          transformations: {
            thumbnail: { width: 100, height: 100, fit: 'cover', format: 'webp' },
            profile: { width: 400, height: 400, fit: 'cover', format: 'webp' },
          },
          validation: {
            maxFileSize: 5 * 1024 * 1024, // 5MB
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
          ui: {
            label: 'Profile Picture',
            helpText: 'Upload a profile picture (max 5MB, JPG/PNG/WebP)',
          },
        }),

        posts: relationship({ ref: 'Post.author', many: true }),
      },
    }),

    Post: list({
      fields: {
        title: text({ validation: { isRequired: true } }),
        content: text({ ui: { placeholder: 'Write your post content...' } }),

        // Cover image for the post
        coverImage: image({
          storage: 'avatars',
          transformations: {
            thumbnail: { width: 300, height: 200, fit: 'cover', format: 'webp' },
            large: { width: 1200, height: 800, fit: 'cover', format: 'jpeg', quality: 90 },
          },
          validation: {
            maxFileSize: 10 * 1024 * 1024, // 10MB
            acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
          ui: {
            label: 'Cover Image',
            helpText: 'Upload a cover image for your post (max 10MB)',
          },
        }),

        // Attachment file (PDF, DOC, etc.)
        attachment: file({
          storage: 'documents',
          validation: {
            maxFileSize: 10 * 1024 * 1024, // 10MB
            acceptedMimeTypes: [
              'application/pdf',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
          },
          ui: {
            label: 'Attachment',
            helpText: 'Upload a document (PDF or Word, max 10MB)',
          },
        }),

        author: relationship({ ref: 'User.posts' }),
      },

      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      },
    }),
  },
})
