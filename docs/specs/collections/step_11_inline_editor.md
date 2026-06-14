---
title: "Step 11 — Inline Editor (persistent CM6 view)"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 11 — In-Place Edit Mode

## Goal

Mount a single persistent CodeMirror 6 `EditorView` into the currently-clicked framed box, commit edits on click-elsewhere/Esc/breadcrumb, and reparent the host element back when done. One EditorView per Stack panel, reused across clicks (1.8.E).

## Files touched

- **New** `src/plugins/file-browser/collections/inline-editor.ts`
- **New** `tests/collections/inline-editor.test.ts`

## Function signatures to add

```typescript
import type { EditorView } from "@codemirror/view";
import type { NoteBoxHandle } from "./note-box";

export interface InlineEditorHandle {
  /** Mount the editor into a box (commits any prior edit first). */
  mount(box: NoteBoxHandle, initialContent: string): Promise<void>;

  /** Commit pending edits to disk and unmount. */
  unmount(): Promise<void>;

  /** True when the editor is currently mounted into a box. */
  isMounted(): boolean;

  /** Path of the currently-edited note, or null. */
  currentPath(): string | null;

  /**
   * Destroy the EditorView and disconnect global listeners.
   * Called when the Stack panel is destroyed (navigation away,
   * tab close).
   */
  destroy(): void;
}

/**
 * Build the persistent editor. Lazily constructs the EditorView on
 * first `mount()` to avoid paying the ~30-50 ms init cost when the
 * user just browses Stacks without editing.
 *
 * `onSave` is called after each successful write — used by the
 * stack-panel renderer to invalidate the preview cache and re-render
 * the box's preview HTML.
 *
 * `onCommitError` is called if writeFile fails. The handle stays
 * mounted so the user can retry.
 */
export function createInlineEditor(opts: {
  readonly hostParent: HTMLElement;  // hidden parent the view lives in by default
  readonly onSave: (path: string, content: string) => void;
  readonly onCommitError: (path: string, error: unknown) => void;
}): InlineEditorHandle;
```

DOM lifecycle:

```
On createInlineEditor():
  hostParent (hidden) appends a <div class="fv-collection-inline-editor-host">

On mount(box, content):
  if (isMounted()) await unmount();           // commit prior box
  view = view ?? new EditorView({...extensions, doc: content});
  view.setState(EditorState.create({doc: content, extensions: [...]}));
  hostEl.parentElement === hostParent → hostEl is reparented to box.el's body div
  box.el's preview body div is hidden (display:none) while editor lives there
  view.focus()
  current = { box, originalContent: content }

On unmount():
  if (!current) return;
  const text = view.state.doc.toString();
  if (text !== current.originalContent) {
    await bridge.writeFile(current.box.notePath, text);
    onSave(current.box.notePath, text);
  }
  hostEl is reparented back to hostParent (hidden)
  current.box's preview body is shown again
  current.box.state = "rendered"
  current = null
```

## Failing tests to write FIRST

`tests/collections/inline-editor.test.ts`. Use the project's existing CM6 test plumbing (look at `tests/editor/` for the pattern).

| Test name | EC / FR | Asserts |
|---|---|---|
| `mount inserts EditorView into the box body` | FR-10 | box.el contains `.cm-editor` |
| `mount with no prior edit just opens cleanly` | FR-10 | isMounted() === true; currentPath() === notePath |
| `mount on box B after editing A first commits A` | EC-19 | bridge.writeFile called with A's path before B mounts |
| `mount on box B then unmount: only B's content is on disk` | EC-19 | exactly one writeFile per mount-unmount pair |
| `unmount with unchanged content does NOT write` | perf | bridge.writeFile not called when doc === originalContent |
| `unmount with changed content writes via bridge.writeFile` | FR-10 | call args = (path, new content) |
| `unmount fires onSave with the new content` | FR-10 | spy args match |
| `commit error keeps editor mounted; onCommitError called` | resilience | isMounted() still true after a failed write |
| `Escape inside the editor triggers unmount` | EC-19 | dispatched Escape keypress → bridge.writeFile fires |
| `currentPath returns null when unmounted` | basic | null between mounts |
| `destroy disposes EditorView and removes hostEl` | leak | view.destroy called; hostEl not in DOM |
| `reuses the same EditorView across multiple mount cycles` | perf, 1.8.E | view.constructor called exactly once across 5 mount/unmount pairs |
| `uses the same extension pack as the main tab editor` | C-10 | mocked extension list includes the project's live-preview + format extensions |

## Implementation outline

1. **Module state** (closure of `createInlineEditor`):
   ```typescript
   let view: EditorView | null = null;
   let hostEl: HTMLDivElement | null = null;
   let current: { box: NoteBoxHandle; originalContent: string } | null = null;
   ```
2. **Lazy init**:
   ```typescript
   function ensureView(initialContent: string): EditorView {
     if (view) return view;
     hostEl = document.createElement("div");
     hostEl.className = "fv-collection-inline-editor-host";
     opts.hostParent.appendChild(hostEl);
     view = new EditorView({
       state: EditorState.create({
         doc: initialContent,
         extensions: buildCollectionEditorExtensions(),
       }),
       parent: hostEl,
     });
     return view;
   }
   ```
3. **`buildCollectionEditorExtensions()`**: imports from `src/editor/extensions.ts` to compose the same pack used by tab editors. If the existing `extensions.ts` exposes a `buildCoreExtensions()` factory, call that; if not (it just builds Compartments at module load), extract the same set into a small helper or copy the array verbatim with a code comment pointing to live-preview.ts.
4. **`mount(box, content)`**:
   ```typescript
   if (current) await unmount();
   const v = ensureView(content);
   v.setState(EditorState.create({ doc: content, extensions: buildCollectionEditorExtensions() }));
   const bodyEl = box.el.querySelector(".fv-collection-note-box-body") as HTMLElement;
   bodyEl.style.display = "none";
   box.el.appendChild(hostEl!);     // reparent
   current = { box, originalContent: content };
   box.state = "editing";
   v.focus();
   ```
5. **`unmount`**:
   ```typescript
   if (!current || !view) return;
   const text = view.state.doc.toString();
   if (text !== current.originalContent) {
     try {
       const res = await bridge.writeFile(current.box.notePath, text);
       if (!res.ok) throw new Error(res.error ?? "write failed");
       opts.onSave(current.box.notePath, text);
     } catch (e) {
       opts.onCommitError(current.box.notePath, e);
       return; // keep mounted
     }
   }
   const bodyEl = current.box.el.querySelector(".fv-collection-note-box-body") as HTMLElement;
   opts.hostParent.appendChild(hostEl!);  // reparent home
   bodyEl.style.display = "";
   current.box.state = "rendered";
   current = null;
   ```
6. **Escape key**: register a keymap extension inside `buildCollectionEditorExtensions()`:
   ```typescript
   keymap.of([{ key: "Escape", run: () => { void unmount(); return true; } }]);
   ```
7. **`destroy`**: `view?.destroy(); hostEl?.remove();` reset state to null.

**Save trigger from outside**: callers that need to commit (renderer on breadcrumb click, panel destroy) call `unmount()`. The renderer also wires a global `mousedown` listener (capture phase) on its container to detect "click outside the editing box" — this is wired in step 12, not here.

## Refactor opportunities

If undo-across-mount-cycles becomes a complaint (DW-14), the persistent view can `EditorState.reconfigure` instead of full-state-replace, preserving history. Defer.

## Definition of Done

```bash
npm run test:run -- tests/collections/inline-editor.test.ts
```
Expected: 13 tests pass. Plugin rebuild required.
