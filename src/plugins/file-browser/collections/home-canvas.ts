/**
 * home-canvas.ts — Collections Home canvas (frame 01 + frame 04).
 *
 * Renders one of two states inside the panel container:
 *
 *   frame 01 (empty) — a centered dashed-border placeholder with a
 *                      `+ Notecard/Stack` button that opens the popover
 *                      from popover.ts.
 *   frame 04 (populated) — a flex-wrap grid mixing:
 *                          - Stack tiles (one per immediate subfolder of
 *                            the Collection root), and
 *                          - parent-folder note boxes (one per immediate
 *                            `.md` file, excluding `_folder.md`).
 *                          A trailing `+` affordance lets the user add
 *                          another Stack (note creation lives in the
 *                          empty-state popover and in the right-click menu).
 *
 * Refactor R05 (2026-06-06): tile rendering is now derived from the
 * filesystem (vault index), not from `stackOrder:` membership. The
 * `stackOrder:` field is repurposed as a manual ordering array — entries
 * listed in `stackOrder:` keep their relative order at the head of the
 * displayed list; unlisted subfolders auto-append in directory-listing
 * order; entries in `stackOrder:` that don't correspond to a real
 * subfolder are silently dropped. The no-write-on-read invariant is
 * preserved — the array on disk is only updated when the user mutates
 * the order (drag-reorder, rename, delete).
 *
 * Reuses the prerequisite folder-icon-assignment feature for icon rendering:
 *   - `interpretIconValue(value)` discriminates catalog vs custom-SVG vs
 *     fallback.
 *   - `getFolderIconClass(value)` returns the appropriate `folder-icon-*`
 *     CSS class.
 *   - Custom-SVG paths emit a `data-icon-path` attribute so the existing
 *     post-mount sanitised SVG injection pass (in file-browser.plugin.ts)
 *     picks them up unchanged.
 *
 * @module collections/home-canvas
 */

import * as store from "./store";
import * as vaultManager from "../../../lib/vault-manager";
import { showNotecardStackPopover } from "./popover";
import { createAddCircleAffordance } from "./affordances";
import {
  createPlaceholder,
  type NoteBoxHandle,
  type NoteBoxHandlers,
} from "./note-box";
import type { NoteBoxKind } from "./types";
import type { VaultIndex } from "../../../lib/vault-types";
import { attachFolderItemDrag } from "../folder-view/folder-item-drag";

/**
 * Public handler bundle the renderer wires to navigation + commands.
 *
 * Refactor R05: added `onNoteClick` and `onNoteContextMenu` so the Home
 * canvas can route clicks on parent-folder note boxes through the
 * renderer's existing inline-editor mount path (the same path used by
 * the Stack panel for its own note boxes).
 */
export interface HomeCanvasOptions {
  readonly collectionPath: string;
  readonly onStackClick: (stackPath: string) => void;
  readonly onCreateStack: () => Promise<void>;
  readonly onCreateNotecard: () => Promise<void>;
  // Refactor R05 — note-box handlers for the parent's own .md files.
  readonly onNoteClick: (handle: NoteBoxHandle) => void;
  readonly onNoteContextMenu: (handle: NoteBoxHandle, event: MouseEvent) => void;
  readonly onStackRename: (stackPath: string, newName: string) => Promise<void>;
  readonly onStackReorder: (stackPath: string, direction: "up" | "down") => Promise<void>;
  readonly onStackDelete: (stackPath: string) => Promise<void>;
  readonly onStackSetIcon: (stackPath: string) => void;
  /**
   * Drop-on-Stack handler — fired when a parent-folder note is dragged
   * onto a Stack tile. The renderer should move the file into the Stack
   * folder, reload the vault index, and re-render the Home canvas.
   * Optional so the home-canvas module can be rendered standalone in
   * tests without wiring move plumbing.
   */
  readonly onMoveNoteIntoStack?: (notePath: string, targetStackPath: string) => void;
  /**
   * Right-click on a Stack tile. The renderer typically shows a
   * context menu (Rename, Delete, etc.). `labelEl` is the tile's
   * label element so the menu can wire inline-rename in-place
   * without a second querySelector traversal.
   */
  readonly onStackContextMenu?: (
    stackPath: string,
    stackFolderName: string,
    labelEl: HTMLElement,
    ev: MouseEvent,
  ) => void;
  /**
   * Fired after the user drag-reorders a tile (note or Stack) and the
   * new order has been persisted to `_folder.md`. The renderer should
   * re-render the Home canvas so the visible tile order matches the
   * persisted state. Without this hook, the drag util fires the
   * reorder callback but the DOM stays where it was (the util shows a
   * ghost + insertion line but never mutates the source's position).
   */
  readonly onReorderComplete?: () => void;
}

/**
 * Internal data shape for one Stack tile on the Home canvas.
 * Composed by `loadStackGlyphs` from the filesystem listing plus each
 * subfolder's `_folder.md` metadata (or defaults when absent).
 */
interface StackGlyphData {
  readonly stackPath: string;
  readonly stackFolderName: string;
  readonly displayName: string;
  readonly iconValue: string;
  readonly noteCount: number;
}

/**
 * The context-menu items offered by right-clicking a Stack glyph (FR-14).
 *
 * Returned as a pure data list so tests can assert the exact set without
 * mocking the file-browser's contextual menu plumbing. The action strings
 * are dispatched by the renderer to the appropriate store/command call.
 */
export interface StackGlyphContextItem {
  readonly label: string;
  readonly action:
    | "rename"
    | "move-up"
    | "move-down"
    | "set-icon"
    | "delete";
}

/**
 * Pure helper exposed for tests. The renderer adds these to a context-menu
 * popup via the file-browser's existing showContextMenu helper.
 */
export function buildStackGlyphContextItems(): readonly StackGlyphContextItem[] {
  return [
    { label: "Rename",          action: "rename"   },
    { label: "Move up",         action: "move-up"  },
    { label: "Move down",       action: "move-down" },
    { label: "Set folder icon…", action: "set-icon" },
    { label: "Delete",          action: "delete"   },
  ];
}

/**
 * List the immediate subfolders of `collectionPath` from the vault index.
 *
 * Returns absolute subfolder paths in vault-index order. Subfolders are
 * those entries in `vaultIndex.directories` whose path is exactly one
 * `/`-separated segment deeper than `collectionPath`.
 *
 * Pure read — no `_folder.md` parsing here.
 */
function listImmediateSubfolders(
  collectionPath: string,
  vaultIndex: VaultIndex | null,
): string[] {
  if (!vaultIndex) return [];
  const prefix = collectionPath.replace(/\/+$/, "") + "/";
  const out: string[] = [];
  for (const dir of vaultIndex.directories ?? []) {
    const p = typeof dir === "string" ? dir : (dir as { path?: string }).path ?? "";
    if (!p.startsWith(prefix)) continue;
    // Immediate child: no further `/` after the prefix.
    if (p.slice(prefix.length).includes("/")) continue;
    out.push(p);
  }
  return out;
}

/**
 * List the immediate `.md` files of `collectionPath` from the vault index.
 *
 * Returns each entry as `{ path, filename }` where `filename` is the basename
 * with the `.md` extension restored (the vault index stores filename stems).
 * Excludes `_folder.md` (FR-23) so the sidecar never leaks into the rendered
 * note-box list.
 */
function listImmediateNotes(
  collectionPath: string,
  vaultIndex: VaultIndex | null,
): { path: string; filename: string }[] {
  if (!vaultIndex) return [];
  const prefix = collectionPath.replace(/\/+$/, "") + "/";
  const out: { path: string; filename: string }[] = [];
  for (const entry of vaultIndex.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    // Immediate child only.
    if (entry.path.slice(prefix.length).includes("/")) continue;
    // FR-23: exclude `_folder.md` from the rendered list.
    if (entry.name === "_folder") continue;
    // Vault index stores `name` as the stem (no extension). For Markable
    // notes this means we always append `.md` to derive the filename.
    const filename = `${entry.name}.md`;
    out.push({ path: entry.path, filename });
  }
  return out;
}

/**
 * Apply a manual order (head from `order`, tail in natural index order,
 * unknown entries dropped) to a list of string identifiers.
 *
 * Mirrors the semantics of `applyManualOrder` from `folder-view/renderer.ts`
 * but operates on string ids rather than FolderCard objects. Used by the
 * Home canvas to layer `stackOrder` (subfolder basenames) on top of the
 * directory-listing order returned by `listImmediateSubfolders`.
 *
 * Behaviour:
 *   - Entries in `order` that exist in `names` are emitted first, in
 *     `order` declared sequence.
 *   - Entries in `names` that aren't in `order` are emitted last, in
 *     original `names` order.
 *   - Entries in `order` that don't appear in `names` are dropped
 *     silently (handles the stale `stackOrder` case).
 *
 * Pure. No I/O.
 */
function applyNameManualOrder(
  names: readonly string[],
  order: readonly string[],
): string[] {
  if (order.length === 0) return [...names];
  const present = new Set<string>(names);
  const head: string[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (!present.has(id)) continue;        // stale entry — drop
    if (seen.has(id)) continue;            // duplicate — skip
    head.push(id);
    seen.add(id);
  }
  const tail = names.filter((n) => !seen.has(n));
  return [...head, ...tail];
}

/**
 * Build the per-Stack data for the displayed tiles.
 *
 * Iterates the filesystem subfolder list, applies the user's manual order
 * from `stackOrder`, then reads each Stack's `_folder.md` (defaults if
 * absent or malformed). Returns one `StackGlyphData` per displayed tile.
 */
/**
 * Count immediate `.md` children of a Stack folder via the vault index,
 * excluding `_folder.md`. Used to compute the badge count on a Stack
 * tile from disk truth rather than from the `_folder.md` `order:`
 * array (which can lag behind when notes are dropped in via drag).
 */
function countStackPhysicalNotes(
  stackPath: string,
  vaultIndex: VaultIndex | null,
): number {
  if (!vaultIndex) return 0;
  const prefix = stackPath.replace(/\/+$/, "") + "/";
  let n = 0;
  for (const entry of vaultIndex.entries) {
    if (!entry.path.startsWith(prefix)) continue;
    if (entry.path.slice(prefix.length).includes("/")) continue;
    if (entry.name === "_folder") continue;
    n += 1;
  }
  return n;
}

async function loadStackGlyphs(
  collectionPath: string,
  manualOrder: readonly string[],
  vaultIndex: VaultIndex | null,
): Promise<StackGlyphData[]> {
  const subfolderPaths = listImmediateSubfolders(collectionPath, vaultIndex);
  const collectionRoot = collectionPath.replace(/\/+$/, "");
  const subfolderNames = subfolderPaths.map((p) =>
    p.slice(collectionRoot.length + 1),
  );

  // Layer the user's manual order over the directory listing.
  const orderedNames = applyNameManualOrder(subfolderNames, manualOrder);

  const out: StackGlyphData[] = [];
  for (const folderName of orderedNames) {
    const stackPath = `${collectionRoot}/${folderName}`;
    // `readStack` falls back to default StackMeta (icon: notebook, empty
    // order/references) when the subfolder has no `_folder.md` or the
    // frontmatter is malformed (EC-5 / EC-6).
    const meta = await store.readStack(stackPath);
    if (!meta.ok) continue;
    // Count physical .md children of the Stack folder via the vault
    // index (excluding `_folder.md`), then add references on top. Using
    // the filesystem as the source of truth means a file dropped into
    // the Stack via drag (or moved in via Finder) increments the badge
    // immediately on next render — even if the Stack's `order:` array
    // hasn't been updated yet. Mirrors `listStackImmediateNoteFilenames`
    // in stack-panel.ts.
    const physicalNoteCount = countStackPhysicalNotes(stackPath, vaultIndex);
    out.push({
      stackPath,
      stackFolderName: folderName,
      displayName: meta.value.displayName,
      iconValue: meta.value.icon,
      noteCount: physicalNoteCount + meta.value.references.length,
    });
  }
  return out;
}

/**
 * Top-level entry point for the Home canvas (frame 01 + frame 04).
 *
 * Reads the Collection's metadata via the store, lists the parent's
 * immediate subfolders + immediate `.md` files from the vault index, and
 * renders either the empty-state placeholder (no children) or the mixed
 * grid (Stack tiles + note boxes + trailing `+` affordance).
 *
 * `container` is fully replaced — the renderer is the sole owner of its
 * DOM subtree.
 */
export async function renderHomeCanvas(
  container: HTMLElement,
  opts: HomeCanvasOptions,
): Promise<void> {
  container.replaceChildren();
  // Defensively refresh the vault index before reading children. The
  // file watcher SHOULD keep the index in sync with disk, but if any
  // event is missed (e.g. a file moved/deleted via Finder while the app
  // was backgrounded) we'd render phantom tiles for files that no
  // longer exist. One IPC call per render is a small cost for
  // "what's shown is what's on disk".
  await vaultManager.reloadVaultIndex();
  const meta = await store.readCollection(opts.collectionPath);
  const stackOrder = meta.ok ? meta.value.stackOrder : [];
  const noteOrder = meta.ok ? meta.value.noteOrder : [];
  const childOrder = meta.ok ? meta.value.childOrder : [];
  const vaultIndex = vaultManager.getVaultIndex();

  const glyphs = await loadStackGlyphs(opts.collectionPath, stackOrder, vaultIndex);
  const physicalNotes = listImmediateNotes(opts.collectionPath, vaultIndex);
  // Per-type fallback ordering — used when childOrder is empty (the
  // legacy stacks-first-then-notes layout). When childOrder IS set, we
  // ignore stackOrder / noteOrder for display: the combined order wins.
  const noteFilenames = physicalNotes.map((n) => n.filename);
  const orderedNoteFilenames = applyNameManualOrder(noteFilenames, noteOrder);
  const noteByFilename = new Map(physicalNotes.map((n) => [n.filename, n]));
  const notes = orderedNoteFilenames
    .map((fn) => noteByFilename.get(fn))
    .filter((n): n is { path: string; filename: string } => n !== undefined);

  // Single header line — "🏠 <folder-name>" with a thin divider below.
  // No bordered container around the grid; the tiles supply their own
  // visual via the embedded SVG icons (icon-Note / icon-AddNote).
  const folderName = opts.collectionPath.split("/").pop() ?? opts.collectionPath;
  const header = document.createElement("div");
  header.className = "fv-collection-home-header";
  container.appendChild(header);

  // Inline home glyph — currentColor so the theme drives the visible color.
  const homeIconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  homeIconSvg.setAttribute("viewBox", "0 0 24 24");
  homeIconSvg.setAttribute("width", "16");
  homeIconSvg.setAttribute("height", "16");
  homeIconSvg.setAttribute("aria-hidden", "true");
  homeIconSvg.classList.add("fv-collection-home-icon");
  const homePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  homePath.setAttribute("d", "M12 3l-9 8h3v8h6v-6h0v0h0v6h6v-8h3l-9-8z");
  homePath.setAttribute("fill", "currentColor");
  homeIconSvg.appendChild(homePath);
  header.appendChild(homeIconSvg);

  const titleEl = document.createElement("span");
  titleEl.className = "fv-collection-home-title";
  titleEl.textContent = folderName;
  header.appendChild(titleEl);

  // EC-9 / FR-14: with zero subfolders AND zero parent notes, show the
  // frame-01 empty state. The `+ Notecard/Stack` popover is the only way
  // to seed content in this state.
  if (glyphs.length === 0 && notes.length === 0) {
    container.appendChild(renderEmptyState(opts));
    return;
  }

  const grid = document.createElement("div");
  grid.className = "fv-collection-glyph-grid";

  // Mixed selector for `attachFolderItemDrag` — both shapes are siblings
  // in the same `grid` container, so the drag util enumerates the
  // combined sequence when computing the new order. The combined
  // selector must match every draggable element AND its data-path.
  const homeItemSelector =
    ".fv-collection-stack-glyph[data-path], .fv-collection-note-box[data-path]";

  // Build the COMBINED render sequence. If childOrder is non-empty,
  // it's the source of truth — Stacks and notes interleave freely in
  // the user's manual order. Unknown items (newly created since the
  // last drag) auto-append at the tail. When childOrder is empty,
  // fall back to "stacks first, then notes" — the legacy layout that
  // existed before this combined-order feature.
  const stackByName = new Map(glyphs.map((g) => [g.stackFolderName, g]));
  const noteByName = new Map(notes.map((n) => [n.filename, n]));
  const allIds = [...stackByName.keys(), ...noteByName.keys()];
  const renderSequence: Array<{ kind: "stack"; data: StackGlyphData } | { kind: "note"; note: { path: string; filename: string } }> = [];
  const seen = new Set<string>();
  if (childOrder.length > 0) {
    for (const id of childOrder) {
      if (seen.has(id)) continue;
      const stackData = stackByName.get(id);
      if (stackData) {
        renderSequence.push({ kind: "stack", data: stackData });
        seen.add(id);
        continue;
      }
      const note = noteByName.get(id);
      if (note) {
        renderSequence.push({ kind: "note", note });
        seen.add(id);
      }
      // Missing entries (deleted children) silently dropped.
    }
    // Auto-append any items not yet in childOrder — preserves the
    // "new items appear, then settle into the user's order on next
    // drag" behavior.
    for (const id of allIds) {
      if (seen.has(id)) continue;
      const stackData = stackByName.get(id);
      if (stackData) renderSequence.push({ kind: "stack", data: stackData });
      const note = noteByName.get(id);
      if (note) renderSequence.push({ kind: "note", note });
    }
  } else {
    // Legacy fallback: stacks first (in stackOrder), then notes.
    for (const data of glyphs) renderSequence.push({ kind: "stack", data });
    for (const note of notes) renderSequence.push({ kind: "note", note });
  }

  // The drag callback for ANY tile (stack OR note) writes the full
  // sibling sequence to `childOrder` — the combined source of truth
  // so users can interleave stacks and notes however they like.
  const persistChildOrder = (orderedIds: readonly string[]): void => {
    void (async () => {
      await store.writeCollectionMeta(opts.collectionPath, {
        childOrder: [...orderedIds],
      });
      opts.onReorderComplete?.();
    })();
  };

  for (const entry of renderSequence) {
    if (entry.kind === "stack") {
      const data = entry.data;
      const tileEl = renderStackGlyph(data, opts);
      grid.appendChild(tileEl);
      attachFolderItemDrag(
        tileEl,
        grid,
        data.stackFolderName,
        homeItemSelector,
        (orderedIds) => {
          persistChildOrder(orderedIds);
        },
      );
      continue;
    }
    const note = entry.note;
    const noteEl = renderHomeNoteBox(note, opts);
    grid.appendChild(noteEl);
    attachFolderItemDrag(
      noteEl,
      grid,
      note.filename,
      homeItemSelector,
      (orderedIds) => {
        persistChildOrder(orderedIds);
      },
      {
        containerTargetSelector: ".fv-collection-stack-glyph[data-path]",
        onDropOnContainer: (targetEl) => {
          const stackBasename = targetEl.dataset.path;
          if (!stackBasename) return;
          const stackPath = `${opts.collectionPath.replace(/\/+$/, "")}/${stackBasename}`;
          void opts.onMoveNoteIntoStack?.(note.path, stackPath);
        },
      },
    );
  }

  // Trailing add-affordance tile — shared Collections "+" component.
  // Clicking opens the Note / Stack popover so the user picks WHICH
  // kind of thing to create. The icon-wrap returned by the helper is
  // used as the popover anchor: it sits where the user clicks (the
  // visible `+`), unlike the button rect which stretches to fill the
  // grid cell.
  const addBtn = createAddCircleAffordance({
    ariaLabel: "Add Note or Stack",
    onClick: (anchorEl) => {
      showNotecardStackPopover(anchorEl, {
        onStack: () => void opts.onCreateStack(),
        onNotecard: () => void opts.onCreateNotecard(),
      });
    },
  });
  grid.appendChild(addBtn);

  container.appendChild(grid);
}

/**
 * Build one Stack glyph: icon span + badge + label.
 *
 *   Click       → opts.onStackClick (drill into the Stack).
 *   Right-click → context-menu plumbing (wired in renderer.ts via
 *                 buildStackGlyphContextItems()).
 *
 * The wrap element carries `data-path = <subfolder basename>` so the
 * R06 drag wiring can read consistent IDs across tile + note-box
 * elements within the Home canvas grid. The legacy `data-stack-path`
 * attribute (absolute path) is preserved for any external integration
 * that reads it.
 */
function renderStackGlyph(
  data: StackGlyphData,
  opts: HomeCanvasOptions,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "fv-collection-stack-glyph";
  wrap.setAttribute("role", "button");
  wrap.setAttribute("tabindex", "0");
  // Canonical drag-target id (basename). Step_R06's `attachFolderItemDrag`
  // reads this attribute to compute the new order on drop.
  wrap.setAttribute("data-path", data.stackFolderName);
  // Legacy absolute-path attribute — kept for backward-compat with any
  // external code that may read it (e.g. test helpers, future telemetry).
  wrap.setAttribute("data-stack-path", data.stackPath);

  // Icon — sourced verbatim from `docs/handoffs/icon-Stack.svg`: five
  // curved stack lines (st1, round caps) + a top-card outline (st0).
  // Wrapped in the shared `.fv-collection-note-box-icon` so the 48px
  // height constraint aligns this tile's icon with sibling tiles
  // (note tiles, add affordance) inside the Home grid.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const iconWrap = document.createElement("div");
  iconWrap.className = "fv-collection-note-box-icon";
  iconWrap.setAttribute("aria-hidden", "true");
  const stackSvg = document.createElementNS(SVG_NS, "svg");
  stackSvg.setAttribute("viewBox", "0 0 93.8 61");
  stackSvg.setAttribute("width", "56");
  stackSvg.setAttribute("height", "36");
  // Stack-line group (st1 in icon-Stack.svg): 2px stroke, round caps.
  const stackLineGroup = document.createElementNS(SVG_NS, "g");
  stackLineGroup.setAttribute("fill", "none");
  stackLineGroup.setAttribute("stroke", "currentColor");
  stackLineGroup.setAttribute("stroke-width", "2");
  stackLineGroup.setAttribute("stroke-miterlimit", "10");
  stackLineGroup.setAttribute("stroke-linecap", "round");
  const stackLinePaths = [
    "M81.3,10.4c1.6.1,2.7,1.8,2.2,3.6l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4H6.2c-1.7,0-2.9-1.8-2.3-3.7l.2-.6",
    "M83.5,14.7c1.6.1,2.7,1.8,2.2,3.6l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4H8.4c-1.7,0-2.9-1.8-2.3-3.7l.2-.6",
    "M85.8,19.1c1.6.1,2.7,1.8,2.2,3.6l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4H10.6c-1.7,0-2.9-1.8-2.3-3.7l.2-.6",
    "M88,23.5c1.6.1,2.7,1.8,2.2,3.6l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4H12.9c-1.7,0-2.9-1.8-2.3-3.7l.2-.6",
    "M90.3,27.9c1.6.1,2.7,1.8,2.2,3.6l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4H15.1c-1.7,0-2.9-1.8-2.3-3.7l.2-.6",
  ];
  for (const d of stackLinePaths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    stackLineGroup.appendChild(p);
  }
  stackSvg.appendChild(stackLineGroup);
  // Top-card outline (st0): 2px stroke, no round caps.
  const topCard = document.createElementNS(SVG_NS, "path");
  topCard.setAttribute("fill", "none");
  topCard.setAttribute("stroke", "currentColor");
  topCard.setAttribute("stroke-width", "2");
  topCard.setAttribute("stroke-miterlimit", "10");
  topCard.setAttribute(
    "d",
    "M71.9,33.1H3.8c-1.7,0-2.9-1.8-2.3-3.7L7.6,8.4c.4-1.4,1.6-2.4,2.9-2.4h68.2c1.7,0,2.9,1.8,2.3,3.7l-6.2,21c-.4,1.4-1.6,2.4-2.9,2.4Z",
  );
  stackSvg.appendChild(topCard);
  iconWrap.appendChild(stackSvg);
  wrap.appendChild(iconWrap);

  // Badge — note count overlay (FR-13).
  const badge = document.createElement("span");
  badge.className = "fv-collection-badge";
  badge.textContent = String(data.noteCount);
  wrap.appendChild(badge);

  // Label below the glyph.
  const label = document.createElement("div");
  label.className = "fv-collection-stack-label";
  label.textContent = data.displayName;
  wrap.appendChild(label);

  // Click opens the Stack (FR-15).
  wrap.addEventListener("click", () => opts.onStackClick(data.stackPath));
  // Right-click — dispatch to the renderer's context-menu wiring. The
  // renderer owns the actual menu UI; the glyph just relays position
  // + identifiers. `label` is captured so the menu's Rename action
  // can inline-edit the label element directly.
  wrap.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    opts.onStackContextMenu?.(data.stackPath, data.stackFolderName, label, ev);
  });

  return wrap;
}

/**
 * Build a note-box placeholder for a parent-folder note (FR-10 group 2).
 *
 * Reuses `createPlaceholder` from note-box.ts — the same primitive the
 * Stack panel uses — so the click/context-menu/keyboard semantics are
 * identical to a Stack-panel note box. Preview rendering, when the
 * renderer's observer pipeline mounts it, happens via the existing
 * `renderPreview` / `recycleToPlaceholder` cycle.
 *
 * The element carries `data-path = <filename>` (basename, including `.md`)
 * so R06's drag wiring reads consistent ids alongside the Stack tiles.
 */
function renderHomeNoteBox(
  note: { path: string; filename: string },
  opts: HomeCanvasOptions,
): HTMLElement {
  // For Home-canvas notes, the kind is always "canonical" — the file is
  // homed in the parent folder itself. The renderer's inline-editor mount
  // path expects a canonical kind to read/write the file directly.
  const kind: NoteBoxKind = {
    kind: "canonical",
    stackPath: opts.collectionPath,
    noteFilename: note.filename,
  };
  const handlers: NoteBoxHandlers = {
    onClick: (handle) => opts.onNoteClick(handle),
    onContextMenu: (handle, ev) => opts.onNoteContextMenu(handle, ev),
    onRenameCommit: async () => ({ ok: true }),
  };
  // The display label strips `.md` for visual consistency with the Stack
  // panel's note-box labels.
  const displayLabel = note.filename.replace(/\.md$/, "");
  const handle = createPlaceholder(note.path, kind, displayLabel, handlers);
  // Override `data-note-path` (absolute) with `data-path` (basename) for
  // the drag system. Both attributes coexist — drag reads `data-path`;
  // the inline editor still reads `notePath` from the handle directly.
  handle.el.setAttribute("data-path", note.filename);
  return handle.el;
}

/**
 * Table-list view for the Home canvas. Mirrors `renderStackTable` in
 * stack-panel.ts: loads the same data as `renderHomeCanvas` but renders
 * Stacks and root notes as table rows instead of icon tiles.
 *
 * Columns: Name | Modified. Clicking a Stack row navigates into it;
 * clicking a note row opens it in a tab. Drag-to-reorder uses the
 * vertical insertion line via `attachFolderItemDrag` with `orientation:
 * "vertical"`.
 */
export async function renderHomeTable(
  container: HTMLElement,
  opts: HomeCanvasOptions,
): Promise<void> {
  container.replaceChildren();
  await vaultManager.reloadVaultIndex();
  const meta = await store.readCollection(opts.collectionPath);
  const stackOrder = meta.ok ? meta.value.stackOrder : [];
  const noteOrder = meta.ok ? meta.value.noteOrder : [];
  const childOrder = meta.ok ? meta.value.childOrder : [];
  const vaultIndex = vaultManager.getVaultIndex();

  const glyphs = await loadStackGlyphs(opts.collectionPath, stackOrder, vaultIndex);
  const physicalNotes = listImmediateNotes(opts.collectionPath, vaultIndex);
  const noteFilenames = physicalNotes.map((n) => n.filename);
  const orderedNoteFilenames = applyNameManualOrder(noteFilenames, noteOrder);
  const noteByFilename = new Map(physicalNotes.map((n) => [n.filename, n]));
  const notes = orderedNoteFilenames
    .map((fn) => noteByFilename.get(fn))
    .filter((n): n is { path: string; filename: string } => n !== undefined);

  // Render the same "🏠 <folder-name>" header as renderHomeCanvas so the
  // renderer can inject the view-toggle button in a consistent location.
  const folderName = opts.collectionPath.split("/").pop() ?? opts.collectionPath;
  const header = document.createElement("div");
  header.className = "fv-collection-home-header";
  const homeIconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  homeIconSvg.setAttribute("viewBox", "0 0 24 24");
  homeIconSvg.setAttribute("width", "16");
  homeIconSvg.setAttribute("height", "16");
  homeIconSvg.setAttribute("aria-hidden", "true");
  homeIconSvg.classList.add("fv-collection-home-icon");
  const homePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  homePath.setAttribute("d", "M12 3l-9 8h3v8h6v-6h0v0h0v6h6v-8h3l-9-8z");
  homePath.setAttribute("fill", "currentColor");
  homeIconSvg.appendChild(homePath);
  header.appendChild(homeIconSvg);
  const titleEl = document.createElement("span");
  titleEl.className = "fv-collection-home-title";
  titleEl.textContent = folderName;
  header.appendChild(titleEl);
  container.appendChild(header);

  // Build render sequence (same ordering logic as renderHomeCanvas).
  type Entry =
    | { kind: "stack"; data: StackGlyphData }
    | { kind: "note"; note: { path: string; filename: string } };
  const stackByName = new Map(glyphs.map((g) => [g.stackFolderName, g]));
  const noteByName = new Map(notes.map((n) => [n.filename, n]));
  const allIds = [...stackByName.keys(), ...noteByName.keys()];
  const renderSequence: Entry[] = [];
  const seen = new Set<string>();
  if (childOrder.length > 0) {
    for (const id of childOrder) {
      if (seen.has(id)) continue;
      const sd = stackByName.get(id);
      if (sd) { renderSequence.push({ kind: "stack", data: sd }); seen.add(id); continue; }
      const n = noteByName.get(id);
      if (n) { renderSequence.push({ kind: "note", note: n }); seen.add(id); }
    }
    for (const id of allIds) {
      if (seen.has(id)) continue;
      const sd = stackByName.get(id);
      if (sd) renderSequence.push({ kind: "stack", data: sd });
      const n = noteByName.get(id);
      if (n) renderSequence.push({ kind: "note", note: n });
    }
  } else {
    for (const g of glyphs) renderSequence.push({ kind: "stack", data: g });
    for (const n of notes) renderSequence.push({ kind: "note", note: n });
  }

  if (renderSequence.length === 0) {
    container.appendChild(renderEmptyState(opts));
    return;
  }

  const persistChildOrder = (orderedIds: readonly string[]): void => {
    void (async () => {
      await store.writeCollectionMeta(opts.collectionPath, {
        childOrder: [...orderedIds],
      });
      opts.onReorderComplete?.();
    })();
  };

  const wrap = document.createElement("div");
  wrap.className = "fv-collection-table-view";

  const table = document.createElement("table");
  table.className = "fv-collection-table";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th")); // drag handle
  for (const label of ["Name", "Modified"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  const homeItemSelector =
    ".fv-collection-table-row[data-path]";

  for (const entry of renderSequence) {
    const tr = document.createElement("tr");
    tr.className = "fv-collection-table-row";

    // ── Drag handle ───────────────────────────────────────────────────────
    const handleTd = document.createElement("td");
    handleTd.className = "fv-collection-table-drag-handle";
    handleTd.setAttribute("aria-hidden", "true");
    handleTd.textContent = "⠿";

    // ── Name cell ─────────────────────────────────────────────────────────
    const nameTd = document.createElement("td");
    nameTd.className = "fv-collection-table-name";

    // ── Modified cell ─────────────────────────────────────────────────────
    const modTd = document.createElement("td");
    modTd.className = "fv-collection-table-modified";

    if (entry.kind === "stack") {
      const { data } = entry;
      tr.dataset.path = data.stackFolderName;
      tr.dataset.dragLabel = data.displayName;
      nameTd.textContent = data.displayName;
      modTd.textContent = `${data.noteCount} note${data.noteCount === 1 ? "" : "s"}`;
      nameTd.addEventListener("click", () => opts.onStackClick(data.stackPath));
    } else {
      const { note } = entry;
      tr.dataset.path = note.filename;
      tr.dataset.dragLabel = note.filename.replace(/\.md$/, "");
      nameTd.textContent = note.filename.replace(/\.md$/, "");
      const idx = vaultIndex?.entries.find((e) => e.path === note.path);
      if (idx && idx.modified > 0) {
        modTd.textContent = new Date(idx.modified).toLocaleDateString(undefined, {
          year: "numeric", month: "short", day: "numeric",
        });
      } else {
        modTd.textContent = "—";
      }
      nameTd.addEventListener("click", () => opts.onNoteClick({
        el: tr,
        notePath: note.path,
        kind: { kind: "canonical", stackPath: opts.collectionPath, noteFilename: note.filename },
        state: "placeholder",
        lastRenderedHeight: null,
      }));
    }

    tr.appendChild(handleTd);
    tr.appendChild(nameTd);
    tr.appendChild(modTd);
    tbody.appendChild(tr);

    attachFolderItemDrag(
      tr,
      tbody,
      tr.dataset.path!,
      homeItemSelector,
      persistChildOrder,
      { handleEl: handleTd, orientation: "vertical" },
    );
  }

  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

/**
 * Build the empty-state placeholder (frame 01).
 */
function renderEmptyState(opts: HomeCanvasOptions): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "fv-collection-empty-state";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fv-collection-empty-state-button";
  btn.textContent = "+ Notecard/Stack";
  btn.addEventListener("click", () => {
    showNotecardStackPopover(btn, {
      onStack: () => void opts.onCreateStack(),
      onNotecard: () => void opts.onCreateNotecard(),
    });
  });
  wrap.appendChild(btn);

  return wrap;
}
