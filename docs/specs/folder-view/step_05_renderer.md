---
title: "Folder View — Step 05: Card Grid Renderer"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 05 — Card Grid Renderer

**Goal**: Implement the full `renderFolderCards` function for the `folder-cards` layout. Replace the placeholder in `tab.ts`. Ensure accessibility (NFR-07), correct sorting (FR-20), empty state (FR-26), description block (FR-24), and all edge cases.

**Files created**:
- `src/plugins/file-browser/folder-view/renderer.ts`
- `src/plugins/file-browser/folder-view/folder-view.css.ts`

**Files modified**:
- `src/plugins/file-browser/folder-view/tab.ts` (replace placeholder renderer)

---

## Detailed Tasks

### 1. Create `folder-view.css.ts`

This file exports a single string constant `FOLDER_VIEW_CSS`. The string contains all CSS for the folder-view feature. It will be appended to `FILE_BROWSER_CSS` in step_07.

CSS requirements (FR-25):
- All color values use CSS custom properties: `var(--bg-secondary)`, `var(--border-color)`, `var(--text-primary)`, `var(--text-secondary)`. No hard-coded colors.
- Card grid uses `display: grid` with `grid-template-columns: repeat(var(--fv-columns, 3), 1fr)`.
- `--fv-columns` is set inline on the grid container via `style="--fv-columns: N"`.

Required CSS classes and their purpose:

```
.folder-view-host         — full-width, full-height scrollable container
.folder-view-description  — description block (FR-24); styled for readability
.folder-view-section      — section wrapper (subfolders, files)
.folder-view-section-title — section heading label
.folder-view-grid         — the CSS grid container
.folder-view-card         — individual card (common base styles)
.folder-view-card-dir     — directory/subfolder card variant
.folder-view-card-file    — file card variant
.folder-view-card-icon    — card icon area (top of card)
.folder-view-card-name    — card name text
.folder-view-card-meta    — card meta line (extension badge, modified date)
.folder-view-card-ext     — file extension badge
.folder-view-card-date    — modified date text
.folder-view-empty        — empty state container
.folder-view-loading      — loading state container
.folder-view-fallback     — fallback layout container
.folder-view-fallback-notice — notice text in fallback
```

Card hover: `background: var(--hover-bg, rgba(128,128,128,.08))`.
Card focus-visible: `box-shadow: inset 0 0 0 2px var(--accent-color)`.
Cards are `cursor: pointer`.

### 2. Create `renderer.ts`

This file exports `renderFolderCards`.

#### 2a. Function signature

```typescript
export function renderFolderCards(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
): void
```

Length justification: this function is the central layout renderer. It handles two distinct sections (subfolders and files), each with their own DOM construction, click handlers, accessibility wiring, and sort logic. Splitting into sub-functions is done below; the top-level orchestrator is allowed to be ~40 lines.

#### 2b. Algorithm

1. Clear the container and create the host:
   ```typescript
   container.innerHTML = "";
   const host = document.createElement("div");
   host.className = "folder-view-host";
   ```

2. Render the description block if `config.body` is non-empty (FR-11/FR-24):
   ```typescript
   if (config.body.trim()) {
     const desc = document.createElement("div");
     desc.className = "folder-view-description";
     const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
       ((md: string) => string) | undefined;
     if (renderMd) {
       desc.innerHTML = stripScripts(renderMd(config.body)); // EC-14
     } else {
       desc.textContent = config.body;
     }
     host.appendChild(desc);
   }
   ```

3. Separate cards into subfolder and file sections:
   ```typescript
   const dirCards = cards.filter(c => c.kind === "directory");
   const fileCards = cards.filter(c => c.kind === "file");
   ```

4. Sort each section independently (FR-20):
   ```typescript
   sortCards(dirCards, config.sort);
   sortCards(fileCards, config.sort);
   ```

5. If both sections are empty: render empty state (FR-26):
   ```typescript
   if (dirCards.length === 0 && fileCards.length === 0) {
     const empty = document.createElement("div");
     empty.className = "folder-view-empty";
     empty.textContent = "This folder is empty.";
     host.appendChild(empty);
     container.appendChild(host);
     return;
   }
   ```

6. Render subfolder section if non-empty (FR-18):
   ```typescript
   if (dirCards.length > 0) {
     host.appendChild(buildSection("Folders", dirCards, config, folderPath));
   }
   ```

7. Render file section if non-empty (FR-18):
   ```typescript
   if (fileCards.length > 0) {
     host.appendChild(buildSection("Files", fileCards, config, folderPath));
   }
   ```

8. Append host to container.

#### 2c. `buildSection(title, cards, config, folderPath): HTMLElement`

Builds a section with a heading and a grid of cards.

```typescript
function buildSection(
  title: string,
  cards: FolderCard[],
  config: FolderViewConfig,
  folderPath: string,
): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-view-section";

  const heading = document.createElement("h3");
  heading.className = "folder-view-section-title";
  heading.textContent = title;
  section.appendChild(heading);

  const grid = document.createElement("div");
  grid.className = "folder-view-grid";
  grid.style.setProperty("--fv-columns", String(config.columns));
  grid.setAttribute("role", "list");

  for (const card of cards) {
    grid.appendChild(buildCard(card, config, folderPath));
  }

  section.appendChild(grid);
  return section;
}
```

#### 2d. `buildCard(card, config, folderPath): HTMLElement`

Builds one card element.

```typescript
function buildCard(
  card: FolderCard,
  config: FolderViewConfig,
  folderPath: string,
): HTMLElement {
  const el = document.createElement("div");
  el.className = `folder-view-card ${card.kind === "directory" ? "folder-view-card-dir" : "folder-view-card-file"}`;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", card.kind === "directory"
    ? `Open folder ${card.name}`
    : `Open file ${card.name}`
  ); // NFR-07

  // Icon area
  const iconEl = document.createElement("div");
  iconEl.className = "folder-view-card-icon";
  iconEl.innerHTML = card.kind === "directory"
    ? ICON_FOLDER  // from ../../icons/material/index — imported at top of renderer.ts
    : getFileIconForCard(card.ext);
  el.appendChild(iconEl);

  // Name
  const nameEl = document.createElement("div");
  nameEl.className = "folder-view-card-name";
  nameEl.textContent = card.name; // already sanitized (string, not HTML) — EC-13
  nameEl.title = card.path;
  el.appendChild(nameEl);

  // Meta (ext badge + modified date for files)
  if (card.kind === "file") {
    const meta = buildCardMeta(card, config.showModified);
    el.appendChild(meta);
  }

  // Click handler (FR-21/FR-22)
  el.addEventListener("click", () => handleCardClick(card, folderPath));

  // Keyboard: Enter activates (NFR-07)
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleCardClick(card, folderPath);
    }
  });

  return el;
}
```

#### 2e. `buildCardMeta(card, showModified): HTMLElement`

```typescript
function buildCardMeta(card: FolderCard, showModified: boolean): HTMLElement {
  const meta = document.createElement("div");
  meta.className = "folder-view-card-meta";

  if (card.ext) {
    const ext = document.createElement("span");
    ext.className = "folder-view-card-ext";
    ext.textContent = card.ext; // e.g. ".pdf"
    meta.appendChild(ext);
  }

  if (showModified && card.modified > 0) {
    const date = document.createElement("span");
    date.className = "folder-view-card-date";
    date.textContent = formatModified(card.modified);
    meta.appendChild(date);
  }

  return meta;
}
```

#### 2f. `handleCardClick(card, parentFolderPath): void`

```typescript
function handleCardClick(card: FolderCard, _parentFolderPath: string): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const fb = (window as any).__MARKABLE_FILE_BROWSER__;

  if (card.kind === "directory") {
    // FR-21: expand the file tree to this subfolder.
    fb?.expandDirectory?.(card.path);

    // FR-21: if the subfolder has _folder.md, open its Folder View tab.
    if (card.hasFolderView) {
      // openFolderViewTab is imported from ./tab.ts (circular-safe: tab.ts imports renderer.ts but renderer.ts must NOT import tab.ts — use the window global instead to break the cycle).
      const openFV = (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__;
      openFV?.(card.path);
    }
  } else {
    // FR-22: open in editor or media viewer.
    const lp = card.path.toLowerCase();
    if (lp.endsWith(".md") || lp.endsWith(".txt")) {
      void tabMgr?.openFileInTab?.(card.path);
    } else {
      void tabMgr?.openMediaInTab?.(card.path);
    }
  }
}
```

**Circular import note**: `renderer.ts` is imported by `tab.ts`. If `renderer.ts` imported `openFolderViewTab` from `tab.ts`, there would be a circular dependency. Use a window global instead: in step_04's `openEnable` hookup, register `window.__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFolderViewTab` alongside the other globals. Clean up in `onDisable`.

#### 2g. `sortCards(cards, sort): void`

```typescript
function sortCards(cards: FolderCard[], sort: FolderSortOrder): void {
  cards.sort((a, b) => {
    switch (sort) {
      case "name-desc": return b.name.localeCompare(a.name);
      case "modified-asc": return a.modified - b.modified;
      case "modified-desc": return b.modified - a.modified;
      case "name-asc":
      default: return a.name.localeCompare(b.name);
    }
  });
}
```

#### 2h. `formatModified(ms: number): string`

Format as `MMM D, YYYY` or relative (`Today`, `Yesterday`). Keep simple:
```typescript
function formatModified(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
```

#### 2i. `stripScripts(html: string): string`

Same implementation as in `fallback.ts`. Define once in a shared module. For now, duplicate it (the two files are the only callers) to avoid a new shared module that would complicate the IIFE bundle. Note the duplication in a comment.

#### 2j. `getFileIconForCard(ext: string): string`

Returns an SVG string. Reuse `fileIconFor` from `file-browser.plugin.ts` logic — but that function is not exported. Copy the mapping inline in `renderer.ts` as a local function. The icon constants (`ICON_FILE`, `ICON_FILE_MD`, etc.) must be imported from `../../icons/material/index`.

#### 2k. Replace placeholder in `tab.ts`

In `tab.ts`, replace the `renderFolderCardsPlaceholder` import with:

```typescript
import { renderFolderCards } from "./renderer";
// ...
const LAYOUT_RENDERERS: Record<string, FolderLayoutRenderer> = {
  "folder-cards": renderFolderCards,
};
```

#### 2l. Register `__MARKABLE_OPEN_FOLDER_VIEW_TAB__` global in `file-browser.plugin.ts`

In `onEnable`, after `openFolderViewTab` import is active, add:

```typescript
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFolderViewTab;
```

In `onDisable`, add:

```typescript
(window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = null;
```

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/renderer.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/renderer.test.ts`.

1. **FR-18 subfolder section**: Cards with `kind="directory"` appear in a section with heading "Folders".
2. **FR-18 file section**: Cards with `kind="file"` appear in a section with heading "Files".
3. **FR-18 order**: Subfolder section always renders before file section.
4. **FR-23**: Card with `path` ending in `_folder.md` is NOT in the grid (excluded by `collectChildren` in `tab.ts`, verified via full integration test).
5. **FR-20 sort name-asc**: Cards sorted alphabetically ascending by name.
6. **FR-20 sort name-desc**: Cards sorted alphabetically descending.
7. **FR-20 sort modified-desc**: Cards sorted by `modified` descending.
8. **FR-20 sort modified-asc**: Cards sorted by `modified` ascending.
9. **FR-26 empty state**: Zero cards → "This folder is empty." message rendered.
10. **EC-06**: No dir cards, no file cards → empty-state message.
11. **EC-07**: Dir cards empty, file cards non-empty → only file section rendered.
12. **EC-08**: Dir cards non-empty, file cards empty → only subfolder section rendered.
13. **FR-24 description**: `config.body = "Hello"` → `.folder-view-description` element present.
14. **FR-24 no description**: `config.body = ""` → no `.folder-view-description` element.
15. **EC-14 XSS in body**: `config.body` contains `<script>alert(1)</script>` → script tag not present in rendered HTML.
16. **EC-13 XSS in card name**: Card `name = "<script>"` → textContent is `"<script>"` (not HTML, set via `.textContent`).
17. **NFR-07 role=button**: Every card has `role="button"`.
18. **NFR-07 aria-label**: Every card has `aria-label` containing the card name.
19. **NFR-07 keyboard**: Press Enter on a file card → `openFileInTab` stub called.
20. **EC-22 performance guard**: Create 500 cards — render completes without O(N²) operations (verify no nested loops iterating cards × cards).
21. **EC-11 columns clamped**: `config.columns = 4` → `grid.style.getPropertyValue("--fv-columns") === "4"`.
22. **FR-10 show-modified: false**: No `.folder-view-card-date` elements rendered.
23. **FR-10 show-modified: true**: `.folder-view-card-date` elements present for files with `modified > 0`.

### Visual verification (after running `npm run build:plugins && npm run sync:plugins`)

1. Open a Folder View tab for a folder with subfolders and files → card grid renders with two sections.
2. `_folder.md` is NOT shown as a card.
3. Cards are sorted by `sort` field from front-matter.
4. `columns: 4` → 4-column grid.
5. Click a file card → file opens in editor.
6. Click a subfolder card → file tree expands to that subfolder.
7. Click a subfolder card that has `_folder.md` → its Folder View tab also opens (EC-09).
8. Click a subfolder card that does NOT have `_folder.md` → only tree expansion (EC-10).
9. `show-modified: false` → no dates on cards.
10. Empty folder (only `_folder.md`) → "This folder is empty." message.

**Run after this step**:
```
npm run build:plugins && npm run sync:plugins
```
