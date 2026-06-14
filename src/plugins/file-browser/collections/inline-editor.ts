/**
 * inline-editor.ts — Persistent CM6 EditorView reparented between framed boxes.
 *
 * The architecture (1.8.E): a single `EditorView` is constructed lazily on
 * first `mount()` and **reused** across every subsequent click. Switching
 * boxes reparents the same host element from one box body to another and
 * resets the editor's document to the new file's content. The cost of a
 * fresh `new EditorView(...)` is ~30-50 ms on the dev machine; reparenting
 * is ~1 ms.
 *
 * Only ONE box is ever in edit mode at a time (EC-19). The state machine
 * lives in `mount()`:
 *
 *   PREVIEW ── mount(B) ──> EDIT(B)
 *   EDIT(A) ── mount(B) ──> [commit A] ── EDIT(B)
 *   EDIT(A) ── unmount() ──> [commit A] ── PREVIEW
 *
 * Commit semantics: when the unmount-time content differs from the
 * mount-time content, fire `bridge.writeFile(path, content)`. On a write
 * failure the editor STAYS mounted so the user can retry — no data loss.
 *
 * Save fan-out (to invalidate the preview cache and re-render the box) is
 * the renderer's job (step 12 hooks `onSave`).
 *
 * Testability: the EditorView constructor is dependency-injected. Tests
 * supply a fake factory; production code uses the default factory that
 * builds a real CodeMirror 6 view using the project's existing extension
 * pack from `src/editor/extensions.ts` (C-10).
 *
 * @module collections/inline-editor
 */

import { writeFile } from "../../../lib/bridge";
import type { NoteBoxHandle } from "./note-box";

/**
 * Minimal interface the inline-editor needs from a CodeMirror 6 view.
 * Production = the real EditorView (which satisfies these methods through
 * `view.state.doc.toString()`, `view.dispatch(...)`, `view.focus()`,
 * `view.destroy()`). The default factory wraps a real view to fit this
 * smaller surface so tests can substitute a fake.
 */
export interface InlineEditorView {
  /** Read the current document text. */
  getDoc(): string;
  /** Replace the document text (used on box-switch). */
  setState(newDoc: string): void;
  /** Focus the editor (called after mount so typing lands immediately). */
  focus(): void;
  /** Release CM6 resources. */
  destroy(): void;
}

/** Signature of the factory the inline editor calls on first mount. */
export type EditorViewFactory = (
  initialContent: string,
  parent: HTMLElement,
) => InlineEditorView;

/** Public surface of one inline editor instance. */
export interface InlineEditorHandle {
  mount(box: NoteBoxHandle, initialContent: string): Promise<void>;
  unmount(): Promise<void>;
  isMounted(): boolean;
  currentPath(): string | null;
  destroy(): void;
  /**
   * Test-only convenience: simulate a typing event by overwriting the
   * editor's current document text. Mirrors what a real user keystroke
   * does internally. Exposed via the same interface so tests can use it
   * without typing-cast gymnastics.
   */
  _setDoc(text: string): void;
}

export interface CreateInlineEditorOpts {
  readonly hostParent: HTMLElement;
  readonly onSave: (path: string, content: string) => void;
  readonly onCommitError: (path: string, error: unknown) => void;
  /**
   * Optional dependency-injected factory. When omitted, the production
   * factory builds a real EditorView wired to the project's extension
   * pack from `src/editor/extensions.ts` (C-10).
   */
  readonly viewFactory?: EditorViewFactory;
}

/**
 * Factory for one inline-editor instance.
 *
 * The view is constructed lazily on first mount so we don't pay the
 * ~30-50 ms instantiation cost when the user just browses a Stack
 * without ever clicking a box.
 */
export function createInlineEditor(
  opts: CreateInlineEditorOpts,
): InlineEditorHandle {
  let view: InlineEditorView | null = null;
  let hostEl: HTMLDivElement | null = null;
  let current: { box: NoteBoxHandle; originalContent: string } | null = null;

  /**
   * Lazily build the EditorView. The host is parked under `hostParent`
   * (typically a hidden div on the renderer's tab container) when nothing
   * is being edited; on mount we reparent the host into the active box.
   */
  function ensureView(initialContent: string): InlineEditorView {
    if (view) {
      view.setState(initialContent);
      return view;
    }
    hostEl = document.createElement("div");
    hostEl.className = "fv-collection-inline-editor-host";
    opts.hostParent.appendChild(hostEl);
    const factory = opts.viewFactory ?? defaultViewFactory;
    view = factory(initialContent, hostEl);
    return view;
  }

  async function mount(box: NoteBoxHandle, initialContent: string): Promise<void> {
    // EC-19: only one box can be in edit mode. If another box is currently
    // being edited, commit it first.
    if (current) await unmount();
    const v = ensureView(initialContent);
    // If the view existed already, ensureView called setState above; if
    // not, the factory built it with `initialContent`. Either way, the
    // doc now matches the new file.
    const body = box.el.querySelector(
      ".fv-collection-note-box-body",
    ) as HTMLElement | null;
    if (!body || !hostEl) return;
    // Hide the preview body, reparent the editor host into the box. The
    // body itself is restored on unmount.
    body.style.display = "none";
    box.el.appendChild(hostEl);
    box.el.classList.add("is-editing");
    box.state = "editing";
    current = { box, originalContent: initialContent };
    v.focus();
  }

  async function unmount(): Promise<void> {
    if (!current || !view || !hostEl) return;
    const text = view.getDoc();
    if (text !== current.originalContent) {
      try {
        const res = await writeFile(current.box.notePath, text);
        if (!res.ok) {
          // Resilience: keep the editor mounted so the user can retry or
          // copy text out. NO data loss.
          opts.onCommitError(current.box.notePath, res.error);
          return;
        }
        opts.onSave(current.box.notePath, text);
      } catch (e) {
        opts.onCommitError(current.box.notePath, e);
        return;
      }
    }
    // Reparent the host back to its hidden home and restore the preview.
    const body = current.box.el.querySelector(
      ".fv-collection-note-box-body",
    ) as HTMLElement | null;
    opts.hostParent.appendChild(hostEl);
    if (body) body.style.display = "";
    current.box.el.classList.remove("is-editing");
    current.box.state = "rendered";
    current = null;
  }

  function isMounted(): boolean {
    return current !== null;
  }

  function currentPath(): string | null {
    return current ? current.box.notePath : null;
  }

  function destroy(): void {
    // Synchronously tear down. We do NOT commit on destroy — the renderer
    // is expected to call `unmount()` first if a save is needed (e.g.,
    // breadcrumb click). If the user closed the tab without saving, the
    // existing per-tab dirty-flag plumbing covers the prompt.
    if (view) view.destroy();
    if (hostEl) hostEl.remove();
    view = null;
    hostEl = null;
    current = null;
  }

  function _setDoc(text: string): void {
    if (view) view.setState(text);
  }

  return { mount, unmount, isMounted, currentPath, destroy, _setDoc };
}

// ── Default real-CM6 factory ──────────────────────────────────────────────────

/**
 * Build a real CodeMirror 6 EditorView wrapped into our smaller surface.
 *
 * Reuses the project's existing extension pack from `src/editor/extensions.ts`
 * (`buildExtensions()`) so the inline editor inherits live-preview, format
 * commands, list keybindings, and every other Markable editing feature
 * (C-10). Adds an Escape key binding that calls back into `unmount` via a
 * caller-provided escape hatch — but since the production factory has no
 * reference to the unmount function from this scope, the escape handling
 * is wired by the renderer (step 12) listening on the host element.
 *
 * Production callers omit `viewFactory`; this default is used.
 */
function defaultViewFactory(initialContent: string, parent: HTMLElement): InlineEditorView {
  // Dynamic import keeps the test bundle from pulling in CodeMirror modules
  // when only the dependency-injected fake is needed. The production build
  // resolves the imports at load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EditorView } = require("@codemirror/view") as typeof import("@codemirror/view");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EditorState } = require("@codemirror/state") as typeof import("@codemirror/state");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ext = require("../../../editor/extensions") as typeof import("../../../editor/extensions");
  const view = new EditorView({
    state: EditorState.create({ doc: initialContent, extensions: ext.buildExtensions() }),
    parent,
  });
  return {
    getDoc: () => view.state.doc.toString(),
    setState: (newDoc: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newDoc },
      });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
