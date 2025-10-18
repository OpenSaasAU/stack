"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@opensaas/ui/primitives";
import { Button } from "@opensaas/ui/primitives";
import { ItemCreateForm } from "@opensaas/ui/standalone";
import { text, select, timestamp, relationship } from "@opensaas/core/fields";
import { createPost } from "../lib/actions";

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
              const result = await createPost(data);

              if (!result.success) {
                return { success: false, error: result.error || "Failed to create post" };
              }

              setOpen(false);
              router.refresh();
              router.push(`/posts/${result.data.id}`);
              return { success: true };
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
