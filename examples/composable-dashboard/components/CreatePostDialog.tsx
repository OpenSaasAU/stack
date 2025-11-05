'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@opensaas/stack-ui/primitives'
import { Button } from '@opensaas/stack-ui/primitives'
import { ItemCreateForm } from '@opensaas/stack-ui/standalone'
import { createPost } from '../lib/actions'
import type { PostCreateInput } from '../.opensaas/types'
import { FieldConfig } from '@opensaas/stack-core'

export function CreatePostDialog({ fields }: { fields: Record<string, FieldConfig> }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  return (
    <>
      <Button onClick={() => setOpen(true)} className="w-full">
        + Create Post
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Post</DialogTitle>
          </DialogHeader>

          <ItemCreateForm<PostCreateInput>
            fields={fields}
            onSubmit={async (data) => {
              const result = await createPost(data)

              if (!result.success) {
                return { success: false, error: result.error || 'Failed to create post' }
              }

              setOpen(false)
              router.refresh()
              if (result.data?.id) {
                router.push(`/posts/${result.data.id}`)
              }
              return { success: true }
            }}
            onCancel={() => setOpen(false)}
            submitLabel="Create Post"
            className="space-y-6"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
