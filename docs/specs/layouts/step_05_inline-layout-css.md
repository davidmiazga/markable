---
title: "Step 05 — Inline Layout CSS: How to Style a New Inline Layout"
last-updated: "2026-05-14"
review-cadence-days: 30
status: reference
---

# Step 05 — Inline Layout CSS: How to Style a New Inline Layout

This document is the **canonical guide** for adding typography and layout-specific
CSS to any inline layout (Wikipedia, Notion Page, or any future `applies-to: single`
layout). It also explains why certain approaches that look correct will silently
fail.

---

## Background: Two kinds of layouts

| Kind | `applies-to` | `inline: true` in frontmatter | Rendered where |
|------|-------------|-------------------------------|----------------|
| **Panel layout** | `collection` | absent (false) | Non-editable HTML panel (`#custom-tab-host`) via `showLayoutView` |
| **Inline layout** | `single` | **required** | Lives inside the Typora editor (`#editor`) — fully editable |

Panel layouts render a Handlebars template into HTML and display it in the custom
tab host. Their CSS lives in the template `<style>` block and applies normally
because the output is real HTML.

Inline layouts are different. They never render a template into HTML. The user
edits the raw Markdown directly in Typora mode. The only thing the layout system
adds is:

1. An optional cover/icon header above the editor (`buildLayoutInlineExtension`).
2. Typography and structural CSS injected globally (`injectLayoutsCSS`), scoped
   to the active layout via a `data-inline-layout` attribute.

---

## Why template `<style>` blocks don't work for inline layouts

An inline layout's template body is never rendered into the DOM in Typora mode.
The template exists only so the layout can render in the panel view (via
`/layout` command). When the user edits the file in Typora mode, they see the
raw CM6 editor — not the rendered template.

Additionally, CM6 Typora mode **does not create real `<h1>`–`<h6>` elements**.
When the user types `# Heading`, CM6 decorates the line with a class and wraps
the text in `<span>` elements:

```
.cm-line.cm-live-h1 > span   ← the visible heading text lives here
.cm-line.cm-live-h2 > span
.cm-line.cm-live-h3 > span
...
.cm-live-h6 > span
```

A CSS rule like `.wiki-body h1 { font-family: Georgia }` can **never** match
these elements because there are no `h1` elements — only `span` elements inside
decorated `.cm-live-h1` lines.

---

## The `data-inline-layout` hook

`buildLayoutInlineExtension` (in `src/lib/layout-manager.ts`) sets a data
attribute on `#editor` whenever an inline layout is active:

```
#editor[data-inline-layout="wikipedia"]   ← Wikipedia is active
#editor[data-inline-layout="notion-page"] ← Notion Page is active
(attribute absent)                        ← no inline layout active
```

The stem is derived from the layout filename: `wikipedia.layout.md` → `"wikipedia"`,
`notion-page.layout.md` → `"notion-page"`.

The attribute is:
- Set when `buildLayoutInlineExtension` confirms `target.inline === true`.
- Cleared in both early-exit paths (no preview mode, no layout name, layout not
  found, layout is not inline).

This gives CSS a reliable, layout-specific scope.

---

## How to add CSS for a new inline layout

All inline layout CSS lives in `injectLayoutsCSS()` in
`src/lib/layout-manager.ts`. This function is called once at startup (idempotent
guard on `STYLE_ID`). Add your layout's rules inside the template-literal string.

### Selector pattern

```css
#editor[data-inline-layout="<stem>"] .cm-live-h1 span { /* h1 typography */ }
#editor[data-inline-layout="<stem>"] .cm-live-h2 span { /* h2 typography */ }
#editor[data-inline-layout="<stem>"] .cm-live-h2      { /* h2 structural (border, padding) */ }
#editor[data-inline-layout="<stem>"] .cm-content      { /* max-width, padding, font-size */ }
```

Key rules:
- **Heading text** → target `span` inside the `.cm-live-hN` line: `.cm-live-h1 span`
- **Heading structure** (border, margin, padding) → target the `.cm-live-hN` line directly
- **Content area** → target `.cm-content` (the CodeMirror content element)
- Always use `!important` on `padding` and `max-width` on `.cm-content` because
  the notion-layout-active rule already sets these with `!important`

### Wikipedia example (already implemented)

```css
/* ── Wikipedia layout: Typora-mode typography ── */
#editor[data-inline-layout="wikipedia"] .cm-live-h1 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h2 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h3 span,
#editor[data-inline-layout="wikipedia"] .cm-live-h4 span { font-family: Georgia, "Linux Libertine", "Times New Roman", serif; }
#editor[data-inline-layout="wikipedia"] .cm-live-h1 span { font-size: 1.95em; font-weight: normal; }
#editor[data-inline-layout="wikipedia"] .cm-live-h2 span { font-size: 1.5em; font-weight: normal; }
#editor[data-inline-layout="wikipedia"] .cm-live-h3 span { font-size: 1.2em; font-weight: bold; }
#editor[data-inline-layout="wikipedia"] .cm-live-h2 { border-bottom: 1px solid var(--border-color, #a2a9b1); padding-bottom: 3px; margin-bottom: 2px; }
#editor[data-inline-layout="wikipedia"] .cm-content { max-width: 980px !important; padding-left: 40px !important; padding-right: 40px !important; font-family: sans-serif; font-size: 14px; line-height: 1.6; }
```

---

## Checklist: adding a new inline layout

1. **Create the `.layout.md` file** in `STARTER_LAYOUTS` (or in `VaultSettings/layouts/`):
   - Frontmatter must include `inline: true` and `applies-to: single`.
   - Template body is used for panel rendering (Cmd-E) and `/layout` picker — it
     is not rendered in Typora mode.

2. **Add the layout-specific CSS** to `injectLayoutsCSS()`:
   - Scope all rules to `#editor[data-inline-layout="<stem>"]`.
   - Target `.cm-live-hN span` for heading typography.
   - Target `.cm-live-hN` (without `span`) for structural rules (border, padding).
   - Target `.cm-content` for content-area layout (max-width, padding, font).
   - Use `!important` on `.cm-content` padding and max-width to override the
     `.notion-layout-active .cm-content` rule.

3. **If the layout uses cover/icon**, the `buildLayoutInlineExtension` already handles
   these via `cover:` and `icon:` YAML fields. No additional code is needed.

4. **Add the layout to `LAYOUT_CONFIG_FIELDS`** if it has layout-specific YAML keys
   that should be commented/uncommented when switching layouts (e.g. `cover`, `icon`).

5. **Test the layout**:
   - Add `layout: <name>` to a `.md` file's YAML front matter.
   - Open the file → switch to Typora mode (Cmd-E) → verify typography applies.
   - Type headings → verify `.cm-live-h1 span` etc. receive the expected styles.
   - Switch to another layout → verify `data-inline-layout` clears and styles revert.
   - Open a panel layout (e.g. Bookshelf) → verify the editor is hidden and
     `data-inline-layout` is absent.

---

## Checklist: adding a new panel layout

Panel layouts are simpler — they render real HTML, so normal CSS works.

1. **Create the `.layout.md` file**:
   - Frontmatter: `applies-to: collection` (or `single` for per-file panel views).
   - Do NOT include `inline: true`.
   - Write Handlebars template in the body.
   - Include a `<style>` block in the template for layout-specific styles.

2. **Test**: Apply the layout from the picker → verify the panel renders correctly
   in `#custom-tab-host`.

Panel layouts do not need any changes to `buildLayoutInlineExtension` or
`injectLayoutsCSS`.

---

## All CM6 Typora heading classes

For reference, the full list of Typora-mode heading classes used by `live-preview.ts`:

| Markdown | CM6 class on the line | Text selector |
|----------|-----------------------|---------------|
| `# H1`   | `.cm-live-h1`         | `.cm-live-h1 span` |
| `## H2`  | `.cm-live-h2`         | `.cm-live-h2 span` |
| `### H3` | `.cm-live-h3`         | `.cm-live-h3 span` |
| `#### H4`| `.cm-live-h4`         | `.cm-live-h4 span` |
| `##### H5`| `.cm-live-h5`        | `.cm-live-h5 span` |
| `###### H6`| `.cm-live-h6`       | `.cm-live-h6 span` |

The `span` elements inside each line are the visible text nodes. They receive
the heading size/weight from `styles.css` (`.cm-live-h1 span { font-size: var(--heading-h1-size); }`).
Layout CSS overrides these by adding more-specific rules via the `data-inline-layout` scope.

---

## Code locations

| What | Where |
|------|-------|
| `buildLayoutInlineExtension` — sets `data-inline-layout` | `src/lib/layout-manager.ts` ~line 1048 |
| `injectLayoutsCSS` — all inline layout CSS | `src/lib/layout-manager.ts` ~line 1158 |
| `STARTER_LAYOUTS` — in-memory layout templates | `src/lib/layout-manager.ts` ~line 74 |
| `LAYOUT_CONFIG_FIELDS` — per-layout YAML key groups | `src/lib/layout-manager.ts` ~line 812 |
| `parseLayoutFrontmatter` — reads `inline: true` from frontmatter | `src/lib/layout-manager.ts` ~line 200 |
| CM6 Typora heading CSS | `src/styles.css` (`.cm-live-h1 span` etc.) |
