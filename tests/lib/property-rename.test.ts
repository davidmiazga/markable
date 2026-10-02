import { describe, expect, it } from "vitest";
import { validatePropertyRename } from "../../src/lib/property-rename";

describe("validatePropertyRename", () => {
  const existing = ["food", "food/recipe", "work"];

  it("rejects empty, same, spaces, hash, colon, and leading numbers", () => {
    expect(validatePropertyRename("food", "", existing)).toMatch(/empty/i);
    expect(validatePropertyRename("food", "food", existing)).toMatch(/same/);
    expect(validatePropertyRename("food", "has space", existing)).toMatch(/Invalid name/);
    expect(validatePropertyRename("food", "bad#tag", existing)).toMatch(/Invalid name/);
    expect(validatePropertyRename("food", "status:draft", existing)).toMatch(/Invalid name/);
    expect(validatePropertyRename("food", "1meals", existing)).toMatch(/Invalid name/);
    expect(validatePropertyRename("food", "/lead", existing)).toMatch(/slash/);
  });

  it("rejects an existing name so merge stays a separate action", () => {
    expect(validatePropertyRename("food", "work", existing)).toMatch(/already exists/);
  });

  it("allows a parent rename that only moves its own slash children", () => {
    expect(validatePropertyRename("food", "meals", existing)).toBeNull();
  });
});
