import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../lib/context";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();

    const post = await prisma.post.create({
      data: {
        title: data.title,
        slug: data.slug,
        content: data.content,
        status: data.status || "draft",
        internalNotes: data.internalNotes,
        author: data.author?.connect ? { connect: data.author.connect } : undefined,
      },
      include: {
        author: true,
      },
    });

    return NextResponse.json(post);
  } catch (error: any) {
    console.error("Failed to create post:", error);
    return NextResponse.json(
      { message: error.message || "Failed to create post" },
      { status: 500 }
    );
  }
}
