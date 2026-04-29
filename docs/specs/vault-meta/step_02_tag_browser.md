---
title: step_02 — Tag Browser (⌘5 BarMode)
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Step 02 — Tag Browser (⌘5 BarMode)

## Goal

Add a `"tags"` mode to the Command Bar that lets users browse tags defined in the vault meta vocabulary alongside uncategorised tags found in the vault index. Users can expand a tag row to see which files use it, open a file from the expansion, and promote an uncategorised tag to the meta vocabulary with a single click.

This step touches only one file: `src/plugins/command-bar/command-bar.plugin.ts`.

Prerequisites: `window.__MARKABLE_META__` and `window.__MARKABLE_VAULT_MANAGER__` are set by `main.ts` (step_01 must be complete).

---

## Files to Change

| File | Change type |
|------|-------------|
| `src/plugins/command-bar/command-bar.plugin.ts` | **MODIFY** |

---

## 1. Extend `BarMode` Union

Current (line 67):
```typescript
export type BarMode = "files" | "commands" | "keybindings" | "content";
```

New:
```typescript
export type BarMode = "files" | "commands" | "keybindings" | "content" | "tags";
```

TypeScript will produce compile errors on every `Record<BarMode, string>` that is not yet updated. Fix all four before building.

---

## 2. Extend All Five Mode-Keyed Constants

### `MODE_PLACEHOLDERS` (current at line ~225)

Add `tags` entry:
```typescript
export const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  commands:    "Search commands…",
  files:       "Open file…",
  keybindings: "Search keybindings…",
  content:     "Search vault content…",
  tags:        "Filter tags…",               // NEW
};
```

### `MODE_FOOTER_HINTS` (current at line ~236)

```typescript
export const MODE_FOOTER_HINTS: Record<BarMode, string> = {
  commands:    "↑↓ navigate  ·  Enter to run  ·  Esc to close",
  files:       "↑↓ navigate  ·  Enter to open  ·  Esc to close",
  keybindings: "Enter to reassign  ·  Esc to close",
  content:     "Enter to search  ·  Esc to close",
  tags:        "Enter to open files  ·  Esc to close",   // NEW
};
```

### `MODE_BADGE_LABELS` (current at line ~246)

```typescript
export const MODE_BADGE_LABELS: Record<BarMode, string> = {
  commands:    "Commands",
  files:       "Files",
  keybindings: "Keys",
  content:     "Content",
  tags:        "Tags",    // NEW
};
```

### `MODE_TAB_SHORTCUTS` (current at line ~265)

```typescript
export const MODE_TAB_SHORTCUTS: Record<BarMode, string> = {
  commands:    "⌘1",
  files:       "⌘2",
  keybindings: "⌘3",
  content:     "⌘4",
  tags:        "⌘5",    // NEW
};
```

### `MODE_CYCLE` (current at line ~257)

```typescript
export const MODE_CYCLE: BarMode[] = ["commands", "files", "keybindings", "content", "tags"];
```

`"tags"` is appended after `"content"` so the cycle is: commands → files → keybindings → content → tags → commands.

---

## 3. Add ⌘5 Shortcut Handler

Locate where ⌘1–⌘4 shortcuts are registered. The existing pattern in the command-bar IIFE registers keyboard shortcuts in its `onEnable` or global key handler. Add ⌘5 following the exact same pattern as ⌘4.

Search for where `"⌘4"` or `"content"` mode is opened via keyboard — it will be something like:

```typescript
if (e.metaKey && e.key === "4") {
  e.preventDefault();
  openBar("content");
  return;
}
```

Add immediately after:

```typescript
if (e.metaKey && e.key === "5") {
  e.preventDefault();
  openBar("tags");
  return;
}
```

Also add `"tags"` to any keybinding registration object or list that declares ⌘1–⌘4 (so the keybindings panel shows ⌘5 as "Tag Browser").

---

## 4. Add Tags Mode Render Path in `filterAndRender()`

### 4.1 Add `_mode === "tags"` dispatch branch

In `filterAndRender()` (around line 3309), add a branch after the `if (_mode === "files")` guard and before the commands/keybindings pipeline:

```typescript
if (_mode === "tags") {
  renderTagsMode(query);
  return;
}
```

### 4.2 Handle tags mode in `openBar()` and `switchMode()`

In `openBar()` (around line 3381), within the already-open branch, add `"tags"` alongside the other cases that clear state. In the `switchMode()` function, handle `targetMode === "tags"` analogously to the `"content"` switch (clear input value, call `filterAndRender("")` to show the initial tag list, no async fetch needed).

In `closeBar()` (around line 3530), `_mode` resets to `"files"` — no change needed there.

---

## 5. Tag Data Helpers (module-level, private to command-bar.plugin.ts)

Add these helpers near the content-mode helpers, before `renderTagsMode`:

```typescript
// ---------------------------------------------------------------------------
// Tags mode — data helpers
// ---------------------------------------------------------------------------

/**
 * Shape of a tag row used internally by renderTagsMode.
 */
interface TagRow {
  tag: string;
  /** Files from vault index that carry this tag. */
  files: Array<{ path: string; title: string }>;
  /** True for tags defined in window.__MARKABLE_META__.tags. */
  defined: boolean;
}

/**
 * Build two sorted arrays of TagRow: defined and uncategorised.
 *
 * Reads data entirely from in-memory globals — no Tauri calls (NFR-2).
 *
 * @param query - Case-insensitive substring filter applied to tag names.
 * @returns { defined: TagRow[], uncategorised: TagRow[] }
 */
function buildTagRows(query: string): { defined: TagRow[]; uncategorised: TagRow[] } {
  const meta: Window["__MARKABLE_META__"] | undefined =
    (window as any).__MARKABLE_META__;
  const vm: Window["__MARKABLE_VAULT_MANAGER__"] | undefined =
    (window as any).__MARKABLE_VAULT_MANAGER__;

  const definedVocab: string[] = meta?.tags ?? [];
  const index = vm?.getVaultIndex?.() ?? null;

  // Build a map: tag → list of { path, title } from vault index.
  const tagFileMap = new Map<string, Array<{ path: string; title: string }>>();

  if (index) {
    for (const entry of index.entries) {
      for (const tag of entry.tags) {
        if (!tagFileMap.has(tag)) tagFileMap.set(tag, []);
        tagFileMap.get(tag)!.push({ path: entry.path, title: entry.title || entry.name });
      }
    }
  }

  const lowerQuery = query.toLowerCase();

  // Defined tags: from meta vocabulary, filtered by query.
  const defined: TagRow[] = definedVocab
    .filter((tag) => !lowerQuery || tag.toLowerCase().includes(lowerQuery))
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((tag) => ({
      tag,
      files: tagFileMap.get(tag) ?? [],
      defined: true,
    }));

  // Uncategorised: tags in vault index but NOT in meta vocabulary.
  const definedSet = new Set(definedVocab);
  const uncategorised: TagRow[] = [];
  for (const [tag, files] of tagFileMap) {
    if (!definedSet.has(tag) && (!lowerQuery || tag.toLowerCase().includes(lowerQuery))) {
      uncategorised.push({ tag, files, defined: false });
    }
  }
  uncategorised.sort((a, b) => a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()));

  return { defined, uncategorised };
}
```

---

## 6. `renderTagsMode(query)` — Full Implementation

```typescript
// ---------------------------------------------------------------------------
// Tags mode — renderer
// ---------------------------------------------------------------------------

/** Tracks which tag rows are currently expanded. Reset when bar opens. */
let _expandedTags = new Set<string>();

/**
 * Render the tags mode result area.
 *
 * Called by filterAndRender() when _mode === "tags".
 * Two sections: "DEFINED TAGS" and "UNCATEGORISED".
 * Four empty states (FR-7).
 *
 * @param query - Current input value (substring filter, case-insensitive).
 */
function renderTagsMode(query: string): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";

  const meta: any = (window as any).__MARKABLE_META__;
  const vm: any = (window as any).__MARKABLE_VAULT_MANAGER__;

  // EC-1: no vault open.
  if (!vm?.getActiveVault?.()) {
    _resultsEl.appendChild(buildTagsNotice(
      "No vault open — open a vault to browse tags"
    ));
    return;
  }

  const index = vm.getVaultIndex?.() ?? null;
  const { defined, uncategorised } = buildTagRows(query);

  // EC-15 / FR-7: nothing at all.
  if (defined.length === 0 && uncategorised.length === 0 && !query) {
    _resultsEl.appendChild(buildTagsNotice(
      "No tags found. Add tags: to a note's front matter to get started"
    ));
    return;
  }

  // Filter matches nothing.
  if (defined.length === 0 && uncategorised.length === 0 && query) {
    _resultsEl.appendChild(buildTagsNotice(`No tags match "${query}"`));
    return;
  }

  // EC-17: index still loading — show notice but still render defined tags.
  if (index === null && defined.length > 0) {
    const notice = buildTagsNotice("Index still loading — file counts may be incomplete");
    notice.classList.add("cb-content-notice--warning");
    _resultsEl.appendChild(notice);
  }

  // Section: DEFINED TAGS.
  if (defined.length > 0) {
    _resultsEl.appendChild(buildTagsSectionHeader("DEFINED TAGS"));
    for (const row of defined) {
      _resultsEl.appendChild(buildTagRow(row));
    }
  }

  // Section: UNCATEGORISED (omit entirely when empty — FR-6).
  if (uncategorised.length > 0) {
    _resultsEl.appendChild(buildTagsSectionHeader("UNCATEGORISED"));
    for (const row of uncategorised) {
      _resultsEl.appendChild(buildTagRow(row));
    }
  }
}

/** Build a text-only notice row for empty states. */
function buildTagsNotice(message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cb-content-notice";
  el.textContent = message;
  return el;
}

/** Build a section header element ("DEFINED TAGS" / "UNCATEGORISED"). */
function buildTagsSectionHeader(label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "cb-section-header";
  el.textContent = label;
  return el;
}

/**
 * Build a tag row element. Handles both defined and uncategorised rows.
 *
 * Clicking the row toggles inline expansion of the file list.
 * Uncategorised rows show an "Add to meta" button on hover (FR-8).
 * Clicking a file title opens the file and closes the bar.
 *
 * @param row - TagRow data.
 */
function buildTagRow(row: TagRow): HTMLElement {
  const isExpanded = _expandedTags.has(row.tag);

  const container = document.createElement("div");
  container.className = "cb-tag-row" + (isExpanded ? " cb-tag-row--expanded" : "");
  container.setAttribute("data-tag", row.tag);

  // ── Header line ────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "cb-tag-row-header";

  const chevron = document.createElement("span");
  chevron.className = "cb-tag-row-chevron";
  chevron.textContent = isExpanded ? "▾" : "▸";
  chevron.setAttribute("aria-hidden", "true");

  const tagName = document.createElement("span");
  tagName.className = "cb-tag-row-name";
  tagName.textContent = row.tag;

  const count = document.createElement("span");
  count.className = "cb-tag-row-count";
  count.textContent = `${row.files.length} file${row.files.length === 1 ? "" : "s"}`;

  header.appendChild(chevron);
  header.appendChild(tagName);
  header.appendChild(count);

  // "Add to meta" button — only on uncategorised rows (FR-8).
  if (!row.defined) {
    const addBtn = document.createElement("button");
    addBtn.className = "cb-tag-add-btn";
    addBtn.textContent = "Add to meta";
    addBtn.title = `Add "${row.tag}" to the tags vocabulary`;
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent row expansion toggle
      handleAddToMeta(row.tag);
    });
    header.appendChild(addBtn);
  }

  container.appendChild(header);

  // ── File list (expanded state) ─────────────────────────────────────────────
  if (isExpanded && row.files.length > 0) {
    const fileList = document.createElement("div");
    fileList.className = "cb-tag-files";
    for (const file of row.files) {
      const fileRow = document.createElement("div");
      fileRow.className = "cb-tag-file-row";
      fileRow.textContent = file.title;
      fileRow.title = file.path;
      fileRow.setAttribute("role", "button");
      fileRow.setAttribute("tabindex", "0");
      fileRow.addEventListener("click", () => {
        openFileFromTagBrowser(file.path);
      });
      fileRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openFileFromTagBrowser(file.path);
        }
      });
      fileList.appendChild(fileRow);
    }
    container.appendChild(fileList);
  } else if (isExpanded && row.files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cb-tag-files cb-tag-files--empty";
    empty.textContent = "No files with this tag";
    container.appendChild(empty);
  }

  // Toggle expansion on header click.
  header.addEventListener("click", () => {
    if (_expandedTags.has(row.tag)) {
      _expandedTags.delete(row.tag);
    } else {
      _expandedTags.add(row.tag);
    }
    // Re-render the tags view to reflect the new expansion state.
    if (_inputEl) renderTagsMode(_inputEl.value.trim());
  });

  return container;
}

/**
 * Open a file from the tag browser and close the bar.
 *
 * @param filePath - Absolute path to the file to open.
 */
function openFileFromTagBrowser(filePath: string): void {
  closeBar();
  const handleAction: ((action: string, payload?: unknown) => void) | undefined =
    (window as any).__MARKABLE_HANDLE_ACTION__;
  if (handleAction) {
    handleAction("open-file", { path: filePath });
  }
}
```

---

## 7. `handleAddToMeta(tag)` — "Add to meta" Action

```typescript
/**
 * Append `tag` to the vault tags meta file and update the in-memory store.
 *
 * Write-then-update pattern (AD-7):
 *  1. Build the new file content by appending the bullet item.
 *  2. Call writeFile(). On failure: log warning, emit toast if available, revert.
 *  3. On success: update window.__MARKABLE_META__.tags, re-render.
 *
 * EC-14: in-memory state is NOT updated until writeFile() confirms success.
 *
 * @param tag - The tag value to add (raw string, no escaping needed for bullet list).
 */
async function handleAddToMeta(tag: string): Promise<void> {
  const vm: any = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vault = vm?.getActiveVault?.();
  if (!vault) return;

  const meta: any = (window as any).__MARKABLE_META__;

  // Derive the meta file path using the same sanitise logic as meta-manager.ts.
  // (The command-bar IIFE cannot import ES modules, so the path is computed inline.)
  const safeName = vault.name.replace(/[/:\x00]/g, "_");
  const root = vault.rootPaths[0];
  const metaFilePath = `${root}/${safeName}_meta/${safeName}_tags.md`;

  // Build the new content: existing content + new bullet.
  // If the file does not exist yet (EC-2), start with the initial heading.
  let existingContent = "";
  const readResult = await (window as any).__TAURI_INTERNALS__?.invoke?.(
    "read_file", { path: metaFilePath }
  ).catch(() => null);

  if (typeof readResult === "string") {
    existingContent = readResult;
  } else {
    existingContent = "# Tags\n";
  }

  // Ensure no duplicate (defensive — tag browser should only show uncategorised).
  const currentTags: string[] = meta?.tags ?? [];
  if (currentTags.includes(tag)) {
    // Already in meta (race condition). Just re-render.
    if (_inputEl) renderTagsMode(_inputEl.value.trim());
    return;
  }

  const newContent = existingContent.trimEnd() + "\n- " + tag + "\n";

  // Invoke write_file directly via __TAURI_INTERNALS__ (IIFE cannot use bridge.ts).
  let writeOk = false;
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("write_file", {
      path: metaFilePath,
      content: newContent,
    });
    writeOk = true;
  } catch (err) {
    console.warn("[handleAddToMeta] write_file failed:", err);
  }

  if (!writeOk) {
    // EC-14: do NOT update in-memory state; tag stays in Uncategorised.
    return;
  }

  // Success: update in-memory meta store (AD-7).
  if ((window as any).__MARKABLE_META__) {
    (window as any).__MARKABLE_META__.tags = [...currentTags, tag];
  }

  // Re-render so the tag moves from Uncategorised to Defined.
  if (_inputEl) renderTagsMode(_inputEl.value.trim());
}
```

---

## 8. Reset `_expandedTags` on Bar Open and Close

In `openBar()`, at the point where the bar opens in tags mode, add:

```typescript
if (targetMode === "tags") {
  _expandedTags.clear();   // EC-16: start with all rows collapsed
  renderTagsMode("");
}
```

In `closeBar()`, also clear expanded state:

```typescript
_expandedTags.clear();
```

---

## 9. CSS Classes to Add

These go inside the existing `<style>` injection in the command-bar IIFE (or its CSS file if separate). All values use CSS variables only (NFR-3).

```css
/* Tag Browser ─────────────────────────────────────────────────── */

.cb-tag-row {
  padding: 0;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  user-select: none;
}

.cb-tag-row-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  color: var(--text-primary);
}

.cb-tag-row-header:hover {
  background: var(--bg-secondary);
}

.cb-tag-row-chevron {
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
  color: var(--text-secondary);
}

.cb-tag-row-name {
  flex: 1;
  font-size: 13px;
}

.cb-tag-row-count {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
  flex-shrink: 0;
}

/* "Add to meta" button — visible only on hover of the row */
.cb-tag-add-btn {
  display: none;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--accent-color);
  color: var(--accent-color);
  background: transparent;
  cursor: pointer;
  margin-left: 6px;
  flex-shrink: 0;
}

.cb-tag-row-header:hover .cb-tag-add-btn {
  display: inline-block;
}

.cb-tag-add-btn:hover {
  background: var(--accent-color);
  color: var(--bg-primary);
}

/* Expanded file list */
.cb-tag-files {
  padding: 0 12px 6px 28px;
}

.cb-tag-file-row {
  padding: 4px 0;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cb-tag-file-row:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

.cb-tag-files--empty {
  font-size: 12px;
  color: var(--text-secondary);
  font-style: italic;
}
```

---

## Acceptance Criteria

- [ ] `BarMode` TypeScript type includes `"tags"`.
- [ ] All four `Record<BarMode, string>` constants compile without error with `"tags"` entries.
- [ ] `MODE_CYCLE` is `["commands", "files", "keybindings", "content", "tags"]`.
- [ ] Pressing ⌘5 opens the bar in tags mode.
- [ ] Pressing ⌘5 again while in tags mode closes the bar (toggle).
- [ ] Pressing ⌘5 while bar is open in another mode switches to tags mode without closing.
- [ ] Tags mode shows a "DEFINED TAGS" section with tags from `window.__MARKABLE_META__.tags`.
- [ ] Each defined tag row shows a file count badge.
- [ ] Clicking a defined tag row expands inline file list.
- [ ] Clicking a file title in expanded list opens the file and closes the bar.
- [ ] Tags present in vault index but absent from meta vocabulary appear in "UNCATEGORISED" section.
- [ ] "UNCATEGORISED" section is absent when no uncategorised tags exist.
- [ ] Filter input filters both sections simultaneously by substring (case-insensitive).
- [ ] Clearing the filter shows all tags.
- [ ] EC-16: expanded rows are reset on bar re-open.
- [ ] EC-1 empty state: "No vault open" shown when `getActiveVault()` is null.
- [ ] EC-15 empty state: "No tags found" shown when both sections are empty and query is blank.
- [ ] "No tags match" shown when filter yields no results.
- [ ] EC-17: "Index still loading" notice shown when `getVaultIndex()` is null but defined tags exist.
- [ ] "Add to meta" button appears on hover of uncategorised rows.
- [ ] Clicking "Add to meta" writes the tag to the meta file (FR-8).
- [ ] After successful write, the tag moves to the Defined section without closing the bar.
- [ ] EC-14: on write failure, the tag stays in Uncategorised and in-memory meta is not updated.
- [ ] NFR-3: all CSS uses `var(--*)` variables; no hardcoded hex or pixel values conflicting with themes.
- [ ] NFR-5: TypeScript compiles without errors after adding `"tags"` to all Records.

---

## Test Requirements

See `step_04_tests.md` for full test spec. Tests specific to this step:

- `tests/plugins/command-bar/tags-mode.test.ts` — `buildTagRows()` unit tests with mock globals.
- Manual/integration: open bar, press ⌘5, verify both sections render correctly.
