/**
 * renderer.ts — Top-level renderer for the `collection-home` layout key.
 *
 * Owns the navigation state machine described in §1.8.B:
 *
 *   view: "home"  → render the home canvas (frame 01 / frame 04).
 *   view: "stack" → render the stack section view (frames 02 / 03), with a
 *                   2-segment breadcrumb above (Home, Stack). When the
 *                   inline editor mounts into a box, the breadcrumb gains
 *                   a third segment (Note).
 *
 * Single layout key, internal state machine — NOT two layout keys, NOT a
 * second tab kind.
 *
 * Click-outside-to-commit (FR-31 / EC-19): a capture-phase mousedown
 * listener on the container detects a click outside the currently-editing
 * box and dispatches `inlineEditor.unmount()` before the click reaches the
 * file-browser's default handlers.
 *
 * `renderCollectionHome` is the synchronous entry point that
 * `LAYOUT_RENDERERS["collection-home"]` calls. It synchronously sets up
 * the container scaffolding and fires the initial navigation as a
 * fire-and-forget promise — matching the existing folder-view renderer
 * pattern.
 *
 * @module collections/renderer
 */

import * as store from "./store";
import * as bridge from "../../../lib/bridge";
import * as vaultManager from "../../../lib/vault-manager";
import * as commands from "./commands";
import { renderHomeCanvas, renderHomeTable, type HomeCanvasOptions } from "./home-canvas";
import { renderStackPanel, type StackPanelHandle } from "./stack-panel";
import { createInlineEditor, type InlineEditorHandle } from "./inline-editor";
import { createPreviewCache, type PreviewCacheHandle } from "./preview-cache";
import { renderBreadcrumb } from "./breadcrumb";
import {
  createPlaceholder,
  beginInlineRename,
  beginInlineRenameOnLabel,
  buildNoteBoxContextItems,
  type NoteBoxHandle,
  type NoteBoxHandlers,
} from "./note-box";
import { showCollectionsContextMenu } from "./popover";
import { showCollisionDialog, incrementFilename } from "../../../lib/collision-dialog";
import type { NoteBoxKind } from "./types";
import type {
  FolderCard,
  FolderViewConfig,
  BulkContext,
} from "../folder-view/types";

/**
 * Per-container state held in a WeakMap so re-renders against the same
 * tab DOM root keep the preview cache + scroll positions alive between
 * navigations. The cache is cleared on `destroy()` only.
 */
interface CollectionsRendererState {
  view: "home" | "stack";
  collectionPath: string;
  activeStackPath: string | null;
  /** Persists the file/table toggle across navigateToStack re-renders. */
  stackTableView: "file" | "table";
  /** Persists the icon/table toggle for the Home canvas across re-renders. */
  homeTableView: "file" | "table";
  cache: PreviewCacheHandle;
  inlineEditor: InlineEditorHandle;
  stackPanel: StackPanelHandle | null;
  breadcrumbEl: HTMLElement;
  contentEl: HTMLElement;
  editorHostEl: HTMLElement;
  detachClickOutside: (() => void) | null;
}

const stateByContainer = new WeakMap<HTMLElement, CollectionsRendererState>();

/**
 * Return the set of filenames (basename + ".md") for immediate children of
 * `dir` in the current vault index. Used for collision pre-checks.
 */
function getFilenamesInDir(dir: string): Set<string> {
  const idx = vaultManager.getVaultIndex();
  if (!idx) return new Set();
  const prefix = dir.replace(/\/+$/, "") + "/";
  return new Set(
    idx.entries
      .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/"))
      .map((e) => `${e.name}.md`),
  );
}

/**
 * Public entry point. Registered in `LAYOUT_RENDERERS["collection-home"]`.
 *
 * Sets up the container scaffolding synchronously, then fires the initial
 * `navigateToHome(...)` as a fire-and-forget promise.
 */
export function renderCollectionHome(
  _config: FolderViewConfig,
  _cards: FolderCard[],
  container: HTMLElement,
  collectionPath: string,
  _bulkContext?: BulkContext,
): void {
  // Tear down any prior state on this container before rebuilding. Re-renders
  // of the same LAYOUT call (e.g. after a vault-changed) should not leak
  // observers or stack panels.
  const prior = stateByContainer.get(container);
  if (prior) {
    prior.detachClickOutside?.();
    prior.stackPanel?.destroy();
    prior.inlineEditor.destroy();
    prior.cache.clear();
  }

  container.replaceChildren();

  // Scaffolding: breadcrumb + content area + hidden editor host parent.
  const breadcrumbEl = document.createElement("div");
  breadcrumbEl.className = "fv-collection-breadcrumb-host";
  container.appendChild(breadcrumbEl);

  const contentEl = document.createElement("div");
  contentEl.className = "fv-collection-content";
  container.appendChild(contentEl);

  const editorHostEl = document.createElement("div");
  editorHostEl.className = "fv-collection-editor-host";
  editorHostEl.style.display = "none";
  container.appendChild(editorHostEl);

  const cache = createPreviewCache();
  const inlineEditor = createInlineEditor({
    hostParent: editorHostEl,
    onSave: (path) => {
      // Invalidate the preview cache so the next renderPreview call refetches.
      cache.invalidate(path);
      // The stack panel will re-render the corresponding box's preview on
      // the next observer pass; step 13's reference-integrity hooks fan
      // out to other Stacks that reference this canonical.
    },
    onCommitError: (path, error) => {
      console.warn("[collections] inline-editor commit failed for", path, error);
    },
  });

  const state: CollectionsRendererState = {
    view: "home",
    collectionPath,
    activeStackPath: null,
    stackTableView: "file",
    homeTableView: "file",
    cache,
    inlineEditor,
    stackPanel: null,
    breadcrumbEl,
    contentEl,
    editorHostEl,
    detachClickOutside: null,
  };
  stateByContainer.set(container, state);

  // Click-outside-to-commit (FR-31 / EC-19). Capture phase so we run BEFORE
  // any per-box click handler. If the editor is mounted and the click target
  // is outside the editing box, commit + unmount.
  const clickOutsideHandler = (ev: MouseEvent): void => {
    if (!state.inlineEditor.isMounted()) return;
    const editingBox = container.querySelector(
      ".fv-collection-note-box.is-editing",
    );
    if (editingBox && !editingBox.contains(ev.target as Node)) {
      void state.inlineEditor.unmount();
    }
  };
  container.addEventListener("mousedown", clickOutsideHandler, true);
  state.detachClickOutside = () => {
    container.removeEventListener("mousedown", clickOutsideHandler, true);
  };

  // Kick off the initial render.
  void navigateToHome(state);
}

/**
 * Render the Home canvas view. Clears any prior Stack panel and resets the
 * breadcrumb to a single non-clickable "Home" segment.
 */
async function navigateToHome(state: CollectionsRendererState): Promise<void> {
  await state.inlineEditor.unmount();
  state.stackPanel?.destroy();
  state.stackPanel = null;
  state.view = "home";
  state.activeStackPath = null;

  // Home view: breadcrumb area is empty; the toggle lives inside the
  // content area next to the "🏠 <folder-name>" header title.
  state.breadcrumbEl.replaceChildren();
  state.breadcrumbEl.classList.remove("fv-collection-breadcrumb-host--row");

  // Refactor R05 — note-box click handler for parent-folder notes that
  // appear on the Home canvas. Mirrors the Stack-panel `onNoteClick`:
  // read the file, mount the persistent inline editor into the box, and
  // grow the breadcrumb to two segments (Home + Note) for the editing
  // session. Reuses the same `state.inlineEditor.mount` path so all
  // commit semantics (click-outside, Escape, save) are inherited
  // unchanged.
  // Note tile click → open the .md in a new tab (regular Markable editor).
  // The original Typora-style inline-edit-in-place is preserved in code
  // (state.inlineEditor.mount) but no longer wired to click; we may bring
  // it back via a different gesture (double-click, context menu) later.
  const onHomeNoteClick = (handle: NoteBoxHandle): void => {
    const tabMgr = (window as unknown as { __MARKABLE_TAB_MANAGER__?: { openFileInTab?: (p: string) => Promise<unknown> } }).__MARKABLE_TAB_MANAGER__;
    void tabMgr?.openFileInTab?.(handle.notePath);
  };
  const onHomeNoteContextMenu = (handle: NoteBoxHandle, ev: MouseEvent): void => {
    // Build the canonical items via the existing note-box helper so the
    // Home-canvas and Stack-panel menus stay visually consistent. Only
    // the Rename action is fully wired here; the others (Move up/down,
    // Move to other Stack, references, delete) are deferred per the
    // original step_14 backlog.
    const items = buildNoteBoxContextItems(handle).map((item) => ({
      label: item.label,
      onClick:
        item.action === "rename"
          ? () => void renameNote(state, handle)
          : null,
      danger: item.danger,
    }));
    showCollectionsContextMenu(ev.clientX, ev.clientY, items);
  };

  const opts: HomeCanvasOptions = {
    collectionPath: state.collectionPath,
    onStackClick: (stackPath) => {
      void navigateToStack(state, stackPath);
    },
    onCreateStack: async () => {
      const r = await commands.newStack(state.collectionPath);
      if (!r.ok) return;
      // Reload the vault index so the new subfolder is visible to
      // `listImmediateSubfolders` AND propagates into the file-browser
      // tree (which also reads the index). Then re-render the Home
      // canvas — we stay on Home (per user direction, creating a Stack
      // does NOT navigate into it; the new tile just slots in).
      await vaultManager.reloadVaultIndex();
      await navigateToHome(state);
    },
    onCreateNotecard: async () => {
      // Notecard lives in the collection folder root, NOT inside a
      // Stack (per the 2026-06-09 directive). The new file appears as
      // a tile in the Home canvas mixed grid via the vault index.
      const r = await commands.createNotecardInCollection(state.collectionPath);
      if (!r.ok) return;
      await vaultManager.reloadVaultIndex();
      await navigateToHome(state);
    },
    onNoteClick: (handle) => void onHomeNoteClick(handle),
    onNoteContextMenu: (handle, ev) => onHomeNoteContextMenu(handle, ev),
    onStackRename: async () => {
      // Wired in step 14 (context menu).
    },
    onStackReorder: async () => {
      // Wired in step 14.
    },
    onStackDelete: async () => {
      // Wired in step 14.
    },
    onStackSetIcon: () => {
      // Delegates to the existing folder-icon picker (step 14).
    },
    onStackContextMenu: (stackPath, stackFolderName, labelEl, ev) => {
      // Show the same chrome the note tiles use, with Stack-specific
      // items. For now only Rename is wired; Delete / Set Icon / etc.
      // are reserved for later passes.
      showCollectionsContextMenu(ev.clientX, ev.clientY, [
        {
          label: "Rename",
          onClick: () => void renameStack(state, stackPath, stackFolderName, labelEl),
        },
        { label: "Delete", onClick: null, danger: true },
      ]);
    },
    onMoveNoteIntoStack: (notePath, targetStackPath) => {
      // Drop-on-Stack handler — moves the file via the atomic Rust
      // `move_file` command, appends it to the Stack's order: array so
      // rename and reorder work immediately, refreshes the vault index,
      // then re-renders the Home canvas so the moved note disappears from
      // the parent's mixed grid and the destination Stack's tile count
      // updates.
      void (async () => {
        let srcPath = notePath;
        let movedFilename = notePath.split("/").pop() ?? "";
        const destPath = `${targetStackPath.replace(/\/+$/, "")}/${movedFilename}`;
        if (vaultManager.getVaultIndex()?.entries.some((e) => e.path === destPath)) {
          const existing = getFilenamesInDir(targetStackPath);
          const suggested = incrementFilename(movedFilename, existing);
          const choice = await showCollisionDialog({ filename: movedFilename, suggestedName: suggested });
          if (choice === "stop") return;
          if (choice === "keep-both") {
            // Rename the source file first, then move the renamed file.
            const srcDir = notePath.slice(0, notePath.lastIndexOf("/"));
            const safeSrc = `${srcDir}/${suggested}`;
            const r = await bridge.renameFile(notePath, safeSrc);
            if (!r.ok) return;
            srcPath = safeSrc;
            movedFilename = suggested;
          } else {
            const delRes = await bridge.deleteFile(destPath);
            if (!delRes.ok) return;
          }
        }
        const moveRes = await bridge.moveFile(srcPath, targetStackPath);
        if (!moveRes.ok) return;
        if (movedFilename) {
          await store.appendNoteToStack(targetStackPath, movedFilename);
        }
        await vaultManager.reloadVaultIndex();
        await navigateToHome(state);
      })();
    },
    onReorderComplete: () => {
      // The drag util computes a new order but never mutates the source
      // DOM. After the persistence write resolves, re-render the Home
      // canvas so the visible tile order reflects the new state. Same
      // navigateToHome path used after Note/Stack creation.
      void navigateToHome(state);
    },
  };
  if (state.homeTableView === "table") {
    await renderHomeTable(state.contentEl, opts);
  } else {
    await renderHomeCanvas(state.contentEl, opts);
  }

  // Inject the toggle button into the home header, to the right of the
  // folder title. renderHomeCanvas/renderHomeTable both create a
  // .fv-collection-home-header element as the first child of contentEl.
  const homeHeader = state.contentEl.querySelector(".fv-collection-home-header");
  if (homeHeader) {
    const homeToggleBtn = document.createElement("button");
    homeToggleBtn.type = "button";
    homeToggleBtn.className = "fv-collection-view-toggle-btn";
    homeToggleBtn.dataset.view = state.homeTableView;
    homeToggleBtn.textContent = state.homeTableView === "file" ? "≡" : "▦";
    const labelInit = state.homeTableView === "file" ? "table view" : "file view";
    homeToggleBtn.setAttribute("aria-label", `Switch to ${labelInit}`);
    homeToggleBtn.setAttribute("title", `Switch to ${labelInit}`);
    homeHeader.appendChild(homeToggleBtn);

    homeToggleBtn.addEventListener("click", () => {
      const next = state.homeTableView === "file" ? "table" : "file";
      state.homeTableView = next;
      void navigateToHome(state);
    });
  }
}

/**
 * Render the Stack section view for `stackPath`. Clears any prior panel,
 * sets the breadcrumb to two segments (Home + Stack), and mounts the
 * stack panel.
 */
async function navigateToStack(
  state: CollectionsRendererState,
  stackPath: string,
): Promise<void> {
  await state.inlineEditor.unmount();
  state.stackPanel?.destroy();
  state.stackPanel = null;
  state.view = "stack";
  state.activeStackPath = stackPath;

  // Two-segment breadcrumb. The Home segment carries `dropTargetPath`
  // so a note dragged from the Stack panel onto Home moves the file
  // back to the Collection root (out of the Stack).
  const stackMeta = await store.readStack(stackPath);
  const stackLabel = stackMeta.ok ? stackMeta.value.displayName : "Stack";
  const breadcrumb = renderBreadcrumb([
    {
      label: "Home",
      onClick: () => void navigateToHome(state),
      icon: "home",
      dropTargetPath: state.collectionPath,
    },
    { label: stackLabel, onClick: null },
  ]);
  // Single view-toggle button — flips between file (▦) and table (≡)
  // on each click. Positioned to the LEFT of the breadcrumb row (right
  // after the breadcrumb segments) so it doesn't fight the right-edge
  // gear icon that appears on hover.
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "fv-collection-view-toggle-btn";
  toggleBtn.dataset.view = "file";
  toggleBtn.textContent = "≡"; // shows the NEXT view's icon
  toggleBtn.setAttribute("aria-label", "Switch to table view");
  toggleBtn.setAttribute("title", "Switch to table view");
  state.breadcrumbEl.replaceChildren();
  state.breadcrumbEl.classList.add("fv-collection-breadcrumb-host--row");
  state.breadcrumbEl.appendChild(breadcrumb);
  state.breadcrumbEl.appendChild(toggleBtn);

  // Hoist the per-box callbacks so the +Note path can reuse them when
  // constructing a placeholder for the newly created file. Keeping these in
  // one place means click, context-menu, and rename behaviour cannot drift
  // between freshly-rendered boxes and incrementally-inserted boxes.
  const onNoteClick = (handle: NoteBoxHandle): void => {
    // Open the note in a full editor tab — same behaviour as the Home canvas.
    // EC-16: broken pointer has no canonical file to open; silently ignore.
    if (handle.kind.kind === "broken") return;
    const tabMgr = (window as unknown as { __MARKABLE_TAB_MANAGER__?: { openFileInTab?: (p: string) => Promise<unknown> } }).__MARKABLE_TAB_MANAGER__;
    void tabMgr?.openFileInTab?.(handle.notePath);
  };
  const onNoteContextMenu = (handle: NoteBoxHandle, ev: MouseEvent): void => {
    const noteFilename =
      handle.kind.kind === "canonical" ? handle.kind.noteFilename : null;
    const items = buildNoteBoxContextItems(handle).map((item) => {
      let onClick: (() => void) | null = null;
      switch (item.action) {
        case "rename":
          onClick = () => void renameNote(state, handle);
          break;
        case "move-up":
          if (noteFilename) {
            onClick = () =>
              void (async () => {
                await store.reorderNote(stackPath, noteFilename, "up");
                await navigateToStack(state, stackPath);
              })();
          }
          break;
        case "move-down":
          if (noteFilename) {
            onClick = () =>
              void (async () => {
                await store.reorderNote(stackPath, noteFilename, "down");
                await navigateToStack(state, stackPath);
              })();
          }
          break;
        case "delete":
          if (noteFilename) {
            onClick = () =>
              void (async () => {
                const deleteRes = await bridge.deleteFile(handle.notePath);
                if (!deleteRes.ok) return;
                state.cache.invalidate(handle.notePath);
                await store.removeNoteFromStack(stackPath, noteFilename);
                await vaultManager.reloadVaultIndex();
                await navigateToStack(state, stackPath);
              })();
          }
          break;
        default:
          onClick = null;
      }
      return { label: item.label, onClick, danger: item.danger };
    });
    showCollectionsContextMenu(ev.clientX, ev.clientY, items);
  };
  const onNoteRenameCommit = async (): Promise<{ ok: boolean; error?: string }> => ({
    ok: true,
  });
  const placeholderHandlers: NoteBoxHandlers = {
    onClick: (h) => void onNoteClick(h),
    onContextMenu: (handle, ev) => onNoteContextMenu(handle, ev),
    onRenameCommit: onNoteRenameCommit,
  };

  // Build the stack panel. Note-click reads the file, then mounts the
  // editor in place. Re-renders the box's preview after commit.
  state.contentEl.replaceChildren();
  state.stackPanel = await renderStackPanel(state.contentEl, {
    stackPath,
    cache: state.cache,
    onNoteClick,
    onNoteContextMenu,
    onNoteRenameCommit,
    onMoveNoteToBreadcrumb: (notePath, targetFolderPath) => {
      // Note dragged onto a breadcrumb segment → move the file to
      // that ancestor folder, refresh the index, navigate back home.
      // The stale filename left in order: self-heals on next render
      // because mergeOrderWithPhysical drops entries not in the
      // physical vault index.
      void (async () => {
        let srcPath = notePath;
        const filename = notePath.split("/").pop() ?? "";
        const destPath = `${targetFolderPath.replace(/\/+$/, "")}/${filename}`;
        if (filename && vaultManager.getVaultIndex()?.entries.some((e) => e.path === destPath)) {
          const existing = getFilenamesInDir(targetFolderPath);
          const suggested = incrementFilename(filename, existing);
          const choice = await showCollisionDialog({ filename, suggestedName: suggested });
          if (choice === "stop") return;
          if (choice === "keep-both") {
            const srcDir = notePath.slice(0, notePath.lastIndexOf("/"));
            const safeSrc = `${srcDir}/${suggested}`;
            const r = await bridge.renameFile(notePath, safeSrc);
            if (!r.ok) return;
            srcPath = safeSrc;
          } else {
            const delRes = await bridge.deleteFile(destPath);
            if (!delRes.ok) return;
          }
        }
        const moveRes = await bridge.moveFile(srcPath, targetFolderPath);
        if (!moveRes.ok) return;
        await vaultManager.reloadVaultIndex();
        await navigateToHome(state);
      })();
    },
    onReorderComplete: () => {
      // After in-Stack reorder persists, re-render the Stack panel so
      // the visible tile order matches the new `order:` array.
      void navigateToStack(state, stackPath);
    },
    onCreateNote: async (): Promise<NoteBoxHandle | null> => {
      const r = await commands.createNoteInStack(stackPath);
      if (!r.ok) return null;

      // Happy path: incremental insertion via `panel.addNote(handle)` so the
      // pair of IntersectionObservers the panel already owns is reused —
      // the new box just calls `observe()` on each. A full re-navigate
      // would tear both observers down and rebuild them for every existing
      // box (O(N) cost on every +Note click; NFR-1 targets 200+).
      //
      // Fallback: if for any reason the panel handle isn't available (e.g.
      // a teardown raced the click), full re-navigate is still correct —
      // just slower. We return null then so the panel's own listener does
      // nothing and the navigate call below remounts everything.
      const panel = state.stackPanel;
      if (!panel) {
        await navigateToStack(state, stackPath);
        return null;
      }

      const notePath = r.value.notePath;
      const noteFilename = notePath.split("/").pop() ?? notePath;
      const label = noteFilename.replace(/\.md$/, "");
      const kind: NoteBoxKind = {
        kind: "canonical",
        stackPath,
        noteFilename,
      };
      const initialHeight = state.cache.peekHeight(notePath) ?? undefined;
      // Returning the handle hands ownership to the panel's own
      // addBtn.click() listener, which calls `panel.addNote(handle)`. The
      // panel inserts the element before the +Note tile and registers it
      // with the existing observers — no remount.
      return createPlaceholder(
        notePath,
        kind,
        label,
        placeholderHandlers,
        initialHeight,
      );
    },
  });

  // Restore the view that was active before this navigateToStack call
  // (e.g. after a drag-reorder re-render, stay in table view).
  if (state.stackTableView === "table") {
    state.stackPanel?.setView("table");
    toggleBtn.dataset.view = "table";
    toggleBtn.textContent = "▦";
    toggleBtn.setAttribute("aria-label", "Switch to file view");
    toggleBtn.setAttribute("title", "Switch to file view");
  }

  // Single-button toggle: each click flips the panel view. Persists the
  // choice in state so re-renders (reorder, rename, etc.) restore it.
  toggleBtn.addEventListener("click", () => {
    const current = (toggleBtn.dataset.view as "file" | "table") ?? "file";
    const next = current === "file" ? "table" : "file";
    state.stackPanel?.setView(next);
    state.stackTableView = next;
    toggleBtn.dataset.view = next;
    toggleBtn.textContent = next === "file" ? "≡" : "▦";
    const labelNext = next === "file" ? "table view" : "file view";
    toggleBtn.setAttribute("aria-label", `Switch to ${labelNext}`);
    toggleBtn.setAttribute("title", `Switch to ${labelNext}`);
  });
}

/**
 * Inline-rename a note tile and persist the rename on disk. Triggered
 * from the Rename context-menu item.
 *
 *   1. `beginInlineRename` swaps the tile's label for an input. The
 *      promise resolves to the new name (or null on Esc / no-change).
 *   2. `renameFile(oldPath, newPath)` does the atomic rename via Rust.
 *   3. Vault index reloads so the new path is visible everywhere.
 *   4. The current view re-renders (Home or Stack) immediately.
 *   5. Order arrays are patched afterward so tile position is preserved
 *      (the file-watcher re-render triggered by that write corrects order).
 */
async function renameNote(
  state: CollectionsRendererState,
  handle: NoteBoxHandle,
): Promise<void> {
  const raw = await beginInlineRename(handle);
  if (raw === null) return;
  // Always preserve `.md` — users typically rename without re-typing
  // the extension. If they DID type it, don't double it up.
  let filename = raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`;
  const dirSep = handle.notePath.lastIndexOf("/");
  if (dirSep < 0) return;
  const dir = handle.notePath.slice(0, dirSep);
  let newPath = `${dir}/${filename}`;
  if (newPath === handle.notePath) return;

  // Collision check: if a file with this name already exists, ask the user.
  if (vaultManager.getVaultIndex()?.entries.some((e) => e.path === newPath)) {
    const existing = getFilenamesInDir(dir);
    const suggested = incrementFilename(filename, existing);
    const choice = await showCollisionDialog({ filename, suggestedName: suggested });
    if (choice === "stop") return;
    if (choice === "keep-both") {
      filename = suggested;
      newPath = `${dir}/${filename}`;
    } else {
      const delRes = await bridge.deleteFile(newPath);
      if (!delRes.ok) return;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const renameRes = await bridge.renameFile(handle.notePath, newPath);
  if (!renameRes.ok) return;
  await vaultManager.reloadVaultIndex();
  tabMgr?.handleFileRename?.(handle.notePath, newPath);

  // Keep the Stack's order: array in sync so the tile stays at its
  // original position after re-render. Works even when the note was never
  // explicitly added to order: (moved-in notes) — renameNoteInStack is
  // a no-op in that case, and the note just appears at the tail as before.
  if (state.view === "stack" && state.activeStackPath) {
    const oldFilename = handle.notePath.split("/").pop() ?? "";
    await store.renameNoteInStack(state.activeStackPath, oldFilename, filename);
    await navigateToStack(state, state.activeStackPath);
  } else {
    await navigateToHome(state);
  }
}

/**
 * Inline-rename a Stack glyph and persist on disk. The folder itself
 * is renamed (atomic via the same Rust `rename_file` command the file
 * browser's F2 rename uses). Vault index reloads and the Home canvas
 * re-renders so the new name is visible.
 */
async function renameStack(
  state: CollectionsRendererState,
  stackPath: string,
  oldFolderName: string,
  labelEl: HTMLElement,
): Promise<void> {
  const raw = await beginInlineRenameOnLabel(labelEl);
  if (raw === null) return;
  const newFolderName = raw.trim();
  if (!newFolderName || newFolderName === oldFolderName) return;
  // Filesystem-illegal characters get refused by the rename Rust
  // command; we let it surface naturally rather than pre-validating.
  const parentDir = stackPath.replace(/\/+$/, "").split("/").slice(0, -1).join("/");
  const newStackPath = `${parentDir}/${newFolderName}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const renameRes = await bridge.renameFile(stackPath, newStackPath);
  if (!renameRes.ok) return;
  await vaultManager.reloadVaultIndex();
  // Directory rename: update any open tabs whose path starts with the
  // old stack path so titles and file references stay in sync.
  const tabs: Array<{ filePath: string | null }> = tabMgr?.getTabs?.() ?? [];
  const prefix = stackPath + "/";
  for (const tab of tabs) {
    if (tab.filePath?.startsWith(prefix)) {
      const newTabPath = newStackPath + "/" + tab.filePath.slice(prefix.length);
      tabMgr?.handleFileRename?.(tab.filePath, newTabPath);
    }
  }

  // CRITICAL: the displayed tile label comes from `_folder.md`'s
  // `displayName` field (read by store.readStack and rendered as
  // `data.displayName` in home-canvas.ts). Renaming the folder on
  // disk does NOT update that field — without this write, the tile
  // keeps showing the old name forever.
  await store.writeStackMeta(newStackPath, { displayName: newFolderName });

  // Keep the parent Collection's `stackOrder` array pointing at the
  // new folder name so the user's drag-order is preserved across the
  // rename. (When this is skipped, the renamed stack drops out of
  // `stackOrder` and re-appears at the tail on next render.)
  const cur = await store.readCollection(state.collectionPath);
  if (cur.ok && cur.value.stackOrder.includes(oldFolderName)) {
    await store.writeCollectionMeta(state.collectionPath, {
      stackOrder: cur.value.stackOrder.map((s) =>
        s === oldFolderName ? newFolderName : s,
      ),
    });
  }

  await navigateToHome(state);
}

/**
 * Tear down state for a container. Called externally by the file-browser
 * when the tab is closed.
 */
export function destroyCollectionRenderer(container: HTMLElement): void {
  const state = stateByContainer.get(container);
  if (!state) return;
  state.detachClickOutside?.();
  state.stackPanel?.destroy();
  state.inlineEditor.destroy();
  state.cache.clear();
  stateByContainer.delete(container);
}
