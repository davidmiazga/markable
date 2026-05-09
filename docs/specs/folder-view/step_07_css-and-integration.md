---
title: "Folder View — Step 07: CSS, Integration, and Final Build"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 07 — CSS, Integration, and Final Build

**Goal**: Append `FOLDER_VIEW_CSS` to `FILE_BROWSER_CSS`, run the full build and sync, verify all FRs and ECs are satisfied through a complete integration test pass, and update `docs/specs/folder-view/00_index.md` to `status: reference`.

**Files created**: none.

**Files modified**:
- `src/plugins/file-browser/file-browser.plugin.ts`
- `docs/specs/folder-view/00_index.md` (status update only)

---

## Detailed Tasks

### 1. Append `FOLDER_VIEW_CSS` to `FILE_BROWSER_CSS`

In `file-browser.plugin.ts`, add the following import near the other folder-view imports:

```typescript
import { FOLDER_VIEW_CSS } from "./folder-view/folder-view.css";
```

Then update the `FILE_BROWSER_CSS` constant to append the folder-view CSS at the end. The simplest approach is to compute it lazily when `injectFileBrowserCSS` is called, or to concatenate at module load time.

**Preferred approach** (follows the existing pattern — string constant concatenated at declaration time):

Change the declaration:

```typescript
const FILE_BROWSER_CSS = `
  ... existing CSS ...
` + FOLDER_VIEW_CSS;
```

This keeps the injection path unchanged: `injectFileBrowserCSS()` injects `FILE_BROWSER_CSS` exactly as before. No new `<style>` tag is created.

### 2. Run the full build

```bash
npm run build:plugins && npm run sync:plugins
```

Fix any TypeScript compilation errors before proceeding.

### 3. Run all folder-view tests

```bash
npm run test:run -- tests/folder-view/
```

All tests added in steps 01–06 must pass. Fix any failures before proceeding to the integration checklist.

### 4. Run the full test suite

```bash
npm run test:run
```

No regressions in existing tests. Fix any test failures. Pay special attention to:
- `tests/file-browser/` — the split-click changes must not break existing file-browser tests.
- `tests/settings/window-defaults.test.ts` — invariant must still pass.

### 5. Integration test checklist

Work through each item in the app with `npm run tauri dev`. Check each box:

**Area 1 — File Browser Interaction**

- [ ] Directory WITHOUT `_folder.md`: clicking folder name or chevron toggles expansion (FR-01 regression).
- [ ] Directory WITH `_folder.md`: clicking chevron only → expands/collapses, no tab opens (FR-02/FR-03).
- [ ] Directory WITH `_folder.md`: clicking folder name label → Folder View tab opens (FR-02).
- [ ] Press Enter on a `_folder.md`-enhanced folder → Folder View tab opens (FR-04).
- [ ] Press ArrowRight / ArrowLeft on a `_folder.md`-enhanced folder → expand/collapse without opening tab (NFR-05).
- [ ] The `_folder.md` file appears in the tree as a normal file; clicking it opens it in the editor (FR-08/EC-20).
- [ ] Directory with `_folder.md` shows `tree-node-has-folder-view` class on the `<li>` (FR-07, verify in DevTools).

**Area 2 — `_folder.md` Visibility and Editability**

- [ ] Rename `_folder.md` to something else → on next index refresh, the folder loses Folder View behavior (FR-09/EC-03).
- [ ] Delete `_folder.md` → Folder View tab for that folder remains open but the directory reverts to normal click behavior (EC-02).

**Area 3 — YAML Schema**

- [ ] `layout: folder-cards` → card grid renders (FR-10).
- [ ] `title: Custom Name` → tab title shows "Custom Name" (FR-16).
- [ ] `columns: 5` → 5-column grid (FR-10/EC-11).
- [ ] `columns: 0` → clamped to 2 columns (EC-11).
- [ ] `columns: 100` → clamped to 6 columns (EC-11).
- [ ] `sort: name-desc` → cards sorted Z→A (FR-10/FR-20).
- [ ] `sort: invalid` → defaults to A→Z (EC-12).
- [ ] `show-modified: false` → no dates on cards (FR-10).
- [ ] No `layout:` field → fallback notice (FR-12/EC-04).
- [ ] `layout: unknown-thing` → fallback notice with layout name (FR-13).
- [ ] Empty file or only body text (no `---`) → fallback notice (EC-04).
- [ ] Malformed YAML (e.g. tab character in value) → no crash; fallback or partial parse (EC-05/NFR-06).

**Area 4 — Card Grid**

- [ ] Subfolder cards appear before file cards (FR-18).
- [ ] `_folder.md` is NOT shown as a card (FR-23).
- [ ] Subfolder card click: expands tree AND opens Folder View if subfolder has `_folder.md` (FR-21/EC-09).
- [ ] Subfolder card click: only expands tree when subfolder has no `_folder.md` (EC-10).
- [ ] File card click: `.md` file → opens in editor (FR-22).
- [ ] File card click: `.png` file → opens in media viewer (FR-22).
- [ ] Description block from `_folder.md` body renders above grid (FR-24/FR-11).
- [ ] No description block when body is empty (FR-11).
- [ ] Empty folder (only `_folder.md`) → "This folder is empty." (FR-26/EC-06).
- [ ] Folder with only non-MD files → file section only (EC-07).
- [ ] Folder with only subdirectories → subfolder section only (EC-08).

**Area 5 — Tab Deduplication**

- [ ] Click the same folder name twice → only one tab (FR-17).
- [ ] Two folders named "Reports" in different paths → two independent tabs (EC-15/FR-17).
- [ ] Tab title shows folder name (or YAML `title:` value) — not the synthetic key (FR-16).

**Area 6 — Live Update**

- [ ] Edit and save `_folder.md` while Folder View tab is active → tab re-renders with new content (FR-31/EC-17).
- [ ] Edit and save `_folder.md` while Folder View tab is inactive → switch to tab → re-renders (FR-32/EC-18).

**Area 7 — Context Menu**

- [ ] Right-click folder WITH `_folder.md` → "Open Folder View" is the first item (FR-34).
- [ ] Right-click folder WITHOUT `_folder.md` → "Create Folder View…" is between "New Note" and "New Folder" (FR-35).
- [ ] "Create Folder View…" creates `_folder.md` with `---\nlayout: folder-cards\n---` and opens it in the editor (FR-35/FR-36).
- [ ] Right-click Smart Folder → no folder-view items (EC-24).
- [ ] EC-16: Right-click "Create Folder View…" on a folder that somehow already has `_folder.md` (race condition test — manually create `_folder.md` via Finder, then right-click before the index updates) → file opens in editor instead of creating a duplicate.

**Accessibility (NFR-07)**

- [ ] All cards have `role="button"` (verify in DevTools accessibility tree).
- [ ] All cards have `aria-label` (verify in DevTools).
- [ ] Tab key navigates between cards in the grid (in-app keyboard test).
- [ ] Enter key activates the focused card.

**Performance (NFR-01/NFR-02)**

- [ ] File browser renders in under 50ms for a 1,000-file vault (verify with performance.now() log or DevTools Performance panel).
- [ ] Folder View card grid renders in under 100ms for a folder with 100 direct children (verify with console.time in renderFolderCards if needed during testing).

**XSS prevention (EC-13/EC-14)**

- [ ] Create a folder named `<script>alert(1)</script>` → tab title shows escaped HTML, no alert fires.
- [ ] Create `_folder.md` with `<script>alert(1)</script>` in the body → description block renders without executing the script.

### 6. Update `00_index.md` status

Change `status: active` to `status: reference` in `docs/specs/folder-view/00_index.md` frontmatter.

---

## Acceptance Criteria

### All previous step tests must still pass

```bash
npm run test:run -- tests/folder-view/
npm run test:run
```

### No TypeScript compilation errors

```bash
npx tsc --noEmit
```

### Build succeeds

```bash
npm run build:plugins && npm run sync:plugins
```

### Integration checklist complete

All items in Section 5 above checked off. Any item not fully testable in the current environment must be justified in a comment in `00_index.md` under a "Known Limitations" section.

### Known Limitations (document in `00_index.md`)

- **EC-19**: Switching vaults while a Folder View tab is open leaves stale content in the tab. The tab is not forcibly closed. This is acceptable v1 behavior; the user can close the tab manually or re-open the folder after switching.
- **Tab strip title during async load**: Between `openCustomRenderTab` being called and `renderFolderViewTabAsync` completing, the tab strip may briefly show the synthetic key `__fv__:/path`. This is typically sub-100ms and not user-visible in practice.
