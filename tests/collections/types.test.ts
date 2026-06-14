/**
 * tests/collections/types.test.ts — step_01
 *
 * Asserts the pure schema/types module surface for Collections:
 *   - nextStackName: derives the next "Stack NN" identifier from a list
 *     of existing folder names. Mirrors FR-6.
 *   - isCollectionType / isStackType: type-guards used by detection
 *     short-circuit (step 05) and store layer (step 02).
 *   - schema constants: enforced single source of truth for the YAML key
 *     names and the default Stack icon.
 *
 * No DOM, no I/O. Pure module — zero mocks required.
 */

import { describe, it, expect } from "vitest";
import {
  COLLECTIONS_SCHEMA_VERSION,
  COLLECTION_YAML_KEYS,
  STACK_DEFAULT_ICON,
  STACK_AUTO_NAME_PREFIX,
  nextStackName,
  isCollectionType,
  isStackType,
} from "../../src/plugins/file-browser/collections/schema";

describe("schema: nextStackName (step_01)", () => {
  it("returns 'Stack 01' when the list is empty", () => {
    expect(nextStackName([])).toBe("Stack 01");
  });

  it("returns 'Stack 02' when ['Stack 01'] is present", () => {
    expect(nextStackName(["Stack 01"])).toBe("Stack 02");
  });

  it("returns 'Stack 03' for ['Stack 01', 'Stack 02']", () => {
    expect(nextStackName(["Stack 01", "Stack 02"])).toBe("Stack 03");
  });

  it("skips gaps and picks max+1 — ['Stack 01', 'Stack 03'] -> 'Stack 04'", () => {
    // EC-3: gap-skipping prevents re-using a Stack name a user deleted on disk,
    // which keeps `_folder.md` history clean.
    expect(nextStackName(["Stack 01", "Stack 03"])).toBe("Stack 04");
  });

  it("ignores non-matching names — ['MyFolder', 'Notes'] -> 'Stack 01'", () => {
    expect(nextStackName(["MyFolder", "Notes"])).toBe("Stack 01");
  });

  it("handles three-digit indices (1..99 list -> 'Stack 100')", () => {
    const names: string[] = [];
    for (let i = 1; i <= 99; i++) {
      names.push(`Stack ${String(i).padStart(2, "0")}`);
    }
    expect(nextStackName(names)).toBe("Stack 100");
  });
});

describe("schema: type guards (step_01)", () => {
  it("isCollectionType discriminates 'collection' from other values", () => {
    expect(isCollectionType("collection")).toBe(true);
    expect(isCollectionType("stack")).toBe(false);
    expect(isCollectionType("")).toBe(false);
    expect(isCollectionType(undefined)).toBe(false);
    expect(isCollectionType(null)).toBe(false);
    expect(isCollectionType(42)).toBe(false);
    expect(isCollectionType({})).toBe(false);
  });

  it("isStackType discriminates 'stack' from other values", () => {
    expect(isStackType("stack")).toBe(true);
    expect(isStackType("collection")).toBe(false);
    expect(isStackType("")).toBe(false);
    expect(isStackType(undefined)).toBe(false);
    expect(isStackType(null)).toBe(false);
    expect(isStackType(42)).toBe(false);
  });
});

describe("schema: constants (step_01)", () => {
  it("COLLECTIONS_SCHEMA_VERSION equals 1", () => {
    // EC-13: bumping this constant requires a migration story.
    expect(COLLECTIONS_SCHEMA_VERSION).toBe(1);
  });

  it("STACK_DEFAULT_ICON equals 'notebook' (catalog id, C-6)", () => {
    expect(STACK_DEFAULT_ICON).toBe("notebook");
  });

  it("STACK_AUTO_NAME_PREFIX equals 'Stack'", () => {
    expect(STACK_AUTO_NAME_PREFIX).toBe("Stack");
  });

  it("COLLECTION_YAML_KEYS exposes every required key", () => {
    // The `as const` assertion enforces compile-time literal-narrowing;
    // these runtime checks guard against accidental key deletion.
    expect(COLLECTION_YAML_KEYS.schemaVersion).toBe("schemaVersion");
    expect(COLLECTION_YAML_KEYS.type).toBe("type");
    expect(COLLECTION_YAML_KEYS.displayName).toBe("displayName");
    expect(COLLECTION_YAML_KEYS.stackOrder).toBe("stackOrder");
    expect(COLLECTION_YAML_KEYS.order).toBe("order");
    expect(COLLECTION_YAML_KEYS.references).toBe("references");
    expect(COLLECTION_YAML_KEYS.icon).toBe("icon");
  });
});
