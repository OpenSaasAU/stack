import { config, list } from "@opensaas/core";
import {
  text,
  relationship,
  select,
  timestamp,
  password,
} from "@opensaas/core/fields";
import type { AccessControl } from "@opensaas/core";
import { registerFieldComponent } from "@opensaas/ui";
import { ColorPickerField } from "./components/ColorPickerField";
import { SlugField } from "./components/SlugField";

/**
 * GLOBAL FIELD TYPE REGISTRATION
 * Register a custom field type that can be used across the entire application
 */
registerFieldComponent("color", ColorPickerField);

/**
 * Access control helpers
 */

// Check if user is signed in
const isSignedIn: AccessControl = ({ session }) => {
  return !!session;
};

// Check if user is the author of a post
const isAuthor: AccessControl = ({ session }) => {
  if (!session) return false;
  return {
    authorId: { equals: session.userId },
  };
};

// Check if user is the owner of their own user record
const isOwner: AccessControl = ({ session, item }) => {
  if (!session) return false;
  return session.userId === item?.id;
};

/**
 * OpenSaaS Configuration
 */
export default config({
  db: {
    provider: "sqlite",
    url: process.env.DATABASE_URL || "file:./dev.db",
  },

  lists: {
    User: list({
      fields: {
        name: text({
          validation: { isRequired: true },
        }),
        email: text({
          validation: { isRequired: true },
          isIndexed: "unique",
        }),
        password: password({
          validation: { isRequired: true },
        }),
        /**
         * GLOBAL FIELD TYPE EXAMPLE
         * Using the globally registered "color" field type
         */
        favoriteColor: text({
          ui: {
            component: ColorPickerField,
          },
        }),
        posts: relationship({
          ref: "Post.author",
          many: true,
        }),
      },
      access: {
        operation: {
          query: () => true,
          create: () => true,
          update: isOwner,
          delete: isOwner,
        },
      },
    }),

    Post: list({
      fields: {
        title: text({
          validation: { isRequired: true },
          access: {
            read: () => true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        /**
         * PER-FIELD OVERRIDE EXAMPLE
         * Using a custom component for this specific field
         */
        slug: text({
          validation: { isRequired: true },
          isIndexed: "unique",
          ui: {
            component: SlugField,
          },
        }),
        content: text({
          ui: { displayMode: "textarea" },
          access: {
            read: () => true,
            create: isSignedIn,
            update: isAuthor,
          },
        }),
        /**
         * ANOTHER GLOBAL FIELD TYPE EXAMPLE
         * Using the color picker for theme color
         */
        themeColor: text({
          ui: {
            component: ColorPickerField,
          },
        }),
        status: select({
          options: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
          ],
          defaultValue: "draft",
          ui: { displayMode: "segmented-control" },
        }),
        publishedAt: timestamp(),
        author: relationship({
          ref: "User.posts",
        }),
      },
      access: {
        operation: {
          // Non-authenticated users can only see published posts
          // Authenticated users can see all posts
          query: ({ session }) => {
            if (!session) {
              return { status: { equals: "published" } };
            }
            return true;
          },
          // Must be signed in to create
          create: isSignedIn,
          // Only author can update
          update: isAuthor,
          // Only author can delete
          delete: isAuthor,
        },
      },
      hooks: {
        resolveInput: async ({ operation, resolvedData, item }) => {
          let result = { ...resolvedData };

          // Auto-set publishedAt when status changes to published
          if (
            result?.status === "published" &&
            (!item?.publishedAt || operation === "create")
          ) {
            result.publishedAt = new Date();
          }

          // Auto-generate slug from title if not provided
          if (operation === "create" && !result?.slug && result?.title) {
            const slug = (result.title as string)
              .toLowerCase()
              .replace(/[^\w\s-]/g, "")
              .replace(/\s+/g, "-")
              .replace(/--+/g, "-")
              .trim();
            result.slug = slug;
          }

          return result;
        },
      },
    }),
  },

  session: {
    getSession: async () => {
      // This is a mock for the example
      // In a real app, this would integrate with your auth system
      // For now, return null (not authenticated)
      return null;
    },
  },

  ui: {
    basePath: "/admin",
  },
});
