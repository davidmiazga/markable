# Properties Wrangler

Companion to File Properties (`yaml-pane`). The vocabulary editor is the **Edit tags** section at the bottom of the Properties sidebar. It is not a separate plugin or sidebar tab.

The definitions file is the existing vault file `VaultSettings/{vault}_properties.md` — not a second vocabulary. File Properties chip autocomplete already reads it via `window.__MARKABLE_META__`.

## v1 (shipped)

- Sidebar tree of tags and categories with carets for slash children, shown in File Properties → Edit tags
- Near-duplicates in red; gear picks the kept spelling (including capitalization)
- **Manage** in File Properties opens the vocabulary list immediately from the properties file and the vault. Drag-drop nesting, double-click to rename, shift-click a caret to expand or collapse every nested tag at that depth, right-click to search notes that include or exclude that tag or category (`tag:#name` / `-tag:#name` in the command bar), open a tag page (a note aliased to that tag), and a repeat button to consolidate. Merge picks definitions from a search list.
- Pointer drag-drop nesting in the sidebar and Manage (WKWebView does not fire HTML5 dragstart)
- Drop a tag/value on another in the same section to make `parent/child`; drop on the section header to promote to root
- Tags listed once (`tags:` field:value pairs are not a second Tags heading)
- Refresh `__MARKABLE_META__` after write

Rename (Edit → Apply) rewrites front-matter `tags:` / field values and inline `#tags`, including slash children.
Merge (Gear → Apply Merge) consolidates tags/categories into a target definition across YAML front-matter with no-undo confirmation, auto-detected near-dup prefilling, and special-character sanitization suggestions.

## Skip

- Smart Random Note hook
- Mass-delete without merge

## Markable-specific (keep)

- Near-dup clustering
- Category / `field:value` sections
- Properties `.md` as the File Properties definitions
