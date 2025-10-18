"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext, getContextWithUser } from "./context";

// For demo purposes, we'll use a hardcoded user ID
// In a real app, this would come from your auth session
const DEMO_USER_ID = "demo-user-1";

export async function createPost(data: any) {
  const context = await getContextWithUser(DEMO_USER_ID);

  const post = await context.db.post.create({
    data: {
      title: data.title,
      slug: data.slug,
      content: data.content,
      status: data.status || "draft",
      internalNotes: data.internalNotes,
      publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
      author: data.author?.connect || { connect: { id: DEMO_USER_ID } },
    },
  });

  if (!post) {
    return { success: false, error: "Failed to create post" };
  }

  revalidatePath("/");
  revalidatePath("/posts");
  return { success: true, data: post };
}

export async function updatePost(id: string, data: any) {
  const context = await getContextWithUser(DEMO_USER_ID);

  const post = await context.db.post.update({
    where: { id },
    data: {
      title: data.title,
      slug: data.slug,
      content: data.content,
      status: data.status,
      internalNotes: data.internalNotes,
      publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
    },
  });

  if (!post) {
    return { success: false, error: "Access denied or post not found" };
  }

  revalidatePath("/");
  revalidatePath("/posts");
  revalidatePath(`/posts/${id}`);
  return { success: true, data: post };
}

export async function deletePost(id: string) {
  const context = await getContextWithUser(DEMO_USER_ID);

  const post = await context.db.post.delete({
    where: { id },
  });

  if (!post) {
    return { success: false, error: "Access denied or post not found" };
  }

  revalidatePath("/");
  revalidatePath("/posts");
  redirect("/posts");
}
