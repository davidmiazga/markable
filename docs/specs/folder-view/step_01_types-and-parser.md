---
title: "Folder View — Step 01: Types and Parser"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 01 — Types and Parser

**Goal**: Establish the type definitions for the folder-view feature and implement the `_folder.md` YAML/body parser.

**Files created**:
- `src/plugins/file-browser/folder-view/types.ts`
- `src/plugins/file-browser/folder-view/parser.ts`

**Files modified**: none.

---

## Detailed Tasks

### 1. Create the directory

Create `src/plugins/file-browser/folder-view/` as an empty directory. (It exists as a sibling to `smart-folders/`.)

### 2. Create `types.ts`

This file contains only TypeScript types — no runtime exports. It must compile cleanly with `isolatedModules: true`.

Define the following types:

```typescript
// ── Front-matter field types ──────────────────────────────────────────────────

/** Allowed sort order values for the card grid. */
export type FolderSortOrder = "name-asc" | "name-desc" | "modified-asc" | "modified-desc";

/**
 * Parsed YAML front-matter of a _folder.md file.
 *
 * All fields are optional at the parsing level; defaults are applied
 * in parseFolderMd() before returning the FolderViewConfig.
 */
export interface FolderMdFrontMatter {
  layout?: string;
  title?: string;
  sort?: string;
  columns?: number;
  "show-modified"?: boolean;
}

/**
 * Validated, defaulted configuration for one Folder View tab.
 * Produced by parseFolderMd(); consumed by the renderer.
 */
export interface FolderViewConfig {
  /** The layout identifier, lowercased. Empty string means absent/invalid. */
  layout: string;
  /** Display title for the tab. Defaults to folder's last path segment. */
  title: string;
  /** Sort order. Default: "name-asc". */
  sort: FolderSortOrder;
  /** Number of columns, clamped to [2, 6]. Default: 3. */
  columns: number;
  /** Whether to show modified date on file cards. Default: true. */
  showModified: boolean;
  /** Markdown body below the closing --- of the YAML block. May be empty string. */
  body: string;
}

// ── Card types ─────────────────────────────────────────────────────────────────

/** One entry in the rendered card grid (subfolder or file). */
export interface FolderCard {
  /** Absolute path of the entry. */
  path: string;
  /** Display name (filename without extension for .md files; basename for others). */
  name: string;
  /** "directory" or "file". */
  kind: "directory" | "file";
  /** File extension with leading dot (e.g. ".pdf"). Empty for directories. */
  ext: string;
  /** Last modified timestamp (Unix ms). 0 when unknown. */
  modified: number;
  /** True when this subfolder itself has _folder.md. Used by EC-09/FR-21. */
  hasFolderView?: boolean;
}

// ── Renderer interface ─────────────────────────────────────────────────────────

/**
 * Contract for a folder layout renderer.
 *
 * v1 registers exactly one: "folder-cards" → renderFolderCards.
 * Adding a new layout in a future task requires only adding one entry to the
 * LAYOUT_RENDERERS Record in tab.ts (FR-28).
 */
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
) => void;
```

### 3. Create `parser.ts`

This file exports one function: `parseFolderMd`. It must never throw (NFR-06). All error cases return a valid `FolderViewConfig` with an empty `layout` string, which triggers the FR-12 fallback.

```
parseFolderMd(content: string, folderName: string): FolderViewConfig
```

**Algorithm**:

1. Detect YAML front-matter: check if `content.trimStart()` begins with `---`. If not, return defaults with `layout: ""` and `body: content.trim()`.

2. Find the closing `---`. Split on `\n---\n` (or `\n---` at end-of-string). The first occurrence after the opening `---` is the end of the front-matter block. Extract the YAML lines between the two `---` markers. Extract the body: everything after the closing `---`.

3. Parse YAML lines using the same pattern as `layout-manager.ts`:
   - For each line: trim it. Skip empty lines and lines starting with `#`.
   - Split on the first `:`. Key = left part trimmed. Value = right part trimmed.
   - Remove surrounding quotes from value if present (both `'` and `"`).
   - Collect into a plain `Record<string, string>`.

4. Apply defaults and validation:
   - `layout`: `fm.layout?.trim().toLowerCase() ?? ""`
   - `title`: `fm.title?.trim() || folderName` (folderName = last segment of folder path, passed as parameter)
   - `sort`: validate against `["name-asc","name-desc","modified-asc","modified-desc"]`; default `"name-asc"` for any other value (EC-12)
   - `columns`: `parseInt(fm.columns ?? "3", 10)` → clamp to `[2, 6]` (EC-11); use 3 if NaN
   - `showModified`: `fm["show-modified"] !== "false"` (default true; only explicit `"false"` disables it)
   - `body`: the extracted body string, trimmed

5. Return the `FolderViewConfig` object.

**Implementation notes**:
- Wrap the entire function body in a `try/catch` that returns safe defaults. This is the EC-05 guard.
- Use a `const VALID_SORTS = new Set(["name-asc","name-desc","modified-asc","modified-desc"])` for the sort validation.
- The function must be ≤50 lines. If it grows beyond 40 lines, extract the YAML-line-parsing inner loop into a private helper `parseYamlLines(lines: string[]): Record<string, string>`.

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/parser.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/parser.test.ts`.

Write tests for the following cases (each as a separate `it` block):

1. **EC-04**: Empty content → `layout: ""`, `body: ""`, all defaults applied.
2. **EC-04**: Body-only content (no `---` markers) → `layout: ""`, `body` = the content.
3. **Minimal valid**: `---\nlayout: folder-cards\n---` → `layout: "folder-cards"`, defaults for all other fields.
4. **Full front-matter**: All five YAML fields present with non-default values → all parsed correctly.
5. **EC-11**: `columns: 0` → clamped to 2.
6. **EC-11**: `columns: 100` → clamped to 6.
7. **EC-11**: `columns: 4` → 4 (in range).
8. **EC-12**: `sort: invalid-value` → `"name-asc"`.
9. **show-modified: false** → `showModified: false`.
10. **show-modified: true** → `showModified: true`.
11. **show-modified absent** → `showModified: true` (default).
12. **EC-05**: Malformed YAML (e.g. `---\nlayout: "unclosed\n---`) → no throw; `layout` is empty or a partial parse; `body` is `""`.
13. **title field present**: `title: My Custom Title` → `config.title === "My Custom Title"`.
14. **title absent**: → `config.title === folderName` (the passed-in folder name).
15. **Body present**: YAML + body text → `body` = trimmed body text.
16. **YAML with unknown fields**: `unknown-field: some-value` → ignored, no crash.

### No visual verification needed for this step.

---

## Plugin build not required for this step.

`types.ts` and `parser.ts` are TypeScript modules that will be imported by later steps. They are not yet referenced by `file-browser.plugin.ts`. Running `npm run test:run` is sufficient to verify correctness.
