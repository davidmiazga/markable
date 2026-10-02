import { describe, expect, it } from "vitest";
import {
  findSimilarDefinitions,
  sanitizeDefinitionName,
  validateMergeField,
} from "../../src/lib/property-merge";

describe("property-merge library", () => {
  describe("sanitizeDefinitionName", () => {
    it("converts spaces, colons, hashes, and special characters into dashes", () => {
      expect(sanitizeDefinitionName("my tag")).toBe("my-tag");
      expect(sanitizeDefinitionName("#bad@tag!")).toBe("bad-tag");
      expect(sanitizeDefinitionName("status:draft")).toBe("status-draft");
      expect(sanitizeDefinitionName("food & wine")).toBe("food-wine");
    });

    it("collapses multiple dashes and trims edges", () => {
      expect(sanitizeDefinitionName("---foo---bar---")).toBe("foo-bar");
      expect(sanitizeDefinitionName("  my  //  tag  ")).toBe("my/tag");
    });

    it("preserves slash-nested hierarchies with clean segments", () => {
      expect(sanitizeDefinitionName("recipes / quick meal #1")).toBe("recipes/quick-meal-1");
    });
  });

  describe("validateMergeField", () => {
    it("rejects empty value and self-merge", () => {
      expect(validateMergeField("", "food").valid).toBe(false);
      expect(validateMergeField("", "food").error).toMatch(/empty/i);

      expect(validateMergeField("food", "food").valid).toBe(false);
      expect(validateMergeField("food", "food").error).toMatch(/itself/i);
    });

    it("detects special characters and suggests a clean replacement with dashes", () => {
      const res = validateMergeField("quick recipe#1", "food");
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Special characters/);
      expect(res.suggested).toBe("quick-recipe-1");
    });

    it("accepts valid names with dashes, underscores, and slash nesting", () => {
      expect(validateMergeField("my-recipe", "food")).toEqual({ valid: true });
      expect(validateMergeField("quick_meal", "food")).toEqual({ valid: true });
      expect(validateMergeField("recipes/dessert", "food")).toEqual({ valid: true });
    });
  });

  describe("findSimilarDefinitions", () => {
    const existing = [
      "food",
      "Food",
      "FOOD",
      "daily-note",
      "daily_note",
      "colour",
      "color",
      "unrelated",
    ];

    it("finds case-sensitive variations", () => {
      const candidates = findSimilarDefinitions("Food", existing);
      expect(candidates).toContain("food");
      expect(candidates).toContain("FOOD");
      expect(candidates).not.toContain("Food"); // target excluded
      expect(candidates).not.toContain("unrelated");
    });

    it("finds separator variations", () => {
      const candidates = findSimilarDefinitions("daily-note", existing);
      expect(candidates).toContain("daily_note");
    });

    it("finds edit-distance near duplicates", () => {
      const candidates = findSimilarDefinitions("colour", existing);
      expect(candidates).toContain("color");
    });
  });
});
