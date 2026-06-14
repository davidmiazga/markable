/**
 * tests/folder-icons/catalog.test.ts — step_01
 *
 * Asserts:
 *   - FOLDER_ICONS catalog shape and uniqueness (FR-3).
 *   - getFolderIconClass() default fallback contract (NFR-1, EC-1, EC-3, EC-5).
 *   - interpretIconValue() precedence per FR-12 / EC-23:
 *       1. catalog hit
 *       2. custom-SVG path (contains `/` or `\` or ends `.svg`)
 *       3. fallback
 *
 * Pure module — no DOM, no I/O, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  FOLDER_ICONS,
  getFolderIconClass,
  interpretIconValue,
} from "../../src/plugins/file-browser/folder-icons";

describe("folder-icons catalog (step_01)", () => {
  it("FOLDER_ICONS has at least 20 curated entries (FR-3)", () => {
    expect(FOLDER_ICONS.length).toBeGreaterThanOrEqual(20);
  });

  it("every entry has lowercase-kebab-case id, non-empty label, non-empty svg", () => {
    for (const def of FOLDER_ICONS) {
      expect(def.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.svg.length).toBeGreaterThan(0);
    }
  });

  it("ids are unique", () => {
    const ids = FOLDER_ICONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getFolderIconClass (step_01)", () => {
  it("returns 'folder-icon' for undefined (EC-1)", () => {
    expect(getFolderIconClass(undefined)).toBe("folder-icon");
  });

  it("returns 'folder-icon' for empty string (EC-5)", () => {
    expect(getFolderIconClass("")).toBe("folder-icon");
  });

  it("returns 'folder-icon' for unrecognised id (EC-3)", () => {
    expect(getFolderIconClass("nonsense")).toBe("folder-icon");
  });

  it("returns 'folder-icon' for a bare filename without separator / .svg (EC-4)", () => {
    // EC-4 contract: a value like `cover.png` is the cover-image consumer's
    // value, not a tree icon. The path heuristic only triggers on `/`, `\`,
    // or `.svg` suffix — bare `cover.png` has none of those, so it falls
    // through to the unrecognised-slug branch and returns the generic class.
    expect(getFolderIconClass("cover.png")).toBe("folder-icon");
  });

  it("returns 'folder-icon-<id>' for every catalog id", () => {
    for (const def of FOLDER_ICONS) {
      expect(getFolderIconClass(def.id)).toBe(`folder-icon-${def.id}`);
    }
  });
});

describe("interpretIconValue (step_01, FR-12 / EC-23 amendment)", () => {
  it("EC-23 precedence #1 — catalog hit beats path heuristic", () => {
    const r = interpretIconValue("book");
    expect(r.kind).toBe("catalog");
    if (r.kind === "catalog") {
      expect(r.id).toBe("book");
      expect(r.cssClass).toBe("folder-icon-book");
    }
  });

  it("EC-23 precedence #2 — value with `/` and `.svg` → custom", () => {
    const r = interpretIconValue("/Users/dave/my.svg");
    expect(r.kind).toBe("custom");
    if (r.kind === "custom") {
      expect(r.path).toBe("/Users/dave/my.svg");
      expect(r.cssClass).toBe("folder-icon-custom");
    }
  });

  it("EC-23 — value ending in .svg without separator still → custom", () => {
    const r = interpretIconValue("just-a-name.svg");
    expect(r.kind).toBe("custom");
  });

  it("EC-23 — Windows path with backslash → custom", () => {
    // Each `\\` in a TS string literal represents a single backslash byte at
    // runtime; the heuristic in folder-icons.ts looks for the raw `\` char.
    const r = interpretIconValue("C:\\Users\\dave\\my.svg");
    expect(r.kind).toBe("custom");
  });

  it("EC-23 precedence #3 — unrecognised non-path slug → fallback", () => {
    const r = interpretIconValue("nonsense");
    expect(r.kind).toBe("fallback");
    expect(r.cssClass).toBe("folder-icon");
  });

  it("EC-23 — empty value → fallback", () => {
    expect(interpretIconValue("").kind).toBe("fallback");
    expect(interpretIconValue(undefined).kind).toBe("fallback");
  });

  it("path heuristic is case-insensitive on .svg suffix", () => {
    expect(interpretIconValue("/a/B.SVG").kind).toBe("custom");
    expect(interpretIconValue("/a/c.Svg").kind).toBe("custom");
  });

  it("a value with `/` but NOT ending in .svg is still routed to custom (read fails downstream → fallback)", () => {
    // ./art.jpg contains `/` → custom kind. The render path then attempts
    // to read it as SVG, fails the SVG sniff check, and the tree falls back
    // to the generic glyph (covered by tests/folder-icons/custom-render.test.ts
    // in step_05). At the catalog layer we only assert the discrimination.
    expect(interpretIconValue("./art.jpg").kind).toBe("custom");
  });
});
