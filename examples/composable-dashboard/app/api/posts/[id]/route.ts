import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../lib/context";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const data = await request.json();

    const post = await prisma.post.update({
      where: { id: params.id },
      data: {
        title: data.title,
        slug: data.slug,
        content: data.content,
        status: data.status,
        internalNotes: data.internalNotes,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        author: data.author?.connect ? { connect: data.author.connect } : undefined,
      },
      include: {
        author: true,
      },
    });

    return NextResponse.json(post);
  } catch (error: any) {
    console.error("Failed to update post:", error);
    return NextResponse.json(
      { message: error.message || "Failed to update post" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.post.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Failed to delete post:", error);
    return NextResponse.json(
      { message: error.message || "Failed to delete post" },
      { status: 500 }
    );
  }
}
