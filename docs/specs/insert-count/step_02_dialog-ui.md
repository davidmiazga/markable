---
title: "Step 02 — Count Dialog UI"
last-updated: "2026-04-20"
review-cadence-days: 14
status: active
---

# Step 02 — Count Dialog UI

## Goal

Implement the Count Dialog: an inline overlay div anchored to the cursor, with three labelled inputs, inline validation, a focus trap, and full keyboard handling. After this step the dialog opens, validates, and closes. Actual insertion is wired in step_03.

---

## Files Modified

`src/plugins/insert-count/insert-count.plugin.ts` — add `openDialog`, `closeDialog`, `buildDialogDOM`, validation helpers, and `INSERT_COUNT_CSS`.

---

## Dialog DOM Structure

```
div#markable-insert-count-dialog  (.ic-dialog)
  div.ic-row
    label.ic-label  "Start at"
    input.ic-input#ic-start  [type=number, step=1]
    span.ic-error#ic-start-error
  div.ic-row
    label.ic-label  "Count by"
    input.ic-input#ic-step   [type=number, step=1]
    span.ic-error#ic-step-error
  div.ic-row
    label.ic-label  "Wrap with"
    input.ic-input#ic-wrap   [type=text, placeholder="e.g. Step __COUNTER__:"]
  div.ic-actions
    button.ic-btn.ic-btn-secondary#ic-cancel  "Cancel"
    button.ic-btn.ic-btn-primary#ic-insert    "Insert"
```

Use plain DOM (`document.createElement`) — no innerHTML for interactive elements. This avoids XSS risks and makes the focus trap straightforward.

---

## Positioning Logic

```typescript
function positionDialog(dialog: HTMLElement, view: any): void {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  if (!coords) {
    // Fallback: center of viewport
    dialog.style.top  = "50%";
    dialog.style.left = "50%";
    dialog.style.transform = "translate(-50%, -50%)";
    return;
  }
  dialog.style.transform = "";
  const MARGIN = 8;
  const DW = dialog.offsetWidth  || 300;
  const DH = dialog.offsetHeight || 160;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  let top  = coords.bottom + MARGIN;
  let left = coords.left;

  // Clamp to viewport
  if (left + DW > vpW) left = vpW - DW - MARGIN;
  if (left < MARGIN)   left = MARGIN;
  if (top  + DH > vpH) top  = coords.top - DH - MARGIN; // flip above cursor

  dialog.style.top  = `${top}px`;
  dialog.style.left = `${left}px`;
}
```

Call `positionDialog` after appending the dialog to `document.body` (so `offsetWidth`/`offsetHeight` are known). Also call it when the editor fires a resize, but the dialog itself does not update on tab switch — this is acceptable per resolved decision UK-05.

---

## openDialog Function

```typescript
function openDialog(): void {
  // EC-19: Prevent double-open.
  if (dialogOpen) {
    dialogEl?.focus();
    return;
  }

  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  // EC-01: No editor active — silent no-op.
  if (!view) return;

  dialogOpen = true;
  dialogEl = buildDialogDOM(view);
  document.body.appendChild(dialogEl);
  positionDialog(dialogEl, view);

  // Focus the Start input immediately.
  dialogEl.querySelector<HTMLInputElement>("#ic-start")?.focus();
}
```

---

## buildDialogDOM Function

Build all DOM nodes and wire all event listeners. Return the root element.

```typescript
function buildDialogDOM(view: any): HTMLElement {
  const dialog = document.createElement("div");
  dialog.id    = "markable-insert-count-dialog";
  dialog.className = "ic-dialog";

  // ── Start row ────────────────────────────────────────────────────────────────
  const startInput = document.createElement("input");
  startInput.id   = "ic-start";
  startInput.type = "text";
  startInput.className = "ic-input";
  startInput.value = String(currentSettings.start);
  startInput.setAttribute("inputmode", "numeric");

  const startError = document.createElement("span");
  startError.id = "ic-start-error";
  startError.className = "ic-error";

  // ── Step row ─────────────────────────────────────────────────────────────────
  const stepInput = document.createElement("input");
  stepInput.id   = "ic-step";
  stepInput.type = "text";
  stepInput.className = "ic-input";
  stepInput.value = String(currentSettings.step);
  stepInput.setAttribute("inputmode", "numeric");

  const stepError = document.createElement("span");
  stepError.id = "ic-step-error";
  stepError.className = "ic-error";

  // ── Wrap row ─────────────────────────────────────────────────────────────────
  const wrapInput = document.createElement("input");
  wrapInput.id   = "ic-wrap";
  wrapInput.type = "text";
  wrapInput.className = "ic-input";
  wrapInput.value = currentSettings.wrap;
  wrapInput.placeholder = "e.g. Step __COUNTER__:";

  // ── Action buttons ────────────────────────────────────────────────────────────
  const cancelBtn = document.createElement("button");
  cancelBtn.id = "ic-cancel";
  cancelBtn.className = "ic-btn ic-btn-secondary";
  cancelBtn.textContent = "Cancel";
  cancelBtn.type = "button";

  const insertBtn = document.createElement("button");
  insertBtn.id = "ic-insert";
  insertBtn.className = "ic-btn ic-btn-primary";
  insertBtn.textContent = "Insert";
  insertBtn.type = "button";

  // ── Assemble ──────────────────────────────────────────────────────────────────
  dialog.append(
    buildRow("Start at", startInput, startError),
    buildRow("Count by", stepInput, stepError),
    buildRow("Wrap with", wrapInput, null),
    buildActions(cancelBtn, insertBtn),
  );

  // ── Focusable elements list for focus trap ─────────────────────────────────────
  const focusable = [startInput, stepInput, wrapInput, cancelBtn, insertBtn];

  // ── Validation wiring ─────────────────────────────────────────────────────────
  function validate(): boolean {
    const startVal = startInput.value.trim();
    const stepVal  = stepInput.value.trim();
    let valid = true;

    // Start: must be non-empty integer
    if (!startVal || !isInteger(startVal)) {
      startError.textContent = startVal ? "Must be a whole number" : "Required";
      startInput.classList.add("ic-input--error");
      valid = false;
    } else {
      startError.textContent = "";
      startInput.classList.remove("ic-input--error");
    }

    // Step: must be non-empty, integer, and non-zero (EC-08, FR-05.2)
    if (!stepVal || !isInteger(stepVal)) {
      stepError.textContent = stepVal ? "Must be a whole number" : "Required";
      stepInput.classList.add("ic-input--error");
      valid = false;
    } else if (parseInt(stepVal, 10) === 0) {
      stepError.textContent = "Step cannot be zero";
      stepInput.classList.add("ic-input--error");
      valid = false;
    } else {
      stepError.textContent = "";
      stepInput.classList.remove("ic-input--error");
    }

    insertBtn.disabled = !valid;
    return valid;
  }

  startInput.addEventListener("input", validate);
  stepInput.addEventListener("input", validate);

  // Run once to set initial state (pre-filled values may already be valid).
  validate();

  // ── Action handlers ────────────────────────────────────────────────────────────
  function doInsert(): void {
    if (!validate()) return;
    const config: InsertCountSettings = {
      start: parseInt(startInput.value.trim(), 10),
      step:  parseInt(stepInput.value.trim(),  10),
      wrap:  wrapInput.value,
    };
    closeDialog(true, view, config);
  }

  insertBtn.addEventListener("click", doInsert);
  cancelBtn.addEventListener("click", () => closeDialog(false));

  // ── Keyboard: Escape and Enter ─────────────────────────────────────────────────
  dialog.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeDialog(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      doInsert();
      return;
    }
    // Focus trap: Tab / Shift-Tab
    if (e.key === "Tab") {
      e.preventDefault();
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey) {
        const prev = (idx - 1 + focusable.length) % focusable.length;
        focusable[prev].focus();
      } else {
        const next = (idx + 1) % focusable.length;
        focusable[next].focus();
      }
    }
  });

  // ── Click-outside to cancel ────────────────────────────────────────────────────
  // Listener is on document; we check if the click target is outside the dialog.
  function onDocClick(e: MouseEvent): void {
    if (dialogEl && !dialogEl.contains(e.target as Node)) {
      closeDialog(false);
    }
  }
  // Use capture so we see the click before anything else does.
  document.addEventListener("mousedown", onDocClick, { capture: true, once: false });
  // Store cleanup ref on the element so closeDialog can remove it.
  (dialog as any).__outsideClickHandler__ = onDocClick;

  return dialog;
}
```

---

## Helper Functions

```typescript
function buildRow(label: string, input: HTMLElement, error: HTMLElement | null): HTMLElement {
  const row = document.createElement("div");
  row.className = "ic-row";
  const lbl = document.createElement("label");
  lbl.className = "ic-label";
  lbl.textContent = label;
  lbl.setAttribute("for", input.id);
  row.appendChild(lbl);
  row.appendChild(input);
  if (error) row.appendChild(error);
  return row;
}

function buildActions(cancelBtn: HTMLElement, insertBtn: HTMLElement): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "ic-actions";
  actions.appendChild(cancelBtn);
  actions.appendChild(insertBtn);
  return actions;
}

function isInteger(s: string): boolean {
  return /^-?\d+$/.test(s.trim());
}
```

---

## closeDialog Function

```typescript
/**
 * Close the Count Dialog.
 *
 * @param insert  When true, reads the config and applies insertions.
 *                When false, no document change occurs (Cancel / Escape / onDisable).
 * @param view    The CM6 editor view. Required when insert=true.
 * @param config  The validated InsertCountSettings. Required when insert=true.
 */
function closeDialog(insert: boolean, view?: any, config?: InsertCountSettings): void {
  if (!dialogEl) return;

  // Remove the outside-click listener before removing the element.
  const outsideHandler = (dialogEl as any).__outsideClickHandler__;
  if (outsideHandler) {
    document.removeEventListener("mousedown", outsideHandler, { capture: true });
  }

  dialogEl.remove();
  dialogEl = null;
  dialogOpen = false;

  if (insert && view && config) {
    // Insertion and settings persistence handled in step_03.
    applyInsertions(view, config);
  }

  // Restore editor focus (NFR-05).
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  editorView?.focus();
}
```

`applyInsertions` is a forward reference implemented in step_03.

---

## CSS — INSERT_COUNT_CSS Constant

Replace the empty placeholder from step_01 with the real CSS string:

```typescript
const INSERT_COUNT_CSS = `
.ic-dialog {
  position: fixed;
  z-index: 9999;
  width: 300px;
  padding: 12px 14px 10px;
  border-radius: 8px;
  background: var(--bg-color, #1e1e1e);
  border: 1px solid var(--border-color, #444);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  font-family: var(--ui-font, system-ui, sans-serif);
  font-size: 13px;
  color: var(--text-color, #d4d4d4);
}
.ic-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.ic-label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #888);
  margin-bottom: 3px;
}
.ic-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #444);
  background: var(--input-bg, #2a2a2a);
  color: var(--text-color, #d4d4d4);
  font-family: var(--mono-font, monospace);
  font-size: 13px;
  outline: none;
}
.ic-input:focus {
  border-color: var(--accent-color, #0e86d4);
}
.ic-input--error {
  border-color: var(--error-color, #f44336) !important;
}
.ic-error {
  font-size: 11px;
  color: var(--error-color, #f44336);
  min-height: 14px;
  margin-top: 2px;
}
.ic-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.ic-btn {
  padding: 5px 14px;
  border-radius: 4px;
  font-family: var(--ui-font, system-ui, sans-serif);
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.1s;
}
.ic-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ic-btn-secondary {
  background: transparent;
  border-color: var(--border-color, #444);
  color: var(--text-color, #d4d4d4);
}
.ic-btn-secondary:hover:not(:disabled) {
  background: var(--hover-bg, rgba(255,255,255,0.05));
}
.ic-btn-primary {
  background: var(--accent-color, #0e86d4);
  color: #fff;
  border-color: var(--accent-color, #0e86d4);
}
.ic-btn-primary:hover:not(:disabled) {
  opacity: 0.85;
}
`;
```

---

## Edge Cases Addressed

| EC | How |
|---|---|
| EC-08 | Step=0 → inline error "Step cannot be zero", Insert button disabled |
| EC-13 | Non-integer Start → inline error, Insert disabled |
| EC-14 | Non-integer Step → inline error, Insert disabled |
| EC-15 | Empty Start field → "Required" error, Insert disabled |
| EC-16 | Cancel / Escape → `closeDialog(false)`, no config save |
| EC-17 | Enter in any input → `doInsert()` called |
| EC-18 | Escape anywhere in dialog → `closeDialog(false)` |
| EC-19 | `dialogOpen` guard in `openDialog` → no second dialog; existing receives focus |
| EC-20 | `onDisable` calls `closeDialog(false)` if `dialogEl !== null` |
| NFR-04 | All CSS via `var(--...)` with hex fallbacks only inside `var()` |
| NFR-05 | `closeDialog` calls `__MARKABLE_EDITOR_VIEW__.focus()` after remove |

---

## Acceptance Criteria

- Dialog appears near cursor position when `openDialog()` is called.
- Start input pre-filled with `currentSettings.start`; Step with `currentSettings.step`; Wrap with `currentSettings.wrap`.
- Typing non-integer in Start → error shown, Insert disabled.
- Typing `0` in Step → "Step cannot be zero" shown, Insert disabled.
- Pressing Escape closes dialog, no document change.
- Pressing Enter (any focused element) calls `doInsert`.
- Tab key cycles through inputs + buttons only.
- Clicking outside the dialog closes it without insertion.
- Invoking `openDialog()` while dialog is open: no second dialog, existing gets focus.
- All dialog CSS references CSS variables.
