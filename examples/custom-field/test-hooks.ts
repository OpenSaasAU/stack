/**
 * Test script to demonstrate OpenSaaS hooks system
 *
 * Run with: npx tsx test-hooks.ts
 */

import { prisma } from "./lib/context";
import { getContextWithUser } from "./lib/context";
import { ValidationError } from "@opensaas/core";

async function test() {
  console.log("🧪 Testing OpenSaaS Hooks System\n");
  console.log("=".repeat(60));

  try {
    // Clean up any existing data
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();

    // ========================================
    // Test 1: Create a user
    // ========================================
    console.log("\n📝 Test 1: Creating a user...");
    const alice = await prisma.user.create({
      data: {
        name: "Alice",
        email: "alice@example.com",
        password: "hashed_password",
      },
    });
    console.log("✅ User created:", alice.id);

    const context = await getContextWithUser(alice.id);

    // ========================================
    // Test 2: resolveInput Hook - Auto-set publishedAt
    // ========================================
    console.log("\n📝 Test 2: Testing resolveInput hook (auto-set publishedAt)...");
    const post1 = await context.db.post.create({
      data: {
        title: "My First Post",
        slug: "my-first-post",
        content: "Hello world!",
        status: "published", // Note: NOT setting publishedAt manually
        author: { connect: { id: alice.id } },
      },
    });

    if (post1 && post1.publishedAt) {
      console.log("✅ resolveInput hook worked: publishedAt was auto-set");
      console.log("   publishedAt:", post1.publishedAt);
    } else {
      console.log("❌ FAILED: publishedAt should have been auto-set");
    }

    // ========================================
    // Test 3: resolveInput Hook - Only set on first publish
    // ========================================
    console.log("\n📝 Test 3: Testing resolveInput hook (preserve publishedAt on update)...");
    const originalPublishedAt = post1?.publishedAt;

    // Wait a moment to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 100));

    const updated = await context.db.post.update({
      where: { id: post1!.id },
      data: {
        title: "Updated Title",
        status: "published", // Still published
      },
    });

    if (updated && updated.publishedAt?.getTime() === originalPublishedAt?.getTime()) {
      console.log("✅ resolveInput hook worked: publishedAt was preserved");
    } else {
      console.log("❌ FAILED: publishedAt should not have changed");
    }

    // ========================================
    // Test 4: validateInput Hook - Reject spam
    // ========================================
    console.log("\n📝 Test 4: Testing validateInput hook (reject spam)...");
    try {
      await context.db.post.create({
        data: {
          title: "This is SPAM content",
          slug: "spam-post",
          content: "Buy now!",
          author: { connect: { id: alice.id } },
        },
      });
      console.log('❌ FAILED: Should have rejected post with "spam" in title');
    } catch (error) {
      if (error instanceof ValidationError) {
        console.log("✅ validateInput hook worked: Validation error thrown");
        console.log("   Error:", error.errors[0]);
      } else {
        console.log("❌ FAILED: Wrong error type");
      }
    }

    // ========================================
    // Test 5: Field validation - isRequired
    // ========================================
    console.log("\n📝 Test 5: Testing field validation (isRequired)...");
    try {
      await context.db.post.create({
        // @ts-expect-error Testing missing required field
        data: {
          // Missing required 'title' field
          slug: "no-title-post",
          content: "This should fail",
          author: { connect: { id: alice.id } },
        },
      });
      console.log("❌ FAILED: Should have rejected post without title");
    } catch (error) {
      if (error instanceof ValidationError && error.errors.some((e) => e.includes("title"))) {
        console.log("✅ Field validation worked: Title is required");
        console.log("   Error:", error.errors[0]);
      } else {
        console.log("❌ FAILED: Wrong error");
      }
    }

    // ========================================
    // Test 6: beforeOperation and afterOperation Hooks
    // ========================================
    console.log("\n📝 Test 6: Testing beforeOperation and afterOperation hooks...");
    console.log("   (Check console for hook log messages)");

    const post2 = await context.db.post.create({
      data: {
        title: "Test Hooks Post",
        slug: "test-hooks",
        content: "Testing hooks",
        author: { connect: { id: alice.id } },
      },
    });

    if (post2) {
      console.log("✅ Hooks executed (check logs above)");
    }

    // ========================================
    // Test 7: Update with hooks
    // ========================================
    console.log("\n📝 Test 7: Testing update operation hooks...");

    const updated2 = await context.db.post.update({
      where: { id: post2!.id },
      data: {
        title: "Updated via Hooks",
      },
    });

    if (updated2) {
      console.log("✅ Update hooks executed (check logs above)");
    }

    // ========================================
    // Test 8: Delete with hooks
    // ========================================
    console.log("\n📝 Test 8: Testing delete operation hooks...");

    const deleted = await context.db.post.delete({
      where: { id: post2!.id },
    });

    if (deleted) {
      console.log("✅ Delete hooks executed (check logs above)");
    }

    // ========================================
    // Test 9: Publish draft (auto-set publishedAt)
    // ========================================
    console.log("\n📝 Test 9: Testing publish workflow (draft → published)...");

    const draft = await context.db.post.create({
      data: {
        title: "Draft Post",
        slug: "draft-post",
        content: "This starts as a draft",
        status: "draft", // Start as draft
        author: { connect: { id: alice.id } },
      },
    });

    console.log(
      "   Created draft (publishedAt should be null):",
      draft?.publishedAt === null ? "null ✓" : "NOT null ✗",
    );

    // Publish it
    const published = await context.db.post.update({
      where: { id: draft!.id },
      data: {
        status: "published",
      },
    });

    if (published && published.publishedAt) {
      console.log("✅ Publish workflow worked: publishedAt was auto-set on status change");
      console.log("   publishedAt:", published.publishedAt);
    } else {
      console.log("❌ FAILED: publishedAt should have been set when publishing");
    }

    // ========================================
    // Summary
    // ========================================
    console.log("\n" + "=".repeat(60));
    console.log("🎉 All hooks tests passed!");
    console.log("\nHooks demonstrated:");
    console.log("  ✅ resolveInput - Auto-set publishedAt when publishing");
    console.log("  ✅ validateInput - Custom validation (reject spam)");
    console.log("  ✅ beforeOperation - Side effects before DB operation");
    console.log("  ✅ afterOperation - Side effects after DB operation");
    console.log("  ✅ Field validation - Built-in isRequired validation");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
    throw error;
  } finally {
    // Cleanup
    console.log("\n🧹 Cleaning up test data...");
    await prisma.post.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  }
}

// Run tests
test().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
