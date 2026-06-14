---
title: "Step 02 — CSS Rules for Folder Icons"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 02 — CSS Rules for Folder Icons

## Goal

For every catalog id from step_01, add a CSS rule selector
`.folder-icon-<id>` that styles the inline SVG glyph using **canonical
theme tokens only** (NFR-7 / project memory `project_theme_system`).

**Amendment 2026-06-05.** Also add a single `.folder-icon-custom`
rule. This is the parent class applied to nodes whose `icon:` value
resolves to `kind: "custom"` (step_01 amendment). The renderer
post-mount pass (step_05 §C2) replaces the slot's `innerHTML` with
sanitised inline SVG content, so the rule only sets sizing/colour;
the actual SVG ships with the file.

## Inputs

- Requirements: FR-3, NFR-7, NFR-1.
- Constraint: C-6 (CSS class naming mirrors `vault-icon-*`).
- Project memory: `feedback_theme_carries_through`,
  `project_theme_system` — all colors come from the canonical token
  catalog in `src/styles.css`. **No hardcoded hex.**
- Project memory: `feedback_look_first` — before writing CSS, grep for
  an existing pattern. The `vault-icon-*` family at the same level is
  the exact analogue.

## Files

| Action | File |
|---|---|
| Edit | `src/styles.css` (or co-located `src/plugins/file-browser/folder-icons.css` imported by `file-browser.css` — Developer's call, but co-located is preferred per requirements doc) |
| Create (if separate file path is chosen) | `src/plugins/file-browser/folder-icons.css` |

## Where to insert

Search `src/styles.css` (or `file-browser.css`) for the existing rule:

```css
.vault-icon svg, .folder-icon svg, .file-icon svg, ... { display: block; fill: currentColor; }
```

Add a sibling block immediately below it:

```css
/* Folder-icon variants — one rule per FOLDER_ICONS entry.
   Selector convention mirrors vault-icon-* (step_02 of folder-icon-assignment).
   Colors inherit currentColor from the parent .tree-node-icon so the active
   theme drives them. No hardcoded colors. */
.folder-icon-folder svg,
.folder-icon-folder-open svg,
.folder-icon-book svg,
.folder-icon-bookshelf svg,
.folder-icon-notebook svg,
.folder-icon-lightbulb svg,
.folder-icon-target svg,
.folder-icon-calendar svg,
.folder-icon-inbox svg,
.folder-icon-archive svg,
.folder-icon-code svg,
.folder-icon-terminal svg,
.folder-icon-database svg,
.folder-icon-image svg,
.folder-icon-film svg,
.folder-icon-music svg,
.folder-icon-pencil svg,
.folder-icon-tag svg,
.folder-icon-flag svg,
.folder-icon-star svg,
.folder-icon-heart svg,
.folder-icon-clipboard svg,
.folder-icon-briefcase svg,
.folder-icon-house svg,
/* AMENDMENT 2026-06-05 — parent class for user-supplied custom SVGs.
   The renderer injects the file's inline SVG into the slot at runtime
   (step_05 §C2), so the rule only needs to size/colour the svg child. */
.folder-icon-custom svg {
  display: block;
  fill: currentColor;
}

/* Sizing safety net for inline-injected custom SVGs. The cached SVG
   may carry its own width/height attributes; force it to the
   tree-node icon slot's dimensions so a 512×512 source still paints
   at 16×16. */
.folder-icon-custom svg {
  width: 100%;
  height: 100%;
}
```

**The rule deliberately delegates color to `currentColor`** so the
existing tree-node-icon color tokens (already defined by the theme)
carry through unchanged. Per project memory: do NOT add per-icon color
declarations.

If a specific icon variant needs a subtle tint (e.g. `star` accent) in
the future, that's deferred work (DW-3 in `00_index.md`) and must NOT
be added in this step.

## Failing test (write FIRST — Red)

```typescript
// tests/folder-icons/css.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FOLDER_ICONS } from "../../src/plugins/file-browser/folder-icons";

describe("folder-icons CSS (step_02)", () => {
  it("every catalog id has a matching .folder-icon-<id> CSS rule (FR-3)", () => {
    // Read both candidate stylesheet locations.
    const candidates = [
      resolve(__dirname, "../../src/styles.css"),
      resolve(__dirname, "../../src/plugins/file-browser/file-browser.css"),
      resolve(__dirname, "../../src/plugins/file-browser/folder-icons.css"),
    ];
    let combined = "";
    for (const p of candidates) {
      try {
        combined += readFileSync(p, "utf8");
      } catch { /* file may not exist — that's fine */ }
    }

    for (const def of FOLDER_ICONS) {
      const selector = `.folder-icon-${def.id} svg`;
      expect(combined.includes(selector)).toBe(true);
    }
    // Amendment 2026-06-05 — also assert the .folder-icon-custom rule
    // exists for user-supplied SVGs (step_05 §C2).
    expect(combined.includes(".folder-icon-custom svg")).toBe(true);
  });

  it("no hardcoded hex colors appear in any folder-icon-* rule (NFR-7)", () => {
    const candidates = [
      resolve(__dirname, "../../src/plugins/file-browser/file-browser.css"),
      resolve(__dirname, "../../src/plugins/file-browser/folder-icons.css"),
    ];
    for (const p of candidates) {
      let css = "";
      try { css = readFileSync(p, "utf8"); } catch { continue; }
      // Crude but effective: find any block whose selector contains
      // .folder-icon- and assert no `#xxxxxx` literal inside it.
      const blocks = css.match(/\.folder-icon-[^{]+\{[^}]*\}/g) ?? [];
      for (const block of blocks) {
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      }
    }
  });
});
```

## Green

Add the CSS block exactly as described above. Use `currentColor`. Do
not introduce any new tokens.

## Refactor

- Group the selectors into one rule using comma-separated selectors
  (as shown). This keeps the diff minimal and keeps CSS specificity
  consistent across the family.
- If `file-browser.css` already has a `Folder/file icons` section,
  insert the new rule inside that section. Otherwise, add a small
  comment header above the new rule.

## Definition of Done

- [ ] `tests/folder-icons/css.test.ts` passes.
- [ ] `npm run test:run -- tests/folder-icons/css.test.ts` exits 0.
- [ ] Manual smoke: load the app, no visual change yet (icons aren't
      wired through the renderer until step_05).
- [ ] No window-size test regression
      (`npm run test:run -- tests/settings/window-defaults.test.ts`).
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8) — only
      strictly required when `src/plugins/**/*.ts` changes, but run it
      defensively if `file-browser.css` was edited inside that tree.
