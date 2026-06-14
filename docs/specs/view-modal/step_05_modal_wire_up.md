---
title: "step_05 — Modal wire-up (triggers + submit)"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_05 — Modal wire-up (triggers + submit)

## Goal

Wire the three trigger entry points (right-click → New Folder View,
right-click → existing `_folder.md` edit mode, in-doc Insert
CodeBlock) to `openViewModal(...)`. Implement submit handlers for all
three modes:

- **Create**: write `_folder.md` via `writeFolderMdCodeblock()`
  (step_02), open the folder-view tab.
- **Insert**: insert `select` codefence at cursor via
  `view.dispatch(...)`; preserve the existing mid-line newline behaviour
  (FR-8).
- **Edit (folder)**: same write path as Create; prefill via
  `parseSelectBodyForBuilder()` (read existing file, codeblock-first
  per AD-2).
- **Edit (in-doc)**: replace the existing fence range via
  `view.dispatch(...)`; preserve the existing detect-and-edit flow
  from `main.ts:1024`.

## Files touched

- **EDIT** `src/plugins/file-browser/file-browser.plugin.ts` — the
  right-click handler at line 3218 redirects to `openViewModal(...)`.
  The "Insert CodeBlock" entries at lines 3127 / 3232 redirect as well.
- **EDIT** `src/main.ts` — the `code-block` action handler at line 1020
  becomes a thin shim that calls `openViewModal("insert", ...)` or
  `openViewModal("edit", ...)` depending on `findCustomFenceAtCursor()`.
- **EDIT** `src/lib/codeblock-modal.ts` — fill in the primary-button
  click handler with the submit logic.
- **NEW** `tests/view-modal/submit-create.test.ts` — submit/Create
  end-to-end tests.
- **NEW** `tests/view-modal/submit-insert.test.ts` — submit/Insert
  end-to-end tests.

## Function signatures

No new public exports. The internal `openViewModal()` from step_04
gains complete submit logic.

The right-click handler change in `file-browser.plugin.ts`:

```typescript
// Before (line 3218):
handler: () => { openFolderViewPicker(path, container, vaultId); },

// After:
handler: () => {
  void openViewModalForFolder(path, container, vaultId);
},
```

The `openViewModalForFolder()` helper is a thin wrapper that:

1. Reads `_folder.md` (if exists) to derive `initial`.
2. Calls `openViewModal("edit" | "create", { folderPath, initial, ruleRowContext })`.

The existing `openFolderViewPicker` function is deleted in step_08
(after step_05 verifies no other call sites depend on it).

## Failing tests FIRST

Path: `tests/view-modal/submit-create.test.ts`. Tests:

1. **"Create writes `_folder.md` with codeblock shape (EC-1, FR-3)"** — `openViewModal("create", { folderPath: "/v/Foo" })`, click Create with defaults. Spy on `bridge.writeFile`: called with `path = "/v/Foo/_folder.md"` and content containing `"```select"` + `display: cards`.
2. **"Create opens the folder-view tab after write (FR-4)"** — spy on `openFolderViewTab(path)`, assert called after the write resolves.
3. **"Create with all toggles ON emits the expected codeblock (EC-17)"** — full default state submit; assert the emitted content contains `show-modified: true`, `show-extensions: true`, `preview-pane: true`. (Note: per `buildSelectFenceFromState`, `true` values are NOT emitted as lines today — `show-modified: false` is emitted when OFF. **Architect decision**: Q-2 / EC-17 says "emitted codeblock contains `showModifiedDate: true`" — translate to "the persisted value when read back is `true`". `buildSelectFenceFromState`'s convention is "omit the line when default", which means after reading the codeblock back, the toggle reads as ON (its default). Test assertion is: round-trip — write with all three ON, read with `parseSelectBodyForBuilder`, all three are `true`.)
4. **"Create + Collection tab writes `display: collection-home` (FR-80, EC-14)"** — switch tab to Collection, Create, assert emitted codeblock contains `display: collection-home`. Tab opens with Collections layout via the existing renderer dispatch.
5. **"Path empty on submit emits `path: ./` (EC-4)"** — clear Path, submit, assert content has either an explicit `path: ./` line OR no `path:` line (renderer default). Either is acceptable; the assertion checks the round-trip value reads back as `./`.
6. **"Edit mode prefill reads existing `_folder.md` codeblock (EC-21)"** — set up a `_folder.md` with `"```select\ndisplay: kanban\npath: Projects\nsort: name-desc\nshow-modified: false\n```"`, open the modal in edit mode, assert: Kanban tab is active, Path reads "Projects", Sort dropdown reads "Name ↓", Show modified date toggle is OFF.
7. **"Edit mode prefill reads legacy frontmatter shape (EC-2)"** — set up a `_folder.md` with `"---\nlayout: bookshelf\npath: Books\n---\n"`, open the modal in edit mode, assert: Bookshelf tab is active, Path reads "Books".
8. **"Edit mode save migrates to codeblock shape (EC-8)"** — open the EC-2 file, change Sort to "Name ↓", click Save. Assert the post-write file is codeblock shape and has no frontmatter `layout:`.
9. **"Submit roundtrip — Create + immediate Edit shows persisted state (EC-21)"** — Create with `Path: "Projects/2026"`, two filter rules, Sort Name ↓, first toggle OFF, Content Width Wide. Re-open in edit mode. Assert all seven pieces of state are prefilled.
10. **"Create on a folder that already has a `_folder.md` opens edit mode (EC-2)"** — set up a folder with a `_folder.md`. Trigger the right-click "New Folder View" handler. Assert the modal opens in edit mode with prefilled state (no confirm dialog).
11. **"Create when no `_folder.md` exists writes a new file (EC-1)"** — folder has no `_folder.md`. Right-click → New Folder View → submit. Assert `bridge.writeFile` is called.

Path: `tests/view-modal/submit-insert.test.ts`. Tests:

1. **"Insert at empty line — no leading newline (FR-8)"** — cursor on a blank line, Insert, assert `view.dispatch` insert text starts with ```` ```select ```` (no `\n` prefix).
2. **"Insert at mid-line — leading newline added (FR-8, EC-3)"** — cursor at column 5 of a non-empty line, Insert, assert insert text starts with `"\n```select"`.
3. **"Insert replaces the selection range when present"** — selection from col 2 to col 8, Insert, assert dispatch `changes: { from: 2, to: 8, insert: ... }`.
4. **"Insert in edit-existing-fence mode replaces the fence range (existing main.ts:1024 behaviour)"** — set up a `select` fence in the doc, place cursor inside, trigger Insert CodeBlock. Modal opens in edit mode with the fence's state prefilled. Save replaces the fence range. Existing behaviour from `main.ts` is preserved.
5. **"Insert mode title bar reads `Insert Codeblock` (FR-5, Q-1)"** — DOM check.
6. **"Insert + Collection tab inserts `display: collection-home` codefence"** — same as create-mode test 4 but for the in-doc path.
7. **"Cursor lands after closing fence after Insert (FR-7)"** — verify the selection range after dispatch.

EC mapping in this step: EC-1, EC-2, EC-3, EC-8, EC-14, EC-17, EC-21.

FR mapping: FR-1, FR-3, FR-4, FR-5, FR-7, FR-8, FR-40, FR-80.

## Implementation outline

### Right-click handler

```typescript
// file-browser.plugin.ts — replaces openFolderViewPicker(...) call.

async function openViewModalForFolder(
  folderPath: string,
  container: HTMLElement | null,
  vaultId: string,
): Promise<void> {
  const folderMdPath = folderPath + "/_folder.md";
  const ruleRowContext = getRuleRowContext();

  // EC-2: if _folder.md exists, open in edit mode with prefill.
  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vaultIndex = vaultManager?.getVaultIndex?.();
  const exists = (vaultIndex?.entries ?? []).some(
    (e: any) => e.path === folderMdPath,
  );

  let initial: SelectBuilderInitial | undefined;
  let mode: ViewModalMode = "create";
  if (exists) {
    mode = "edit";
    const readRes = await readFile(folderMdPath);
    if (readRes.ok) {
      initial = readFolderMdForBuilder(readRes.value);
    }
  }

  openViewModal(mode, {
    folderPath,
    initial,
    ruleRowContext,
  });
}

/**
 * Read a `_folder.md` and project to SelectBuilderInitial. Codeblock-first,
 * frontmatter-fallback (AD-2 / step_01 read order).
 *
 * Implementation strategy:
 *   1. parseYamlFrontmatter(content) to get bodyLines.
 *   2. extractSelectCodeblockBody(bodyText) to find codeblock.
 *   3a. If codeblock found: parseSelectBodyForBuilder(cbBody).
 *   3b. Else: project frontmatter via parseFolderMd() and map back to
 *       SelectBuilderInitial. (Legacy shapes — minimal projection.)
 */
function readFolderMdForBuilder(content: string): SelectBuilderInitial {
  // ...
}
```

### In-doc Insert handler

`src/main.ts:1020-1064` is reworked. The existing flow is:

```typescript
case "code-block": {
  const detected = findCustomFenceAtCursor(ed);
  if (detected) {
    openCodeBlockModal({ /* edit mode */ });
  } else {
    openCodeBlockModal({ /* insert mode */ });
  }
}
```

After step_05:

```typescript
case "code-block": {
  if (!editor) break;
  const ed = editor;
  const ruleRowContext = getRuleRowContext();
  const detected = findCustomFenceAtCursor(ed);
  const cursorPos = ed.state.selection.main.head;

  if (detected) {
    // Edit mode — only `select` fences open the View Modal; sidebar
    // and grid fences continue to open through their own paths (until
    // step_09 collapses them).
    const langFirst = detected.lang.split(/\s+/)[0];
    if (langFirst === "select") {
      const initial = parseSelectBodyForBuilder(detected.body);
      openViewModal("edit", {
        editor: { view: ed, from: detected.from, to: detected.to },
        initial,
        ruleRowContext,
      });
    } else {
      // Legacy sidebar/grid edit path — step_09 deletes this branch
      // and replaces with a no-op + toast pointing at the slash command.
      openCodeBlockModal({ /* legacy edit */ });
    }
  } else {
    openViewModal("insert", {
      editor: { view: ed, from: cursorPos, to: cursorPos },
      ruleRowContext,
    });
  }
  break;
}
```

### Submit logic inside `openViewModal()`

```typescript
primaryBtn.addEventListener("click", () => {
  const state = getState();  // from mountSelectForm
  // Coerce the active-tab selection into the state.display.
  state.display = state.activeTab as DisplayKind;
  // Empty Path → default "./".
  if (state.path.trim() === "") state.path = "./";

  void (async () => {
    close();
    if (mode === "create" || (mode === "edit" && ctx.folderPath)) {
      const res = await writeFolderMdCodeblock(ctx.folderPath!, state);
      if (res.ok) {
        openFolderViewTab(ctx.folderPath!);
      } else {
        showToast(`Could not write _folder.md: ${res.error.message}`);
      }
    } else if (mode === "insert" && ctx.editor) {
      const { view, from, to } = ctx.editor;
      const fence = buildSelectFenceFromState(state);
      const line = view.state.doc.lineAt(from);
      const needLead = line.from !== from && to === from;
      const insertText = (needLead ? "\n" : "") + fence + "\n";
      view.dispatch({ changes: { from, to, insert: insertText } });
    } else if (mode === "edit" && ctx.editor) {
      const { view, from, to } = ctx.editor;
      const fence = buildSelectFenceFromState(state);
      view.dispatch({ changes: { from, to, insert: fence } });
    }
  })();
});
```

## Refactor opportunities

- `readFolderMdForBuilder()` (in `file-browser.plugin.ts`) and the
  legacy frontmatter projection it does for EC-2 read-compat overlaps
  with `parseFolderMd()`'s overlay step. Phase 2 may unify them via a
  shared `select-builder-initial-from-folder-md(content)` helper. For
  Phase 1, keep them separate and tested.
- The submit branches (create vs insert vs edit-folder vs edit-fence)
  cluster around `mode + ctx` discrimination. A small dispatch table
  may help readability in Phase 2.

## Definition of Done

- All 11 tests in `tests/view-modal/submit-create.test.ts` pass.
- All 7 tests in `tests/view-modal/submit-insert.test.ts` pass.
- Existing tests in `tests/folder-view/` continue to pass.
- Existing tests in `tests/collections/` continue to pass (FR-81 / C-10).
- `npm run test:run -- tests/view-modal/ tests/folder-view/ tests/collections/` is green.
- `npm run build:plugins && npm run sync:plugins` runs clean.
- Manual: right-click an empty folder → New Folder View → Cards →
  Create. `_folder.md` lands on disk in codeblock shape; folder
  opens with Cards. Re-right-click the same folder → modal opens in
  edit mode with prefilled Cards / Path `./`.
- Manual: in a `.md` file, type `/block` → modal opens → Table →
  Insert → fence appears at cursor.
- Window-defaults invariant test continues to pass.
