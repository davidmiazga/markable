# Properties Wrangler

Companion to File Properties (`yaml-pane`). Plugin id `properties-wrangler`, PKM pack, **default off**.

The offer list is the existing vault file `VaultSettings/{vault}_properties.md` — not a second vocabulary. File Properties chip autocomplete already reads it via `window.__MARKABLE_META__`.

## v1 (shipped)

- Scan the active vault when File Browser is on, or a chosen folder
- Split `scan_vault_tags` into tags vs `field:value` categories
- List used vs offered vs unused; checkbox writes the properties file
- Near-duplicate clusters (case, separator, short edit-distance); user accepts a canonical name
- Nested `parent/child` values shown as related, not merged
- Open the properties `.md` for hand edits
- Refresh `__MARKABLE_META__` after write

Does **not** rewrite tags inside notes.

## Adopt next (from Obsidian Tag Wrangler)

- Rename a tag (and slash-nested subtags), rewriting front-matter `tags:` and inline `#tags`
- Merge = rename onto an existing name, extra confirm, no-undo warning
- Search include / exclude the current tag in command-bar / find (`tag:#x` / `-tag:#x`)

## Later

- Context menu on inline `#tags` in the editor
- Tag pages (a note aliased to a tag)
- Drag-and-drop rename once a tag tree exists
- Expand / collapse same-level nested tags

## Skip

- Smart Random Note hook
- Mass-delete without merge

## Markable-specific (keep)

- Near-dup clustering
- Category / `field:value` sections
- Properties `.md` as the File Properties offer list
