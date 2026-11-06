import { describe, expect, it } from "vitest";
import { projectWriteFields } from "../mcp/project-fields";

const CARD_AND_PROFILE_FIELDS = [
  "description",
  "product_manager",
  "experience_officer",
  "dev_url",
  "test_url",
  "prod_url",
  "verify_env",
  "agent_notes",
] as const;

describe("project write fields", () => {
  it("lets an admin agent write the detail fields that were missing from the tool", () => {
    const keys = Object.keys(projectWriteFields);
    for (const key of CARD_AND_PROFILE_FIELDS) {
      expect(keys).toContain(key);
    }
    expect(keys).toEqual(
      expect.arrayContaining([
        "github_url",
        "default_branch",
        "tech_stack",
        "design_url",
        "docs_url",
      ])
    );
  });

  it("limits the default verify environment to dev, test, prod, or blank", () => {
    expect(projectWriteFields.verify_env.safeParse("dev").success).toBe(true);
    expect(projectWriteFields.verify_env.safeParse("test").success).toBe(true);
    expect(projectWriteFields.verify_env.safeParse("prod").success).toBe(true);
    expect(projectWriteFields.verify_env.safeParse("").success).toBe(true);
    expect(projectWriteFields.verify_env.safeParse(undefined).success).toBe(true);
    expect(projectWriteFields.verify_env.safeParse("staging").success).toBe(false);
  });
});
