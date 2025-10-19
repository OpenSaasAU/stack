import { describe, it, expect } from "vitest";
import { filterReadableFields, getRelatedListConfig } from "../src/access/engine.js";
import type { OpenSaaSConfig, AccessContext } from "../src/index.js";

describe("Relationship Access Control", () => {
  const mockContext: AccessContext = {
    session: null,
    prisma: {},
  };

  describe("getRelatedListConfig", () => {
    const config: OpenSaaSConfig = {
      db: {
        provider: "postgresql",
        url: "postgresql://localhost:5432/test",
      },
      lists: {
        User: {
          fields: {
            name: { type: "text" },
          },
        },
        Post: {
          fields: {
            title: { type: "text" },
          },
        },
      },
    };

    it("should parse relationship ref and return list config", () => {
      const result = getRelatedListConfig("Post.author", config);

      expect(result).toBeDefined();
      expect(result?.listName).toBe("Post");
      expect(result?.listConfig).toBeDefined();
      expect(result?.listConfig.fields.title).toBeDefined();
    });

    it("should return null for invalid ref format", () => {
      const result = getRelatedListConfig("InvalidRef", config);

      expect(result).toBeNull();
    });

    it("should return null for non-existent list", () => {
      const result = getRelatedListConfig("NonExistent.field", config);

      expect(result).toBeNull();
    });
  });

  describe("filterReadableFields with relationships", () => {
    describe("single relationships", () => {
      it("should apply access control to single relationship", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
              },
              access: {
                operation: {
                  query: () => true, // Allow reading users
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                author: {
                  type: "relationship",
                  ref: "User.posts",
                },
              },
            },
          },
        };

        const post = {
          id: "1",
          title: "Test Post",
          author: {
            id: "1",
            name: "John Doe",
          },
        };

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.title).toBe("Test Post");
        expect(result.author).toBeDefined();
        expect(result.author?.name).toBe("John Doe");
      });

      it("should filter out single relationship when access denied (via buildIncludeWithAccessControl)", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
              },
              access: {
                operation: {
                  query: () => false, // Deny reading users
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                author: {
                  type: "relationship",
                  ref: "User.posts",
                },
              },
            },
          },
        };

        // Test that buildIncludeWithAccessControl excludes the denied relationship
        const { buildIncludeWithAccessControl } = await import("../src/access/engine.js");

        const include = await buildIncludeWithAccessControl(
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        // When access is denied, the relationship should not be included
        expect(include).toBeDefined();
        expect(include?.author).toBeUndefined();
      });

      it("should apply field-level access to single relationship", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                email: {
                  type: "text",
                  access: {
                    read: () => false, // Hide email
                  },
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                author: {
                  type: "relationship",
                  ref: "User.posts",
                },
              },
            },
          },
        };

        const post = {
          id: "1",
          title: "Test Post",
          author: {
            id: "1",
            name: "John Doe",
            email: "john@example.com",
          },
        };

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.author).toBeDefined();
        expect(result.author?.name).toBe("John Doe");
        expect(result.author?.email).toBeUndefined();
      });
    });

    describe("many relationships (arrays)", () => {
      it("should apply access control to many relationships", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                status: { type: "select", options: [] },
              },
              access: {
                operation: {
                  query: () => true, // Allow all posts
                },
              },
            },
          },
        };

        const user = {
          id: "1",
          name: "John Doe",
          posts: [
            { id: "1", title: "Post 1", status: "published" },
            { id: "2", title: "Post 2", status: "draft" },
          ],
        };

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.posts).toHaveLength(2);
        expect(result.posts?.[0].title).toBe("Post 1");
        expect(result.posts?.[1].title).toBe("Post 2");
      });

      it("should filter items in many relationships based on query access (via buildIncludeWithAccessControl)", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                status: { type: "select", options: [] },
              },
              access: {
                operation: {
                  // Only show published posts
                  query: () => ({ status: { equals: "published" } }),
                },
              },
            },
          },
        };

        // Test that buildIncludeWithAccessControl creates the right where clause
        const { buildIncludeWithAccessControl } = await import("../src/access/engine.js");

        const include = await buildIncludeWithAccessControl(
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        // Should include posts with a where filter
        expect(include).toBeDefined();
        expect(include?.posts).toBeDefined();
        // @ts-expect-error the test
        expect(include?.posts.where).toEqual({ status: { equals: "published" } });
      });

      it("should apply field-level access to items in many relationships", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                internalNotes: {
                  type: "text",
                  access: {
                    read: () => false, // Hide internal notes
                  },
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
          },
        };

        const user = {
          id: "1",
          name: "John Doe",
          posts: [
            { id: "1", title: "Post 1", internalNotes: "Secret notes" },
            { id: "2", title: "Post 2", internalNotes: "More secrets" },
          ],
        };

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.posts).toHaveLength(2);
        expect(result.posts?.[0].title).toBe("Post 1");
        expect(result.posts?.[0].internalNotes).toBeUndefined();
        expect(result.posts?.[1].title).toBe("Post 2");
        expect(result.posts?.[1].internalNotes).toBeUndefined();
      });

      it("should handle empty arrays", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
          },
        };

        const user = {
          id: "1",
          name: "John Doe",
          posts: [],
        };

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.posts).toEqual([]);
      });
    });

    describe("session-based access for relationships", () => {
      it("should apply session-based access to relationships (via buildIncludeWithAccessControl)", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                authorId: { type: "text" },
              },
              access: {
                operation: {
                  // Only show posts owned by current user
                  query: ({ session }) => {
                    if (!session) return false;
                    return { authorId: { equals: session.userId } };
                  },
                },
              },
            },
          },
        };

        // Test that buildIncludeWithAccessControl creates session-based where clause
        const { buildIncludeWithAccessControl } = await import("../src/access/engine.js");

        const include = await buildIncludeWithAccessControl(
          config.lists.User.fields,
          {
            session: { userId: "1" },
            context: mockContext,
          },
          config,
        );

        // Should include posts with session-based where filter
        expect(include).toBeDefined();
        expect(include?.posts).toBeDefined();
        // @ts-expect-error the test
        expect(include?.posts.where).toEqual({ authorId: { equals: "1" } });
      });
    });

    describe("depth limiting", () => {
      it("should prevent infinite recursion with depth limit", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
                posts: {
                  type: "relationship",
                  ref: "Post.author",
                  many: true,
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                author: {
                  type: "relationship",
                  ref: "User.posts",
                },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
          },
        };

        // Create circular reference structure
        const user = {
          id: "1",
          name: "John Doe",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          posts: [] as any[],
        };

        const post = {
          id: "1",
          title: "Test Post",
          author: user,
        };

        user.posts = [post];

        const result = await filterReadableFields(
          user,
          config.lists.User.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        // Should not throw stack overflow error
        expect(result).toBeDefined();
        expect(result.posts).toBeDefined();
      });
    });

    describe("null and undefined relationships", () => {
      it("should handle null single relationships", async () => {
        const config: OpenSaaSConfig = {
          db: {
            provider: "postgresql",
            url: "postgresql://localhost:5432/test",
          },
          lists: {
            User: {
              fields: {
                name: { type: "text" },
              },
              access: {
                operation: {
                  query: () => true,
                },
              },
            },
            Post: {
              fields: {
                title: { type: "text" },
                author: {
                  type: "relationship",
                  ref: "User.posts",
                },
              },
            },
          },
        };

        const post = {
          id: "1",
          title: "Test Post",
          author: null,
        };

        const result = await filterReadableFields(
          post,
          config.lists.Post.fields,
          {
            session: null,
            context: mockContext,
          },
          config,
        );

        expect(result.author).toBeNull();
      });
    });
  });
});
