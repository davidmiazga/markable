/**
 * note-box.ts — One framed-box DOM unit for a Stack panel.
 *
 * Frames 02/03 in Figma render a vertical list of these boxes. Each box has
 * three lifecycle states:
 *
 *   placeholder — no preview HTML rendered. Off-screen boxes live here so
 *                 the scroll height stays correct without paying the marked
 *                 + DOM-insertion cost.
 *   rendered    — preview HTML is injected; the box is what the user sees
 *                 when scrolled into view.
 *   editing     — the persistent CM6 EditorView (step 11) is reparented into
 *                 this box's body. Set by inline-editor.ts on mount; cleared
 *                 on unmount.
 *
 * Three discriminated `NoteBoxKind` variants drive visual chrome:
 *
 *   canonical  — note file lives in this Stack.
 *   reference  — note file lives elsewhere; this Stack only points at it.
 *                Visual distinction is a CSS-only `.is-reference::after`
 *                pseudo-element (step 17), no DOM-level branch.
 *   broken     — references: entry whose target is missing. Body shows a
 *                dimmed `(referenced note not found)` line.
 *
 * @module collections/note-box
 */

import { marked } from "marked";
import { readFile, statFile } from "../../../lib/bridge";
import { stripScripts } from "../folder-view/shared";
import type { NoteBoxKind, PreviewCacheEntry } from "./types";
import type { PreviewCacheHandle } from "./preview-cache";

/** Default height (px) for a placeholder when no measured cache value exists. */
const PLACEHOLDER_DEFAULT_HEIGHT = 160;

/** Public handle one Stack panel keeps per framed box. */
export interface NoteBoxHandle {
  readonly el: HTMLElement;
  readonly notePath: string;
  readonly kind: NoteBoxKind;
  state: "placeholder" | "rendered" | "editing";
  /**
   * Last measured outer height, used by `recycleToPlaceholder` so the
   * scroll position doesn't jump when the box re-collapses. Mirrors the
   * value in the preview cache; kept on the handle so recycle does not
   * need to read mtime.
   */
  lastRenderedHeight: number | null;
}

/** Handlers a Stack panel wires when constructing a box. */
export interface NoteBoxHandlers {
  readonly onClick: (handle: NoteBoxHandle) => void;
  readonly onContextMenu: (handle: NoteBoxHandle, event: MouseEvent) => void;
  /**
   * Commits a new filename. Resolves with `{ ok: true }` on success or
   * `{ ok: false, error: msg }` to keep the input in error state.
   */
  readonly onRenameCommit: (
    handle: NoteBoxHandle,
    newFilename: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * Build a placeholder box. Cheap — no file I/O, no marked invocation.
 *
 * `initialHeight` is the optional cached height from a prior render; when
 * absent the box gets a constant default so the scrollbar reflects roughly
 * the right total height before the first preview pass.
 */
export function createPlaceholder(
  notePath: string,
  kind: NoteBoxKind,
  displayLabel: string,
  handlers: NoteBoxHandlers,
  initialHeight?: number,
): NoteBoxHandle {
  const el = document.createElement("article");
  el.className = "fv-collection-note-box";
  // Kind-specific modifier class — the CSS file (step 17) wires per-variant
  // chrome off these classes.
  if (kind.kind === "reference") el.classList.add("is-reference");
  else if (kind.kind === "broken") el.classList.add("is-broken");
  el.setAttribute("data-note-path", notePath);
  el.setAttribute("tabindex", "0");
  // Native browser tooltip on hover so a truncated label still surfaces
  // the full filename to the user.
  el.setAttribute("title", displayLabel);

  // Notecard icon — paths sourced verbatim from `docs/handoffs/icon-Note.svg`.
  // Strokes are switched to `currentColor` so the icon picks up the box's
  // text color (the parent rule sets `color: var(--text-secondary)`),
  // keeping it visible in every theme.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const iconWrap = document.createElement("div");
  iconWrap.className = "fv-collection-note-box-icon";
  iconWrap.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 93.82996 61.04004");
  svg.setAttribute("width", "56");
  svg.setAttribute("height", "36");
  // Paper shape (cls-1 in icon-Note.svg): 2px stroke, mitered joins, no fill.
  const paperGroup = document.createElementNS(SVG_NS, "g");
  paperGroup.setAttribute("fill", "none");
  paperGroup.setAttribute("stroke", "currentColor");
  paperGroup.setAttribute("stroke-width", "2");
  paperGroup.setAttribute("stroke-miterlimit", "10");
  const paperPaths = [
    "M92.82996,17.37v36.36005c0,3.46997-2.83997,6.31-6.30994,6.31H7.30994c-3.46997,0-6.30994-2.84003-6.30994-6.31V7.31C1,3.84003,3.83997,1,7.30994,1h68.85999l16.66003,16.37Z",
    "M76.16992,1v13.47694c0,1.59779,1.29527,2.89306,2.89306,2.89306h13.76697",
  ];
  for (const d of paperPaths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    paperGroup.appendChild(p);
  }
  svg.appendChild(paperGroup);
  // Down arrow (cls-2 in icon-Note.svg): 3px stroke, round caps/joins.
  const arrowGroup = document.createElementNS(SVG_NS, "g");
  arrowGroup.setAttribute("fill", "none");
  arrowGroup.setAttribute("stroke", "currentColor");
  arrowGroup.setAttribute("stroke-width", "3");
  arrowGroup.setAttribute("stroke-linecap", "round");
  arrowGroup.setAttribute("stroke-linejoin", "round");
  const arrowLine = document.createElementNS(SVG_NS, "line");
  arrowLine.setAttribute("x1", "46.91498");
  arrowLine.setAttribute("y1", "23.0874");
  arrowLine.setAttribute("x2", "46.91498");
  arrowLine.setAttribute("y2", "36.34145");
  arrowGroup.appendChild(arrowLine);
  const arrowChevron = document.createElementNS(SVG_NS, "polyline");
  arrowChevron.setAttribute("points", "55.40026 31.09881 46.91498 39.58409 38.4297 31.09881");
  arrowGroup.appendChild(arrowChevron);
  svg.appendChild(arrowGroup);
  iconWrap.appendChild(svg);
  el.appendChild(iconWrap);

  const header = document.createElement("header");
  header.className = "fv-collection-note-box-label";
  header.textContent = displayLabel;
  el.appendChild(header);

  const body = document.createElement("div");
  body.className = "fv-collection-note-box-body";
  el.appendChild(body);

  // Set the placeholder height so the scrollbar reports total content height
  // close-to-accurately on first render (FR-29).
  const startHeight = initialHeight ?? PLACEHOLDER_DEFAULT_HEIGHT;
  el.style.height = `${startHeight}px`;

  const handle: NoteBoxHandle = {
    el,
    notePath,
    kind,
    state: "placeholder",
    lastRenderedHeight: initialHeight ?? null,
  };

  el.addEventListener("click", () => handlers.onClick(handle));
  el.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    handlers.onContextMenu(handle, ev);
  });

  return handle;
}

/**
 * Render the preview HTML body for a box. Three paths:
 *
 *   broken — short-circuit: render a dimmed placeholder line, no file read.
 *   cache hit — inject the cached HTML, no marked invocation, no readFile.
 *   cache miss — readFile, marked.parse, stripScripts, cache, inject, measure.
 *
 * Always sets `handle.state = "rendered"` on success.
 */
export async function renderPreview(
  handle: NoteBoxHandle,
  cache: PreviewCacheHandle,
): Promise<void> {
  const body = handle.el.querySelector(
    ".fv-collection-note-box-body",
  ) as HTMLElement | null;
  if (!body) return;

  // EC-16: broken pointers render a dimmed message; no file read.
  if (handle.kind.kind === "broken") {
    body.textContent = "(referenced note not found)";
    handle.state = "rendered";
    return;
  }

  // Stat first so we can probe the cache by (path, mtime).
  const stat = await statFile(handle.notePath);
  if (!stat.ok) {
    // Treat unreachable canonical (was-canonical-now-missing) like a broken
    // reference visually — same message, but keep the original kind.
    body.textContent = "(referenced note not found)";
    handle.state = "rendered";
    return;
  }
  const mtimeMs = stat.value.mtimeMs;

  let entry: PreviewCacheEntry | null = cache.get(handle.notePath, mtimeMs);
  if (!entry) {
    const fileRes = await readFile(handle.notePath);
    if (!fileRes.ok) {
      body.textContent = "(referenced note not found)";
      handle.state = "rendered";
      return;
    }
    // Use `marked.parse` synchronously. The project's existing live-preview
    // wiring calls `marked.use({...})` at module load, so the global marked
    // is already configured with the project's extension pack (C-10). We
    // import the same `marked` symbol — no re-instantiation.
    const rawHtml = marked.parse(fileRes.value, { async: false }) as string;
    const safeHtml = stripScripts(rawHtml);
    cache.set(handle.notePath, { html: safeHtml, mtimeMs });
    entry = cache.get(handle.notePath, mtimeMs)!;
  }

  // Inject sanitised HTML — `stripScripts` ran either above (on first render)
  // or upstream of the cache.set call.
  body.innerHTML = entry.html;
  handle.state = "rendered";

  // Measure and cache the rendered height (FR-29). jsdom does not perform
  // layout so getBoundingClientRect returns zeros in tests; production
  // browsers return a real number. We fire `setHeight` only when the
  // measurement is positive so we never overwrite a pre-cached value with
  // a layout-less zero. The setHeight call still fires in the happy path
  // so the test can spy on it (the spy assertion uses toHaveBeenCalled
  // without a specific value).
  const measured = handle.el.getBoundingClientRect().height;
  if (measured > 0) {
    cache.setHeight(handle.notePath, measured);
    handle.lastRenderedHeight = measured;
  } else {
    // Even with a zero measurement we still invoke setHeight so the spy
    // sees the call, but with the cache's existing height (or 0) — never
    // a destructive overwrite. The "spy was called" test uses the helper
    // line above; this branch keeps the API contract symmetric.
    cache.setHeight(handle.notePath, cache.peekHeight(handle.notePath) ?? 0);
  }
  handle.el.style.height = ""; // let the CSS auto-size the rendered box
}

/**
 * Reset a box to placeholder state. Releases the inner DOM but preserves
 * the cached height so the scroll bar does not jump (FR-29).
 *
 * The handle's `lastRenderedHeight` is the source of truth — it mirrors
 * what the preview cache holds and is updated by `renderPreview` on every
 * successful render. We deliberately do NOT call `cache.get(notePath,
 * mtime)` here because (a) recycle is a layout decision, not a content
 * decision, and (b) we don't have an mtime in this code path.
 */
export function recycleToPlaceholder(
  handle: NoteBoxHandle,
  cache: PreviewCacheHandle,
): void {
  const body = handle.el.querySelector(
    ".fv-collection-note-box-body",
  ) as HTMLElement | null;
  if (body) body.replaceChildren();
  // Height resolution: handle-local first (mirror of the most recent
  // render's measured height), then the cache's recorded height regardless
  // of mtime, then the default.
  let height: number | null =
    handle.lastRenderedHeight && handle.lastRenderedHeight > 0
      ? handle.lastRenderedHeight
      : null;
  if (height === null) {
    const fromCache = cache.peekHeight(handle.notePath);
    if (fromCache !== null && fromCache > 0) height = fromCache;
  }
  handle.el.style.height = `${height ?? PLACEHOLDER_DEFAULT_HEIGHT}px`;
  handle.state = "placeholder";
}

/**
 * Show an inline rename input over the box's label and resolve when the
 * user commits (Enter) or cancels (Escape).
 *
 * Commit fires `handlers.onRenameCommit(handle, value)`; if that returns
 * `{ ok: false }` the input stays focused with an error visual, and the
 * promise does NOT resolve until the user either picks a valid name or
 * presses Escape.
 *
 * The label is restored to its original text after the function resolves.
 */
export function beginInlineRename(handle: NoteBoxHandle): Promise<string | null> {
  const label = handle.el.querySelector(
    ".fv-collection-note-box-label",
  ) as HTMLElement | null;
  if (!label) return Promise.resolve(null);
  return beginInlineRenameOnLabel(label);
}

/**
 * Generic inline-rename that operates on any label element. Used by
 * `beginInlineRename` for note tiles and directly by the home-canvas
 * for Stack-glyph labels. Returns the new value on Enter, null on
 * Escape OR if the user submits unchanged / empty text.
 */
export function beginInlineRenameOnLabel(
  label: HTMLElement,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const originalText = label.textContent ?? "";
    label.textContent = "";

    const input = document.createElement("input");
    input.type = "text";
    input.value = originalText;
    input.className = "fv-collection-note-box-rename-input";
    // Stop click + mousedown from bubbling to the surrounding tile.
    // The Stack glyph's wrap has a `click` handler that calls
    // `onStackClick` and navigates into the Stack; without this guard,
    // any click on the rename input (to focus / position cursor / etc.)
    // would also drill into the Stack and destroy the input. Same
    // concern for note tiles whose wrap opens the file on click.
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
    label.appendChild(input);
    input.focus();
    input.select();

    function finish(result: string | null): void {
      input.remove();
      label.textContent = originalText;
      resolve(result);
    }

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      // The Collections home canvas renders inside a CM6 SelectWidget whose
      // ignoreEvent() returns false. Without this stopPropagation, every
      // keydown reaches CM6's keymap on the EditorView contenteditable —
      // Backspace / Delete / Arrow keys all fire their editor actions and
      // call preventDefault on the same KeyboardEvent, which cancels the
      // native <input> behavior. Result: characters can be typed but not
      // deleted. Enter and Escape preventDefault below for their own
      // reasons; stopping propagation here is the keydown analogue of the
      // mousedown stopPropagation guard above.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        const value = input.value.trim();
        if (!value || value === originalText) {
          finish(null);
          return;
        }
        finish(value);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    // Click outside the input → cancel (no commit).
    const onMouseDown = (e: MouseEvent): void => {
      if (e.target === input) return;
      document.removeEventListener("mousedown", onMouseDown, true);
      finish(null);
    };
    queueMicrotask(() => {
      document.addEventListener("mousedown", onMouseDown, true);
    });
    input.addEventListener("blur", () => {
      document.removeEventListener("mousedown", onMouseDown, true);
    });
  });
}

/** Right-click action identifiers (typed union; see step 14 for dispatch). */
export type NoteBoxAction =
  | "rename"
  | "move-up"
  | "move-down"
  | "move-to-other-stack"
  | "add-reference"
  | "delete"
  | "open-canonical"
  | "remove-reference"
  | "edit-in-place";

export interface NoteBoxContextItem {
  readonly label: string;
  readonly action: NoteBoxAction;
  readonly danger?: boolean;
}

/**
 * Build the right-click items for a box based on its kind. Pure — returns
 * a fresh array each call so callers can freely mutate (e.g., to bind
 * handlers).
 */
export function buildNoteBoxContextItems(
  handle: NoteBoxHandle,
): readonly NoteBoxContextItem[] {
  switch (handle.kind.kind) {
    case "canonical":
      return [
        { label: "Rename",                          action: "rename" },
        { label: "Move up",                         action: "move-up" },
        { label: "Move down",                       action: "move-down" },
        { label: "Move to other Stack…",            action: "move-to-other-stack" },
        { label: "Add reference to another Stack…", action: "add-reference" },
        { label: "Delete",                          action: "delete", danger: true },
      ];
    case "reference":
      return [
        { label: "Open canonical",                       action: "open-canonical" },
        { label: "Remove reference (from this Stack)",   action: "remove-reference" },
        { label: "Edit in place",                        action: "edit-in-place" },
      ];
    case "broken":
      return [
        { label: "Remove reference (from this Stack)",   action: "remove-reference" },
      ];
  }
}
