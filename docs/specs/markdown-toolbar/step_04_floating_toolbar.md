---
title: "Step 04 — Floating Toolbar DOM and Positioning"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 04 — Floating Toolbar DOM and Positioning

**Prerequisite:** step_03 complete and passing.
**Produces:** `buildToolbarDOM`, `updatePosition`; `onEnable` wired for floating mode; plugin is visually testable in the running app.

---

## Goal

Build the toolbar DOM element and the positioning function for floating mode. After this step:
- The floating toolbar appears above the selection when the user selects text in the editor.
- The toolbar disappears when the selection is cleared.
- Viewport flip works: toolbar appears below the selection when there is no room above (EC-14).
- Button clicks are wired (they call `view.dispatch` with format changes) — though active-state highlighting is deferred to step_07, clicks must produce correct document changes.
- The plugin is visually testable in the running app.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Add: `buildToolbarDOM`, `updatePosition`; wire `onEnable` for floating mode |

No new test file changes — DOM functions are verified by visual inspection in the app. The dispatch logic is tested indirectly through step_03's pure functions.

---

## Detailed Specification

### 1. getCmEditorView helper

Add a module-private helper (same pattern as `auto-toc.plugin.ts`):

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmView(): typeof import("@codemirror/view") {
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Called only inside `onEnable` and factory functions — never at module evaluation time.

### 2. buildToolbarDOM

```typescript
function buildToolbarDOM(): HTMLElement {
```

Creates the toolbar `<div>` with id `__markable_md_toolbar__` and class `md-toolbar`.

**Button creation — iterate `FORMATS` in order:**

```typescript
for (const fmt of FORMATS) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "md-toolbar__btn";
  btn.dataset["format"] = fmt.id;
  btn.title = fmt.label;
  btn.textContent = BUTTON_LABELS[fmt.id];   // see label table below
  toolbar.appendChild(btn);
}
```

**Button label table (module-level const):**

```typescript
const BUTTON_LABELS: Record<FormatId, string> = {
  bold:          "B",
  italic:        "I",
  underline:     "U",
  strikethrough: "S",
  highlight:     "H",
  inlineCode:    "`·`",
  superscript:   "x²",
  link:          "⌘",     // or a chain link character; developer may choose
  image:         "⊞",     // or a simple icon character; developer may choose
  erase:         "✕",
};
```

The exact characters for link and image buttons are not load-bearing — choose legible Unicode. Bold/Italic/Underline/Strikethrough should use their conventional single-letter labels.

**Click handler — attached via a single delegated listener on the toolbar div:**

```typescript
toolbar.addEventListener("mousedown", async (e: MouseEvent) => {
  e.preventDefault();    // prevent editor losing focus (FR-4)
  const btn = (e.target as Element).closest("[data-format]") as HTMLElement | null;
  if (!btn) return;
  const fmtId = btn.dataset["format"] as FormatId;
  await handleButtonClick(fmtId);
});
```

Using `mousedown` with `preventDefault` is the standard technique for toolbar buttons that must not steal focus from the editor. `click` events cause a focus-loss blur cycle on some platforms.

**handleButtonClick (module-private async function):**

```typescript
async function handleButtonClick(fmtId: FormatId): Promise<void> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const view = (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (!view) return;

  const state = view.state;
  const sel = state.selection.main;
  if (sel.empty) return;    // EC-1, EC-2 guard

  const docText = state.doc.toString();

  if (fmtId === "erase") {
    const result = computeErase(docText, sel.from, sel.to);
    if (!result.changed) return;    // EC-11
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: result.insert },
      selection: { anchor: sel.from, head: sel.from + result.insert.length },
    });
    return;
  }

  const fmt = FORMATS.find(f => f.id === fmtId);
  if (!fmt) return;

  const flags = detectFormats(docText, sel.from, sel.to);

  if (flags[fmtId]) {
    // Toggle off — unwrap
    const result = computeUnwrap(docText, sel.from, sel.to, fmt);
    if (!result) return;
    view.dispatch({
      changes: { from: result.changeFrom, to: result.changeTo, insert: result.insert },
      selection: { anchor: result.selFrom, head: result.selTo },
    });
  } else {
    // Apply — for link/image, resolve URL first
    let url: string | undefined;
    if (fmt.isLink || fmt.isImage) {
      const resolved = await resolveUrl();
      if (resolved === null) return;    // EC-9: user cancelled
      url = resolved;
    }
    const selectedText = docText.slice(sel.from, sel.to);
    const result = computeWrap(selectedText, fmt, url);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: result.insert },
      selection: {
        anchor: sel.from + result.selFrom,
        head:   sel.from + result.selTo,
      },
    });
  }
}
```

**EC-6:** One `view.dispatch` call per button click — exactly one undo step.
**EC-23:** `__MARKABLE_EDITOR_VIEW__` is always the live view for the current tab. The click handler reads it at invocation time, not at plugin load time.

### 3. updatePosition

```typescript
function updatePosition(
  view: EditorViewType,
  toolbarEl: HTMLElement
): void {
  const sel = view.state.selection.main;

  if (sel.empty) {
    toolbarEl.style.display = "none";
    return;
  }

  const coords = view.coordsAtPos(sel.from);
  if (!coords) {
    toolbarEl.style.display = "none";
    return;
  }

  const toolbarHeight = toolbarEl.offsetHeight || 36;
  const toolbarWidth  = toolbarEl.offsetWidth  || 280;
  const OFFSET = 8;

  // Preferred position: above the selection
  let top  = coords.top - toolbarHeight - OFFSET;
  let left = coords.left;

  // EC-14: Flip below the selection when no room above
  if (top < 0) {
    top = coords.bottom + OFFSET;
  }

  // Clamp left edge so toolbar does not overflow viewport right
  const maxLeft = window.innerWidth - toolbarWidth - 8;
  if (left > maxLeft) left = maxLeft;
  if (left < 0) left = 0;

  toolbarEl.style.top  = `${top}px`;
  toolbarEl.style.left = `${left}px`;
  toolbarEl.style.display = "flex";
}
```

**Why `offsetHeight || 36`:** On the very first call (before the element has been painted), `offsetHeight` may be 0. The fallback of 36px is close to the actual rendered height and prevents the toolbar from appearing at `top - 0 - 8 = coords.top - 8` (almost on top of the text).

### 4. Wire onEnable for floating mode

Replace the floating-mode TODO stub from step_01:

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  const raw = await api.loadSettings();
  _settings = mergeWithDefaults(raw);
  injectCSS();

  _toolbarEl = buildToolbarDOM();
  _buttons = _toolbarEl.querySelectorAll<HTMLButtonElement>(".md-toolbar__btn");

  api.addExtensions([buildUpdateListener()]);  // step_06 fills this factory

  if (_settings.toolbarMode === "floating") {
    document.body.appendChild(_toolbarEl);
    _toolbarEl.style.display = "none";
  } else {
    // sidebar mode: step_05 fills this branch
    api.registerSidebarPanel({ /* step_05 */ } as any);
    _sidebarPanelRegistered = true;
  }
}
```

`buildUpdateListener` is a forward reference to step_06. For now, supply a temporary stub that returns an empty array (or the actual factory if step_06 is implemented concurrently). The stub is replaced in step_06.

---

## Acceptance Criteria

These are verified by visual inspection in the running app, not by Vitest.

### AC-4.1: Floating toolbar appears on selection
Select any text in the editor → floating toolbar appears above (or below if near top) the selection.

### AC-4.2: Floating toolbar disappears on deselection
Click without selecting (or press Escape) → toolbar vanishes.

### AC-4.3: Bold button applies format
Select "hello" → click Bold → document becomes `**hello**`, selection covers `hello`.

### AC-4.4: Bold button toggles off
Place cursor inside `**hello**` → select `hello` → click Bold → markers removed, document has `hello`.

### AC-4.5: Link button prompts for URL when clipboard has non-URL text
Select text → click Link → `window.prompt` appears → enter URL → link syntax inserted.

### AC-4.6: Link button uses clipboard URL silently (EC-7)
Copy `https://example.com` to clipboard → select text → click Link → link inserted without prompt.

### AC-4.7: Cancel prompt aborts insert (EC-9)
Select text → click Link → cancel prompt → document unchanged.

### AC-4.8: Erase button strips all formats (EC-12)
Select `**bold** and *italic*` → click Erase → document shows `bold and italic`.

### AC-4.9: No duplicate toolbar on rapid toggle (EC-15)
Disable and re-enable plugin → only one toolbar element in `document.body`.

### AC-4.10: Toolbar removed on disable while visible (EC-16)
With toolbar visible → disable plugin → toolbar element is gone from the DOM.

### AC-4.11: Viewport flip (EC-14)
Scroll to top of document → select text on the first line → toolbar appears below the selection.

### AC-4.12: Focus preserved after button click (FR-4)
Click Bold → editor retains focus (cursor visible, further typing works).

---

## Notes for the Developer

**`mousedown` vs `click` for focus preservation.** Using `mousedown` with `e.preventDefault()` prevents the editor from losing focus when the toolbar button is pressed. If `click` were used instead, the editor would blur before the format is applied, making `view.state.selection.main` stale. This is the standard toolbar pattern and must not be changed.

**`buildUpdateListener` forward reference.** In this step, if step_06 has not been implemented yet, supply a no-op factory:
```typescript
function buildUpdateListener() {
  const { EditorView } = getCmView();
  return EditorView.updateListener.of((_update) => { /* step_06 */ });
}
```
This is replaced with the full implementation in step_06.

**Toolbar DOM is created once per `onEnable`.** Do not recreate it on selection events. The `updatePosition` function only changes CSS; the DOM structure is stable.

**Button NodeList.** `_buttons = _toolbarEl.querySelectorAll<HTMLButtonElement>(".md-toolbar__btn")` — store this immediately after `buildToolbarDOM()`. It is used in steps 06 and 07 for O(1) iteration without repeated DOM queries.
