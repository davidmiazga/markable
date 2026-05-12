---
title: "step_04 — Starter Template Update"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 04 — Starter Template Update

## Goal

Update `FOLDER_VIEW_STARTER` in `file-browser.plugin.ts` to replace the three
`# extra-fields:` comment lines with a `# fields:` comment block. All other
starter lines remain unchanged.

---

## File to Change

`src/plugins/file-browser/file-browser.plugin.ts`

---

## Precise Change

Locate the three-line block in `FOLDER_VIEW_STARTER` (around lines 3015-3018):

```typescript
  "# extra-fields:",
  "#   - status              # shows 'status' frontmatter as a column (header = 'Status')",
  "#   - status: My Status   # same field, custom column header",
  "# folder-table only — add any frontmatter key from child .md files",
```

Replace those four lines with:

```typescript
  "# fields:",
  "#   - name",
  "#   - type       # file extension column",
  "#   - modified",
  "#   - tags",
  "# uncomment to control which columns appear and in what order",
  "# add any frontmatter key as a custom column (folder-table only)",
```

The resulting `FOLDER_VIEW_STARTER` ends with:

```typescript
  "  # set files-title: Notes to show a heading above the Files section",
  "# fields:",
  "#   - name",
  "#   - type       # file extension column",
  "#   - modified",
  "#   - tags",
  "# uncomment to control which columns appear and in what order",
  "# add any frontmatter key as a custom column (folder-table only)",
  "---",
  "",
].join("\n");
```

---

## Why This Change

The `# extra-fields:` comment block described the old mechanism that is now
superseded by `# fields:`. Users who switch the layout to `folder-table` and
uncomment the block will immediately see the unified `fields:` syntax. The
old `extra-fields:` YAML key still works (parsed identically to today when
`fields:` is absent), but the starter no longer guides users toward it.

The comment `# folder-table only` is removed because the new comment lines
already make the scope clear ("folder-table only" is implied by the comment
block position, adjacent to the table-specific section title and show-count lines).

---

## Tests to Write / Update

No unit tests directly assert on `FOLDER_VIEW_STARTER` content. The starter
is a documentation/UX concern. If a snapshot test exists for the starter, update
it to match the new lines.

Check for any test that asserts on `FOLDER_VIEW_STARTER`:

```bash
grep -r "FOLDER_VIEW_STARTER\|extra-fields" tests/ --include="*.test.ts"
```

If any test asserts `extra-fields` lines exist in the starter, update those
assertions to match the new `fields:` lines.

---

## Verification

```bash
# Verify the starter string compiles (no syntax errors in the file).
npx tsc --noEmit

# Run full test suite to confirm no snapshot regressions.
npm run test:run
```

Manually verify by opening the app, right-clicking a folder in the file browser,
and choosing "Create Folder View". The created `_folder.md` should contain the
new `# fields:` comment block instead of `# extra-fields:`.

---

## Edge Cases Addressed

- **EC-15** — `folder-cards` layout: the starter defaults to `type: folder-cards`.
  The `# fields:` block is a comment; it will not affect folder-cards rendering
  because `fields:` is a comment and will not be parsed. No functional change to
  folder-cards users.
- **FR-19** — Starter update matches the exact text specified in FR-19.
