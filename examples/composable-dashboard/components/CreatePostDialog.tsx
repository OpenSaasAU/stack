"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@opensaas/ui/primitives";
import { Button } from "@opensaas/ui/primitives";
import { ItemCreateForm } from "@opensaas/ui/standalone";
import { text, select, timestamp, relationship } from "@opensaas/core/fields";

const postFields = {
  title: text({ validation: { isRequired: true } }),
  slug: text({ validation: { isRequired: true } }),
  content: text(),
  status: select({
    options: [
      { label: "Draft", value: "draft" },
      { label: "Published", value: "published" },
    ],
    defaultValue: "draft",
  }),
  publishedAt: timestamp(),
  internalNotes: text(),
  author: relationship({ ref: "User.posts" }),
};

export function CreatePostDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

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

          <ItemCreateForm
            fields={postFields}
            onSubmit={async (data) => {
              try {
                const response = await fetch("/api/posts", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(data),
                });

                if (!response.ok) {
                  const error = await response.json();
                  return { success: false, error: error.message || "Failed to create post" };
                }

                const post = await response.json();
                setOpen(false);
                router.refresh();
                router.push(`/posts/${post.id}`);
                return { success: true };
              } catch (error: any) {
                return { success: false, error: error.message || "Failed to create post" };
              }
            }}
            onCancel={() => setOpen(false)}
            submitLabel="Create Post"
            className="space-y-6"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
