---
title: "Step 01 — Folder Icon Catalog + Resolver"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 01 — Folder Icon Catalog + Resolver

## Goal

Introduce the single source of truth for folder-icon identifiers,
labels, and SVG glyphs. Provide a pure, side-effect-free resolver
function `getFolderIconClass(iconValue)` that mirrors the existing
`getVaultIconClass()` in `file-tree.ts`, plus a discriminating
`interpretIconValue(value)` that distinguishes catalog hits from
custom-SVG paths (FR-12 / EC-23).

No DOM, no I/O, no Tauri, no Vault state. This step is end-to-end
testable in Vitest with zero mocks.

**Amendment 2026-06-05.** The resolver now disambiguates THREE kinds
of input value (FR-12):

1. **catalog hit** — value matches a known `id` in `FOLDER_ICONS` →
   `kind: "catalog"`, cssClass `folder-icon-<id>`.
2. **custom-SVG path** — value contains `/`, `\`, or ends in
   `.svg` (case-insensitive) → `kind: "custom"`, cssClass
   `folder-icon-custom`, payload = the path.
3. **fallback** — anything else (`undefined`, `""`, unrecognised
   slug) → `kind: "fallback"`, cssClass `folder-icon`.

Precedence order is strict (catalog beats path heuristic). Catalog
iconIds are kebab-case slugs by convention (`book`, `lightbulb`,
`folder-open`) — they never contain `/`, `\`, or `.svg`, so catalog
and path heuristics never collide.

## Inputs

- Requirements: FR-3, FR-4, FR-5, FR-12, EC-3, EC-5, EC-23, NFR-1.
- Precedent: `src/plugins/file-browser/file-tree.ts:81-108`
  (`getVaultIconClass()` + `ICON_MAP`).
- Constraint: C-1 (single catalog source of truth), C-2 (default
  fallback string is **literally** `"folder-icon"`, no rename).

## Files

| Action | File |
|---|---|
| Create | `src/plugins/file-browser/folder-icons.ts` |
| Create | `tests/folder-icons/catalog.test.ts` |

## API Contract

```typescript
// src/plugins/file-browser/folder-icons.ts

export interface FolderIconDef {
  /**
   * Stable identifier persisted in _folder.md. Lowercase kebab-case.
   * Maps 1:1 to a CSS class `folder-icon-<id>` (step_02).
   */
  readonly id: string;
  /** User-facing label shown as a tooltip in the picker (step_06). */
  readonly label: string;
  /**
   * Raw SVG markup, e.g. `<path d="..."/>`. Does NOT include the
   * outer <svg> tag — caller wraps it via wrapSvg() at render time
   * so size and viewBox are caller-controlled.
   */
  readonly svg: string;
}

/**
 * The curated catalog of folder icons available for assignment.
 *
 * Ordering here is the order shown in the picker grid (step_06).
 * Adding a new entry requires:
 *   1. Adding a row here.
 *   2. Adding a matching .folder-icon-<id> CSS rule (step_02).
 *
 * Anything else in the codebase reads through this constant.
 */
export const FOLDER_ICONS: readonly FolderIconDef[] = [
  { id: "folder",      label: "Folder",        svg: "<path .../>" },
  { id: "folder-open", label: "Folder (open)", svg: "<path .../>" },
  { id: "book",        label: "Book",          svg: "<path .../>" },
  // ... ~24 entries total
];

/**
 * Discriminated union describing how a raw `icon:` value resolves.
 * The renderer (step_05) switches on `kind`; the picker (step_06)
 * uses `kind` to decide between catalog-tile and custom-tile UI.
 */
export type IconValueKind =
  | { kind: "catalog";  id: string;   cssClass: string }                       // folder-icon-<id>
  | { kind: "custom";   path: string; cssClass: "folder-icon-custom" }
  | { kind: "fallback";               cssClass: "folder-icon" };

const ICON_MAP: Record<string, string> = Object.fromEntries(
  FOLDER_ICONS.map(def => [def.id, `folder-icon-${def.id}`]),
);

/**
 * Heuristic: does this value look like a file-system path to an SVG?
 * True if it contains a path separator OR ends with `.svg`. Pure.
 */
function looksLikePath(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  if (/\.svg$/i.test(value)) return true;
  return false;
}

/**
 * Discriminate the raw `icon:` string per FR-12 precedence:
 *   1. catalog hit
 *   2. custom-SVG path (contains `/`, `\`, or ends `.svg`)
 *   3. fallback
 *
 * Pure function; no I/O. Caller renders based on `kind`.
 */
export function interpretIconValue(value: string | undefined): IconValueKind {
  if (!value) return { kind: "fallback", cssClass: "folder-icon" };

  const catalogClass = ICON_MAP[value];
  if (catalogClass) {
    return { kind: "catalog", id: value, cssClass: catalogClass };
  }

  if (looksLikePath(value)) {
    return { kind: "custom", path: value, cssClass: "folder-icon-custom" };
  }

  return { kind: "fallback", cssClass: "folder-icon" };
}

/**
 * Resolve the CSS icon class for a directory tree node from a stored
 * icon value (typically read from _folder.md frontmatter).
 *
 * Convenience wrapper over `interpretIconValue` — returns just the
 * cssClass. Existing call sites (file-tree.ts:313 + :344) continue
 * to use this signature unchanged. New consumers that need the
 * full discriminated shape call `interpretIconValue` directly.
 *
 * Unknown, undefined, empty-string, or any non-catalog non-path value
 * returns the generic "folder-icon" class so the renderer is a pure
 * superset of today's behaviour (NFR-1).
 *
 * @param iconValue - The raw value from _folder.md `icon:` (may be undefined).
 * @returns A CSS class name. Default fallback: literally "folder-icon".
 */
export function getFolderIconClass(iconValue: string | undefined): string {
  return interpretIconValue(iconValue).cssClass;
}
```

> **Implementation note for SVG glyphs**: source from a permissively
> licensed icon set the project already bundles (e.g. the Material set
> already living under `src/plugins/file-browser/icons/material/`).
> Each glyph string is a single `<path>` or `<g>` block normalised to
> the 24×24 viewBox so the caller's `wrapSvg(content, 16)` produces a
> consistent pixel size. Do not introduce a new SVG dependency or new
> asset directory.

## Failing tests (write these FIRST — Red)

```typescript
// tests/folder-icons/catalog.test.ts
import { describe, it, expect } from "vitest";
import {
  FOLDER_ICONS,
  getFolderIconClass,
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
    const ids = FOLDER_ICONS.map(d => d.id);
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

  it("returns 'folder-icon' for an image-path-shaped value (EC-4 — bare filename, not absolute path)", () => {
    // EC-4: `cover.png` is the cover-image consumer's value, not a
    // tree icon. The amendment heuristic: contains `/` or `\` OR
    // ends `.svg`. `cover.png` and `./art.jpg` end neither in `.svg`
    // nor contain a separator (a bare basename), so they fall back.
    // NOTE: `./art.jpg` DOES contain `/` — but it doesn't end in
    // `.svg`, and the path-heuristic only routes svg-shaped values
    // to the custom kind. So `./art.jpg` → custom kind (path
    // resolution attempted) → file-not-readable at render → fallback
    // glyph. The TREE result is still `folder-icon`, just via a
    // different path. The catalog test asserts only the static
    // resolver behaviour; render-side fallback is tested in
    // tests/folder-icons/render.test.ts.
    expect(getFolderIconClass("cover.png")).toBe("folder-icon");
  });

  it("returns 'folder-icon-<id>' for every catalog id", () => {
    for (const def of FOLDER_ICONS) {
      expect(getFolderIconClass(def.id)).toBe(`folder-icon-${def.id}`);
    }
  });
});

describe("interpretIconValue (step_01, amendment 2026-06-05)", () => {
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
    const r = interpretIconValue("C:\\\\Users\\\\dave\\\\my.svg");
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

  it("a value that contains `/` but does NOT end in .svg is still custom (will fail readability check at render)", () => {
    // ./art.jpg — separator present, not .svg → the heuristic routes
    // it to custom, but render-side `getCustomSvg()` rejects it
    // (non-SVG content) and falls back. See custom-render.test.ts.
    expect(interpretIconValue("./art.jpg").kind).toBe("custom");
  });
});
```

## Green

Implement `folder-icons.ts` exactly as the API contract describes, with
the catalog populated from a permissive icon set already bundled in
`src/plugins/file-browser/icons/material/`. Each `def.svg` is the
contents of one of those SVG files **without** the outer `<svg>` tag.

## Refactor

- Lift the `ICON_MAP` Object.fromEntries call out of the function body
  to module scope so it's computed once. (Optional micro-perf; the
  function is called once per directory node per render, so the
  current shape is fine.)
- Confirm the catalog ordering is the visual ordering the picker will
  use (grouped by category: generic folders first, then content
  primitives, then productivity, then media).

## Definition of Done

- [ ] All tests in `tests/folder-icons/catalog.test.ts` pass.
- [ ] `npm run test:run -- tests/folder-icons/catalog.test.ts` exits 0.
- [ ] `getFolderIconClass(undefined)` returns the literal string
      `"folder-icon"` — confirmed by test, not just by inspection.
- [ ] No other file in the repo is modified by this step.
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).
