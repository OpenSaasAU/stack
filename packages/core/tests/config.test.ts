import { describe, it, expect } from "vitest";
import { config, list } from "../src/config/index.js";
import type { OpenSaaSConfig, ListConfig } from "../src/config/types.js";
import { select } from "../src/fields/index.js";

describe("config helpers", () => {
  describe("config", () => {
    it("should return the same config object", () => {
      const testConfig: OpenSaaSConfig = {
        db: {
          provider: "postgresql",
          url: "postgresql://localhost:5432/test",
        },
        lists: {
          User: {
            fields: {
              name: { type: "text" },
              email: { type: "text", isIndexed: "unique" },
            },
          },
        },
      };

      const result = config(testConfig);
      expect(result).toBe(testConfig);
    });

    it("should provide type safety for config", () => {
      const testConfig = config({
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
        },
      });

      expect(testConfig.db.provider).toBe("postgresql");
      expect(testConfig.lists.User).toBeDefined();
    });

    it("should support optional session config", () => {
      const testConfig = config({
        db: {
          provider: "postgresql",
          url: "postgresql://localhost:5432/test",
        },
        lists: {},
        session: {
          getSession: async () => ({ userId: "123" }),
        },
      });

      expect(testConfig.session).toBeDefined();
    });

    it("should support optional ui config", () => {
      const testConfig = config({
        db: {
          provider: "postgresql",
          url: "postgresql://localhost:5432/test",
        },
        lists: {},
        ui: {
          basePath: "/admin",
        },
      });

      expect(testConfig.ui?.basePath).toBe("/admin");
    });
  });

  describe("list", () => {
    it("should return the same list config", () => {
      const testList: ListConfig = {
        fields: {
          name: { type: "text" },
          age: { type: "integer" },
        },
      };

      const result = list(testList);
      expect(result).toBe(testList);
    });

    it("should support text fields", () => {
      const testList = list({
        fields: {
          title: {
            type: "text",
            validation: {
              isRequired: true,
              length: { min: 3, max: 100 },
            },
            isIndexed: "unique",
          },
        },
      });

      expect(testList.fields.title.type).toBe("text");
    });

    it("should support integer fields", () => {
      const testList = list({
        fields: {
          count: {
            type: "integer",
            validation: {
              min: 0,
              max: 100,
            },
          },
        },
      });

      expect(testList.fields.count.type).toBe("integer");
    });

    it("should support checkbox fields", () => {
      const testList = list({
        fields: {
          isActive: { type: "checkbox" },
        },
      });

      expect(testList.fields.isActive.type).toBe("checkbox");
    });

    it("should support select fields", () => {
      const testList = list({
        fields: {
          status: select({
            options: [
              { label: "Draft", value: "draft" },
              { label: "Published", value: "published" },
            ],
          }),
        },
      });

      expect(testList.fields.status.type).toBe("select");
      expect(testList.fields.status.options).toHaveLength(2);
    });

    it("should support relationship fields", () => {
      const testList = list({
        fields: {
          author: {
            type: "relationship",
            ref: "User.posts",
            many: false,
          },
        },
      });

      expect(testList.fields.author.type).toBe("relationship");
    });

    it("should support access control", () => {
      const testList = list({
        fields: { name: { type: "text" } },
        access: {
          operation: {
            query: () => true,
            create: () => true,
            update: () => false,
            delete: () => false,
          },
        },
      });

      expect(testList.access?.operation).toBeDefined();
    });

    it("should support hooks", () => {
      const testList = list({
        fields: { name: { type: "text" } },
        hooks: {
          resolveInput: async ({ resolvedData }) => resolvedData,
          validateInput: async () => {},
          beforeOperation: async () => {},
          afterOperation: async () => {},
        },
      });

      expect(testList.hooks).toBeDefined();
      expect(testList.hooks?.resolveInput).toBeDefined();
    });
  });
});
