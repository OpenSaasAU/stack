'use client'

import React, { useState } from 'react'
import { FileField, ImageField } from '@opensaas/stack-ui/fields'
import { Button, Card, Label, Input } from '@opensaas/stack-ui/primitives'
import type { FileMetadata, ImageMetadata } from '@opensaas/stack-storage'
import Link from 'next/link'
import { createPost } from './actions'

/**
 * Custom form demonstrating file and image upload fields
 *
 * This shows how to use the FileField and ImageField components
 * in a custom form with your own upload handler.
 */
export default function CustomFormPage() {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [coverImage, setCoverImage] = useState<ImageMetadata | null>(null)
  const [attachment, setAttachment] = useState<FileMetadata | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)

  /**
   * Upload handler for images
   * This is called by the ImageField component when a file is selected
   */
  const handleImageUpload = async (file: File): Promise<ImageMetadata> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('storage', 'avatars')
    formData.append('fieldType', 'image')

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Upload failed')
    }

    return await response.json()
  }

  /**
   * Upload handler for files
   * This is called by the FileField component when a file is selected
   */
  const handleFileUpload = async (file: File): Promise<FileMetadata> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('storage', 'documents')
    formData.append('fieldType', 'file')

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Upload failed')
    }

    return await response.json()
  }

  /**
   * Form submission handler
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setSubmitMessage(null)

    try {
      // Create the post using server action
      const result = await createPost({
        title,
        content,
        coverImage,
        attachment,
      })

      if (result.success) {
        setSubmitMessage('Post created successfully! View it in the admin dashboard.')

        // Reset form
        setTitle('')
        setContent('')
        setCoverImage(null)
        setAttachment(null)
      } else {
        setSubmitMessage(result.error || 'Failed to create post')
      }
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : 'Failed to create post')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Home
          </Link>
        </div>

        <Card className="p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Create Post</h1>
            <p className="text-gray-600 mt-2">Custom form with file and image uploads</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter post title"
                required
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your post content..."
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Cover Image */}
            <ImageField
              name="coverImage"
              value={coverImage}
              onChange={setCoverImage}
              label="Cover Image"
              helpText="Upload a cover image for your post (max 10MB, JPG/PNG/WebP)"
              onUpload={handleImageUpload}
              showPreview={true}
              previewSize={300}
            />

            {/* Attachment */}
            <FileField
              name="attachment"
              value={attachment}
              onChange={setAttachment}
              label="Attachment"
              helpText="Upload a document (PDF or Word, max 10MB)"
              onUpload={handleFileUpload}
            />

            {/* Submit Button */}
            <div className="flex gap-4 pt-4">
              <Button type="submit" disabled={isSubmitting || !title}>
                {isSubmitting ? 'Creating...' : 'Create Post'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setTitle('')
                  setContent('')
                  setCoverImage(null)
                  setAttachment(null)
                }}
              >
                Reset
              </Button>
            </div>

            {/* Submit Message */}
            {submitMessage && (
              <div
                className={`p-4 rounded-md ${
                  submitMessage.includes('success')
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}
              >
                {submitMessage}
              </div>
            )}
          </form>

          {/* Debug Info */}
          <div className="mt-8 pt-8 border-t">
            <h3 className="font-semibold mb-4">Form Data (Debug):</h3>
            <pre className="bg-gray-100 p-4 rounded-md overflow-auto text-xs">
              {JSON.stringify(
                {
                  title,
                  content,
                  coverImage,
                  attachment,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </Card>
      </div>
    </div>
  )
}
