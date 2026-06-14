/**
 * stack-panel.ts — Frames 02/03 — the Stack section view.
 *
 * Renders a header (Stack icon + display name) and a vertical list of framed
 * boxes (one per `order:` entry + one per `references:` entry), plus a
 * trailing `+ Note` affordance.
 *
 * Lazy rendering (FR-27 / FR-28 / EC-18): two IntersectionObservers monitor
 * every box. Asymmetric `rootMargin` gives the system hysteresis so a box
 * does not flicker between rendered and placeholder when scrolled right at
 * the viewport edge:
 *
 *   enter observer — `rootMargin: "200px 0px"` (about one viewport overscan).
 *                    Fires when a placeholder approaches the viewport;
 *                    triggers `renderPreview`.
 *   exit observer  — `rootMargin: "1000px 0px"` (much larger).
 *                    Fires only after the box has been far out of view long
 *                    enough that re-rendering is justified by DOM-node budget;
 *                    triggers `recycleToPlaceholder`.
 *
 * Reference vs broken classification (FR-22 / EC-16): a `references:` entry
 * is classified as `broken` when its target absolute path is NOT present in
 * the current vault index — covers deleted files, watcher misses, and
 * folder paths (EC-17).
 *
 * @module collections/stack-panel
 */

import * as store from "./store";
import * as vaultManager from "../../../lib/vault-manager";
import { createAddCircleAffordance } from "./affordances";
import {
  createPlaceholder,
  renderPreview,
  recycleToPlaceholder,
  type NoteBoxHandle,
  type NoteBoxHandlers,
} from "./note-box";
import type { NoteBoxKind } from "./types";
import type { PreviewCacheHandle } from "./preview-cache";
import { attachFolderItemDrag } from "../folder-view/folder-item-drag";
import { compositeFilename } from "./composite";

/** rootMargin for the enter observer — small overscan window. */
const ENTER_ROOT_MARGIN = "200px 0px";
/** rootMargin for the exit observer — large hysteresis so boxes don't flicker. */
const EXIT_ROOT_MARGIN  = "1000px 0px";

export interface StackPanelOptions {
  readonly stackPath: string;
  readonly cache: PreviewCacheHandle;
  readonly onNoteClick: (handle: NoteBoxHandle) => void;
  readonly onNoteContextMenu: (handle: NoteBoxHandle, ev: MouseEvent) => void;
  readonly onNoteRenameCommit: NoteBoxHandlers["onRenameCommit"];
  readonly onCreateNote: () => Promise<NoteBoxHandle | null>;
  readonly initialScrollTop?: number;
  /**
   * Drop-on-breadcrumb handler — fired when a note tile inside the
   * Stack is dragged onto a breadcrumb segment that carries a
   * `data-bc-path` attribute (typically the Home segment). The
   * renderer should move the file to that destination folder,
   * reload the vault index, and re-render. Optional so the module
   * can be rendered standalone in tests.
   */
  readonly onMoveNoteToBreadcrumb?: (notePath: string, targetFolderPath: string) => void;
  /**
   * Fired after drag-reorder of a note inside the Stack persists.
   * Renderer re-renders the Stack panel so the visual tile order
   * matches the persisted `order:` array (the drag util shows a
   * ghost during drag but doesn't move the source DOM).
   */
  readonly onReorderComplete?: () => void;
}

export interface StackPanelHandle {
  readonly el: HTMLElement;
  readonly listEl: HTMLElement;
  addNote(handle: NoteBoxHandle): void;
  removeNote(notePath: string): void;
  /** Swap between the tile grid (file) and the table-list (table) view. */
  setView(view: "file" | "table"): void;
  destroy(): void;
}

/**
 * Convert a vault-relative path into an absolute path using the active
 * vault's rootPath. Returns the input unchanged if no vault is set.
 */
function vaultRelToAbsolute(rel: string): string {
  const vault = vaultManager.getActiveVault();
  if (!vault || vault.rootPaths.length === 0) return rel;
  // Pick the first rootPath; consistent with `commands.ts:toVaultRel`.
  return `${vault.rootPaths[0].replace(/\/+$/, "")}/${rel}`;
}

/**
 * Build the panel and observe every box. Returns a handle the renderer can
 * use to add/remove boxes and tear down on navigation.
 */
export async function renderStackPanel(
  container: HTMLElement,
  opts: StackPanelOptions,
): Promise<StackPanelHandle> {
  container.replaceChildren();

  // Outer scroll container + sticky header + vertical list. The CSS (step
  // 17) sets the scroll behaviour.
  const section = document.createElement("section");
  section.className = "fv-collection-stack-panel";
  container.appendChild(section);

  // No in-panel header — the breadcrumb in the outer container shows
  // the Stack name ("Home / Stack 01") so a second title is redundant.
  // The view toggle has moved to the breadcrumb row; the renderer
  // wires it to `panel.setView(...)` via the returned handle.
  const stackMeta = await store.readStack(opts.stackPath);

  let currentView: "file" | "table" = "file";

  const listEl = document.createElement("div");
  listEl.className = "fv-collection-stack-list";
  section.appendChild(listEl);

  // Table-view container — empty until first toggle. Built lazily from
  // the same children the file view shows; visibility swaps on toggle
  // (both DOM trees coexist so observers stay alive in file view).
  const tableEl = document.createElement("div");
  tableEl.className = "fv-collection-table-view";
  tableEl.style.display = "none";
  section.appendChild(tableEl);

  const setView = (next: "file" | "table"): void => {
    if (next === currentView) return;
    currentView = next;
    if (next === "file") {
      listEl.style.display = "";
      tableEl.style.display = "none";
      return;
    }
    // Switching to table view — render once per switch from the
    // current order (which already reflects any drag-reorder writes).
    listEl.style.display = "none";
    tableEl.style.display = "";
    renderStackTable(tableEl, opts.stackPath, opts.onNoteClick, opts.onReorderComplete);
  };

  // ── Build per-note handles ──────────────────────────────────────────────
  // Map from box element → handle so the observers can look up which handle
  // an intersecting target represents.
  const handlesByEl = new Map<HTMLElement, NoteBoxHandle>();
  const handlesByPath = new Map<string, NoteBoxHandle>();

  const handlers: NoteBoxHandlers = {
    onClick: (h) => opts.onNoteClick(h),
    onContextMenu: (h, ev) => opts.onNoteContextMenu(h, ev),
    onRenameCommit: opts.onNoteRenameCommit,
  };

  if (stackMeta.ok) {
    // Canonical boxes — discovered via the vault index, then ordered
    // according to `stackMeta.value.order` (manual sort: known-head,
    // unknown-auto-append, missing-drop). This way a Stack folder
    // populated through Finder (or auto-collected when the Section was
    // created) shows its physical .md files even when `order:` is empty
    // or stale. Mirrors `applyNameManualOrder` in home-canvas.ts.
    const vaultIndex = vaultManager.getVaultIndex();
    const physicalFilenames = listStackImmediateNoteFilenames(
      opts.stackPath,
      vaultIndex,
    );
    const orderedFilenames = mergeOrderWithPhysical(
      stackMeta.value.order,
      physicalFilenames,
    );
    for (const noteFilename of orderedFilenames) {
      const notePath = `${opts.stackPath.replace(/\/+$/, "")}/${noteFilename}`;
      const kind: NoteBoxKind = {
        kind: "canonical",
        stackPath: opts.stackPath,
        noteFilename,
      };
      const label = noteFilename.replace(/\.md$/, "");
      const initialHeight = opts.cache.peekHeight(notePath) ?? undefined;
      const handle = createPlaceholder(notePath, kind, label, handlers, initialHeight);
      // Refactor R06 — `data-path` is the basename (matches the `order:`
      // array shape). The drag util reads this attribute for both the
      // dragged element and its siblings. The `data-note-path` attribute
      // set by `createPlaceholder` (absolute path) is preserved for the
      // inline-editor mount path, which reads the canonical path directly.
      handle.el.dataset.path = noteFilename;
      listEl.appendChild(handle.el);
      handlesByEl.set(handle.el, handle);
      handlesByPath.set(notePath, handle);
      // Refactor R06 — wire drag-reorder on canonical boxes. Reference
      // boxes (built below) are NOT made draggable because they live in
      // a separate `references:` array; per-Stack reordering of
      // references is intentionally deferred (DW-R3 in 00_index).
      // Cross-Stack drag is structurally refused by the container scope:
      // the drag util only enumerates siblings under `listEl`, so a drop
      // outside this Stack's panel is treated as "drop at end" and no
      // `onReorder` fires.
      attachFolderItemDrag(
        handle.el,
        listEl,
        noteFilename,
        ".fv-collection-note-box[data-path]",
        (orderedFilenames) => {
          // Compute the new index for the dragged filename and dispatch
          // through the store. The store performs the atomic rewrite +
          // per-file queue.
          const toIndex = orderedFilenames.indexOf(noteFilename);
          if (toIndex < 0) return; // dragged item disappeared — defensive
          void (async () => {
            await store.reorderNote(opts.stackPath, noteFilename, { toIndex });
            opts.onReorderComplete?.();
          })();
        },
        {
          // Drop-on-breadcrumb: dragging a note onto an ancestor
          // breadcrumb segment moves the file UP the hierarchy.
          // Currently the only ancestor that carries `data-bc-path` is
          // the Home segment (collection root), but the same mechanism
          // generalizes to Chapter / Book breadcrumbs when those land.
          containerTargetSelector: ".fv-collection-breadcrumb-seg[data-bc-path]",
          onDropOnContainer: (targetEl) => {
            const targetPath = targetEl.getAttribute("data-bc-path");
            if (!targetPath) return;
            void opts.onMoveNoteToBreadcrumb?.(handle.notePath, targetPath);
          },
        },
      );
    }
    // Reference boxes appear after canonicals; broken classification uses
    // the vault index as ground truth.
    const index = vaultManager.getVaultIndex();
    const knownNotes = new Set<string>(
      index ? index.entries.map((e) => e.path) : [],
    );
    for (const refRel of stackMeta.value.references) {
      const canonicalPath = vaultRelToAbsolute(refRel);
      const isBroken = !knownNotes.has(canonicalPath);
      const kind: NoteBoxKind = isBroken
        ? { kind: "broken",   ownerStackPath: opts.stackPath, canonicalRel: refRel }
        : { kind: "reference", ownerStackPath: opts.stackPath, canonicalRel: refRel };
      const label = refRel.split("/").pop()?.replace(/\.md$/, "") ?? refRel;
      const initialHeight = opts.cache.peekHeight(canonicalPath) ?? undefined;
      const handle = createPlaceholder(
        canonicalPath,
        kind,
        label,
        handlers,
        initialHeight,
      );
      listEl.appendChild(handle.el);
      handlesByEl.set(handle.el, handle);
      handlesByPath.set(canonicalPath, handle);
    }
  }

  // ── Trailing `+ Note` affordance (FR-11) ────────────────────────────────
  // Uses the shared Collections "+" component so the icon, sizing, and
  // hover state always match the Home canvas affordance — single source
  // of truth in `affordances.ts`.
  const addBtn = createAddCircleAffordance({
    ariaLabel: "Add Note",
    onClick: () => {
      void opts.onCreateNote().then((newHandle) => {
        if (newHandle) panelHandle.addNote(newHandle);
      });
    },
  });
  listEl.appendChild(addBtn);

  // ── Observers ───────────────────────────────────────────────────────────
  // The asymmetric rootMargin between the two observers is the hysteresis
  // (1.8.D): a box must cross the 200px boundary to render and the 1000px
  // boundary to recycle.
  const enterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const handle = handlesByEl.get(entry.target as HTMLElement);
        if (!handle || handle.state !== "placeholder") continue;
        void renderPreview(handle, opts.cache);
      }
    },
    { root: section, rootMargin: ENTER_ROOT_MARGIN },
  );
  const exitObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) continue;
        const handle = handlesByEl.get(entry.target as HTMLElement);
        if (!handle || handle.state !== "rendered") continue;
        recycleToPlaceholder(handle, opts.cache);
      }
    },
    { root: section, rootMargin: EXIT_ROOT_MARGIN },
  );

  // Observe every box. The trailing +Note tile is NOT observed (it has no
  // preview/placeholder duality).
  for (const h of handlesByEl.values()) {
    enterObserver.observe(h.el);
    exitObserver.observe(h.el);
  }

  // ── Public handle ───────────────────────────────────────────────────────
  const panelHandle: StackPanelHandle = {
    el: section,
    listEl,
    addNote(handle) {
      // Insert before the trailing +Note tile.
      listEl.insertBefore(handle.el, addBtn);
      handlesByEl.set(handle.el, handle);
      handlesByPath.set(handle.notePath, handle);
      enterObserver.observe(handle.el);
      exitObserver.observe(handle.el);
    },
    removeNote(notePath) {
      const handle = handlesByPath.get(notePath);
      if (!handle) return;
      enterObserver.unobserve(handle.el);
      exitObserver.unobserve(handle.el);
      handle.el.remove();
      handlesByEl.delete(handle.el);
      handlesByPath.delete(notePath);
      opts.cache.invalidate(notePath);
    },
    setView,
    destroy() {
      enterObserver.disconnect();
      exitObserver.disconnect();
      handlesByEl.clear();
      handlesByPath.clear();
    },
  };

  // Restore the scroll position (FR-29 cousin — scroll restoration is in
  // step 16, but the option is plumbed here so the renderer can pass it
  // through on the first frame).
  if (opts.initialScrollTop !== undefined) {
    queueMicrotask(() => {
      section.scrollTop = opts.initialScrollTop!;
    });
  }

  return panelHandle;
}

/**
 * Enumerate immediate `.md` children of a Stack folder via the vault
 * index. Excludes `_folder.md` (which carries the Stack's metadata,
 * not a notecard). Returns basenames (`Foo.md`) so they match the
 * shape of `stackMeta.value.order` entries.
 */
function listStackImmediateNoteFilenames(
  stackPath: string,
  vaultIndex: import("../../../lib/vault-types").VaultIndex | null,
): string[] {
  if (!vaultIndex) return [];
  const prefix = stackPath.replace(/\/+$/, "") + "/";
  // The composite file is named after the folder and lives at the
  // root of the Stack. Filter it out so it doesn't appear as a tile
  // alongside the source notes. We filter by NAME match (rather than
  // by reading each .md's frontmatter) because the name is unique by
  // construction — `regenerateStackComposite` always writes to this
  // exact filename — and the cost of stat-reading every child to
  // check frontmatter would defeat the lazy-on-read intent.
  const folderName = prefix.replace(/\/$/, "").split("/").pop() ?? "";
  const compositeName = compositeFilename(folderName);
  const out: string[] = [];
  for (const entry of vaultIndex.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.path.slice(prefix.length).includes("/")) continue;
    if (entry.name === "_folder") continue;
    const filename = `${entry.name}.md`;
    if (filename === compositeName) continue;
    out.push(filename);
  }
  return out;
}

/**
 * Render the Stack's children as a simple table-list inside `host`.
 * Borrowed visual from the Table folder-view layout but kept inline
 * to avoid coupling the Collections panel to the full Folder View
 * renderer pipeline. Each row is clickable to open the note.
 *
 * Columns: Name, Modified. The order matches the file view (i.e.
 * the Stack's `order:` array, layered onto physical children).
 */
function renderStackTable(
  host: HTMLElement,
  stackPath: string,
  onNoteClick: (handle: NoteBoxHandle) => void,
  onReorderComplete?: () => void,
): void {
  host.replaceChildren();
  // Re-read the live vault index + meta so the table reflects any
  // recent reorder/move without depending on the panel's captured
  // closures.
  const vaultIndex = vaultManager.getVaultIndex();
  void (async () => {
    const stackMeta = await store.readStack(stackPath);
    const physical = listStackImmediateNoteFilenames(stackPath, vaultIndex);
    const order = stackMeta.ok ? stackMeta.value.order : [];
    const ordered = mergeOrderWithPhysical(order, physical);

    const table = document.createElement("table");
    table.className = "fv-collection-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    // Empty header for the drag-handle column.
    headRow.appendChild(document.createElement("th"));
    for (const label of ["Name", "Modified"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const filename of ordered) {
      const tr = document.createElement("tr");
      tr.className = "fv-collection-table-row";
      tr.dataset.path = filename;
      tr.dataset.dragLabel = filename.replace(/\.md$/, "");

      // ── Drag handle cell ──────────────────────────────────────────────────
      const handleTd = document.createElement("td");
      handleTd.className = "fv-collection-table-drag-handle";
      handleTd.setAttribute("aria-hidden", "true");
      handleTd.textContent = "⠿";
      tr.appendChild(handleTd);

      // ── Name cell ─────────────────────────────────────────────────────────
      const nameTd = document.createElement("td");
      nameTd.className = "fv-collection-table-name";
      nameTd.textContent = filename.replace(/\.md$/, "");
      tr.appendChild(nameTd);

      // ── Modified cell ─────────────────────────────────────────────────────
      const modTd = document.createElement("td");
      modTd.className = "fv-collection-table-modified";
      const notePath = `${stackPath.replace(/\/+$/, "")}/${filename}`;
      const indexEntry = vaultIndex?.entries.find((e) => e.path === notePath);
      if (indexEntry && indexEntry.modified > 0) {
        const d = new Date(indexEntry.modified);
        modTd.textContent = d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } else {
        modTd.textContent = "—";
      }
      tr.appendChild(modTd);

      // Click name cell → open the file in a new tab.
      nameTd.addEventListener("click", () => {
        const kind: NoteBoxKind = {
          kind: "canonical",
          stackPath,
          noteFilename: filename,
        };
        onNoteClick({
          el: tr,
          notePath,
          kind,
          state: "placeholder",
          lastRenderedHeight: null,
        });
      });

      // Drag-to-reorder — only activates from the drag handle cell.
      attachFolderItemDrag(
        tr,
        tbody,
        filename,
        ".fv-collection-table-row[data-path]",
        (orderedFilenames) => {
          const toIndex = orderedFilenames.indexOf(filename);
          if (toIndex < 0) return;
          void (async () => {
            await store.reorderNote(stackPath, filename, { toIndex });
            onReorderComplete?.();
          })();
        },
        { handleEl: handleTd, orientation: "vertical" },
      );

      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    host.appendChild(table);
  })();
}

/**
 * Layer the user's preferred `order:` on top of the physical filename
 * list. Known-head, unknown-auto-append, missing-drop — same semantics
 * as the Home canvas's `applyNameManualOrder`.
 */
function mergeOrderWithPhysical(
  order: readonly string[],
  physical: readonly string[],
): string[] {
  const physicalSet = new Set(physical);
  const seen = new Set<string>();
  const out: string[] = [];
  // Head: order entries that still exist physically, in declared sequence.
  for (const name of order) {
    if (physicalSet.has(name) && !seen.has(name)) {
      out.push(name);
      seen.add(name);
    }
  }
  // Tail: physical entries not yet listed, in vault-index order.
  for (const name of physical) {
    if (!seen.has(name)) {
      out.push(name);
      seen.add(name);
    }
  }
  return out;
}
