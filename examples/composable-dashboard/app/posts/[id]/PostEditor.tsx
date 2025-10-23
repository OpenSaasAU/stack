'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@opensaas/ui/primitives'
import { Button } from '@opensaas/ui/primitives'
import { ItemEditForm, DeleteButton } from '@opensaas/ui/standalone'
import { updatePost, deletePost } from '../../../lib/actions'
import config from '../../../opensaas.config'
import type { Post, PostUpdateInput } from '../../../.opensaas/types'

export function PostEditor({ post }: { post: Post }) {
  const [editing, setEditing] = useState(false)
  const router = useRouter()

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit Post</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemEditForm<PostUpdateInput>
            fields={config.lists.Post.fields}
            initialData={post as unknown as PostUpdateInput}
            onSubmit={async (data) => {
              const result = await updatePost(post.id, data)

              if (!result.success) {
                return { success: false, error: result.error || 'Failed to update post' }
              }

              setEditing(false)
              router.refresh()
              return { success: true }
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Post Details */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-3xl">{post.title}</CardTitle>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <span>by {post.author?.name || 'Unknown'}</span>
                <span>•</span>
                <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                <span>•</span>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded ${
                    post.status === 'published'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}
                >
                  {post.status}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setEditing(true)}>Edit</Button>
              <DeleteButton
                onDelete={async () => {
                  const result = await deletePost(post.id)

                  if (!result.success) {
                    return { success: false, error: result.error || 'Failed to delete post' }
                  }

                  router.push('/posts')
                  router.refresh()
                  return { success: true }
                }}
                itemName="post"
                buttonVariant="destructive"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-semibold mb-2">Slug</h3>
            <code className="text-sm bg-muted px-2 py-1 rounded">{post.slug}</code>
          </div>

          {post.content && (
            <div>
              <h3 className="font-semibold mb-2">Content</h3>
              <div className="prose max-w-none">
                <p className="text-foreground whitespace-pre-wrap">{post.content}</p>
              </div>
            </div>
          )}

          {post.internalNotes && (
            <div>
              <h3 className="font-semibold mb-2">Internal Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {post.internalNotes}
              </p>
            </div>
          )}

          {post.publishedAt && (
            <div>
              <h3 className="font-semibold mb-2">Published At</h3>
              <p className="text-sm text-muted-foreground">
                {new Date(post.publishedAt).toLocaleString()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
