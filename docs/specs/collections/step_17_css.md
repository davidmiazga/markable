---
title: "Step 17 — CSS"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 17 — Collections Styling

## Goal

Style every Collections-specific DOM element introduced in steps 06, 07, 09, 10, 11 using **only** canonical tokens from `src/styles.css`. No new tokens, no hex values, no hardcoded pixel sizes for chrome (NFR-7). All visuals match frames 01–04 of the Figma at acceptable fidelity (DW-16 tracks any designer-iteration follow-ups).

## Files touched

- **New** `src/plugins/file-browser/collections/collections.css`
- **Edit** `src/plugins/file-browser/file-browser.css` — add one `@import "collections/collections.css";` line
- **New** `tests/collections/css.test.ts`

## Selector catalog (canonical surface)

```css
/* Layout container (replaces the stub from step 05) */
.fv-collection-stub { ... }                      /* removed in step 12 */

/* Breadcrumb (step 07) */
.fv-collection-breadcrumb { ... }
.fv-collection-breadcrumb-seg { ... }
.fv-collection-breadcrumb-seg.is-current { ... }
.fv-collection-breadcrumb-sep { ... }

/* Home canvas (step 06) */
.fv-collection-empty-state { ... }
.fv-collection-empty-state-button { ... }
.fv-collection-glyph-grid { ... }
.fv-collection-stack-glyph { ... }
.fv-collection-stack-glyph .folder-icon,
.fv-collection-stack-glyph [class^="folder-icon-"],
.fv-collection-stack-glyph .folder-icon-custom { ... }
.fv-collection-badge { ... }
.fv-collection-stack-label { ... }
.fv-collection-add-stack-affordance { ... }

/* + Notecard/Stack popover (step 06) */
.fv-collection-popover { ... }
.fv-collection-popover-item { ... }

/* Stack panel (step 10) */
.fv-collection-stack-panel { ... }
.fv-collection-stack-header { ... }
.fv-collection-stack-panel-title { ... }
.fv-collection-stack-list { ... }
.fv-collection-stack-add-note { ... }

/* Note box (step 09) */
.fv-collection-note-box { ... }
.fv-collection-note-box.is-reference { ... }
.fv-collection-note-box.is-broken { ... }
.fv-collection-note-box.is-editing { ... }
.fv-collection-note-box.is-reference::after { ... }   /* arrow glyph */
.fv-collection-note-box-label { ... }
.fv-collection-note-box-body { ... }
.fv-collection-note-box-body .cm-editor { ... }       /* inline editor host */
.fv-collection-note-box-rename-input { ... }
.fv-collection-note-box-rename-error { ... }

/* Inline editor (step 11) */
.fv-collection-inline-editor-host { ... }
.fv-collection-editor-host { ... }    /* hidden parent */
```

## Token contract

Every property uses a `var(--token-name)` referencing a token already defined in `src/styles.css`. Examples (verify exact token names during implementation against the canonical catalog in `feedback_theme_carries_through` memory):

- Backgrounds: `--bg-primary`, `--bg-secondary` (or whichever survived the May-2026 theme-system audit), `--bg-elevated`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Borders: `--border-default`, `--border-strong`
- Accent: `--accent-color`, `--accent-fg`
- Sizing: `--space-xs`, `--space-sm`, `--space-md`, `--space-lg`
- Radii: `--radius-sm`, `--radius-md`, `--radius-lg`
- Typography: `--font-size-sm`, `--font-size-md`, `--font-size-lg`, `--font-weight-bold`

Specific visual requirements:

- **Framed box**: 1 px solid `var(--border-default)`, `border-radius: var(--radius-md)`, padding `var(--space-md)`, hover `box-shadow: 0 1px 3px var(--shadow-color)` (defer if no `--shadow-color` token — use `transform: translateY(-1px)` instead).
- **Broken box**: `opacity: 0.5`, italic body text, no hover lift.
- **Reference glyph**: top-right corner pseudo-element with a 14×14 SVG arrow inlined via `mask-image: url("data:image/svg+xml,...")`. Background `var(--accent-color)`. Avoid a separate DOM node.
- **Badge**: positioned `top: 4px; right: 4px;` over the Stack glyph; pill-shaped with `background: var(--accent-color); color: var(--accent-fg); border-radius: 999px; padding: 0 var(--space-xs); font-size: var(--font-size-sm); font-weight: var(--font-weight-bold);`.
- **Empty state**: full-width dashed border `2px dashed var(--border-default)`, large minimum height, centered button.
- **Inline editor**: must respect `feedback_global_typography` — no font-family override on `.cm-editor` here.

## Failing tests to write FIRST

`tests/collections/css.test.ts` — pattern from `tests/folder-icons/css.test.ts`. Parse the CSS file as text and assert:

| Test name | EC / FR | Asserts |
|---|---|---|
| `every Collections selector exists in collections.css` | catalog completeness | grep each selector listed above |
| `no hex color literals (#xxx, #xxxxxx) in collections.css` | NFR-7 | regex `/#[0-9a-fA-F]{3,8}/` finds zero matches |
| `no rgb()/rgba() literals` | NFR-7 | regex finds zero matches |
| `no hardcoded px values for sizing chrome (except 1px borders, 14px badge SVG mask)` | NFR-7 | whitelist exact px usages |
| `every color/background/border/font-size uses a var(--token)` | NFR-7 | regex match for `:\s*var\(--` per declared property |
| `.fv-collection-note-box.is-reference::after exists` | FR-22 | string contains the selector |
| `file imported from file-browser.css` | wiring | file-browser.css contains `@import "collections/collections.css"` or equivalent |
| `--shadow-color OR transform fallback used (not raw rgba)` | NFR-7 | either `var(--shadow-color)` OR `transform:` present in hover state, not `rgba(` |

## Implementation outline

1. Run a token audit against `src/styles.css` before writing rules. Match the May-2026 theme-system catalog. Don't invent.
2. Build sections in the order listed above. Each section's first property defines its visual intent; subsequent properties refine.
3. **Reference arrow glyph**: encode a small SVG into `mask-image` (URL-encoded data URI). 14×14 viewbox, single-path arrow. The image bytes are inline in CSS — no new asset file.
4. **Box-sizing**: every Collections rule uses `box-sizing: border-box` explicitly, to dodge the historical row-collapse bugs (see project memory `project_bookshelf_css_patterns`).
5. **Editing-state visual**: when `.fv-collection-note-box.is-editing` is set (by the inline-editor on mount), hide the body's placeholder via `.fv-collection-note-box-body { display: none; }` — but ONLY when the editor is mounted. The inline editor's `mount()` sets `box.classList.add("is-editing")` (verify step 11 sets this; if not, add it here in the CSS step requirements).

## Refactor opportunities

If a hover-lift effect needs a new `--shadow-color` token, propose it via DW-16 (do NOT add it inline in this feature — token additions go through the theme-system contract).

## Definition of Done

```bash
npm run test:run -- tests/collections/css.test.ts
```
Expected: 8 tests pass. Visual inspection of frames 01–04 matches Figma at acceptable fidelity. Plugin rebuild required (only if any TS edit was made; CSS-only changes don't require it, but the import line in `file-browser.css` may flow through the build).
