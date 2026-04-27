# Step 02 — Hover-Reveal Unmount Icon on Vault Rows

**File to modify**: `src/plugins/file-browser/file-browser.plugin.ts`
**CSS lives inline**: the `FILE_BROWSER_CSS` constant in the same file

---

## Goal

When the user hovers over a vault row in the file tree, an unmount icon appears on the right side of the row. Clicking it disconnects the vault from Markable (does not delete files from disk).

---

## Resolve OQ-VUX-01 Before Implementing

Check `00_index.md` OQ-VUX-01. If confirmed: no dialog for inactive vault unmounts; brief inline confirm for the active vault.

Implement as: `window.confirm(...)` native dialog when unmounting the active vault. No dialog when unmounting an inactive vault.

---

## Resolve OQ-VUX-02 Before Implementing

Check `00_index.md` OQ-VUX-02 for icon choice. If the `logout` Material Symbol is not already imported, add it to `src/plugins/file-browser/icons/material/index.ts` following the existing pattern. Use a 16x16 SVG. If no icon is chosen, use a simple × symbol (Unicode `\u2715`) as a fallback text button.

---

## DOM Change: `buildNodeEl()` — vault nodes only

`buildNodeEl()` in `file-browser.plugin.ts` builds each `<li>`. After `appendIconAndLabel()` for vault-type nodes, append an unmount button:

```ts
if (node.type === "vault") {
  const unmountBtn = document.createElement("button");
  unmountBtn.className = "vault-row-unmount-btn";
  unmountBtn.setAttribute("aria-label", `Unmount vault ${node.name}`);
  unmountBtn.setAttribute("title", "Unmount vault");
  unmountBtn.innerHTML = /* icon SVG or text */ ICON_UNMOUNT_SVG;
  li.appendChild(unmountBtn);
}
```

Do NOT attach the click handler here. `attachNodeListeners()` already owns all event wiring for `<li>` elements. Instead, add a new helper called from `attachNodeListeners()`.

---

## Event Wiring: `attachNodeListeners()`

Add a branch for vault nodes:

```ts
if (el.getAttribute("data-type") === "vault") {
  attachVaultUnmountListener(el);
}
```

### `attachVaultUnmountListener(el)`

```ts
function attachVaultUnmountListener(el: HTMLElement): void {
  const btn = el.querySelector<HTMLButtonElement>(".vault-row-unmount-btn");
  if (!btn) return;

  btn.addEventListener("click", (e: MouseEvent) => {
    e.stopPropagation();     // prevent vault-switch click on the row
    e.preventDefault();

    const nodeVaultId = el.getAttribute("data-vault-id") ?? "";
    if (!nodeVaultId) return;

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    const activeVault = vm?.getActiveVault?.();

    if (activeVault?.id === nodeVaultId) {
      // EC-VUX-01: confirm before unmounting the active vault
      const vaultName = activeVault.name ?? "this vault";
      const confirmed = window.confirm(
        `Unmount "${vaultName}"? You can re-add it later. Your notes are not deleted.`
      );
      if (!confirmed) return;
    }
    // EC-VUX-02: silent unmount for inactive vaults
    void vm?.deleteVault?.(nodeVaultId);
  });
}
```

Note: `deleteVault()` already removes the vault from settings and handles `activeVaultId` nulling (EC-VUX-01 active-vault path). The file browser's existing `onVaultChanged` subscription will re-render after the vault list changes.

---

## CSS Changes (inside `FILE_BROWSER_CSS` template literal)

Add after the `.tree-node-vault` rule:

```css
/* Hover-reveal unmount button on vault rows */
.vault-row-unmount-btn {
  display: none;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: auto;
  margin-right: 2px;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary, rgba(128,128,128,.55));
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.vault-row-unmount-btn:hover {
  background: var(--hover-bg, rgba(128,128,128,.12));
  color: var(--error-color, #c0392b);
}
.tree-node-vault:hover .vault-row-unmount-btn,
.tree-node-vault:focus-visible .vault-row-unmount-btn {
  display: flex;
}
```

---

## Edge Cases

- **EC-VUX-06**: If the context menu is open when the unmount button is clicked, `closeContextMenu()` is NOT called automatically by `attachVaultUnmountListener` — but `e.stopPropagation()` prevents the row's activate handler from firing. The context menu dismissal on outside-click (already registered as `_contextMenuDismiss`) will fire naturally since the button click bubbles to `document`. This is acceptable; no extra coordination needed.

- The `.vault-row-unmount-btn` must use `display: none` as base (not `visibility: hidden`) so it does not consume space or intercept pointer events when invisible.

---

## Acceptance Criteria

1. Hovering over a vault row reveals the unmount icon on the right side.
2. Moving the mouse off the vault row hides the icon.
3. Clicking the unmount icon on an inactive vault silently removes it from the vault list without a confirmation dialog.
4. Clicking the unmount icon on the active vault shows a `window.confirm()` dialog. Confirming removes the vault and transitions the file browser to the "no vault" empty state.
5. Clicking the unmount icon does NOT trigger a vault-switch or expand/collapse.
6. Keyboard-focusing a vault row (via Tab / arrow keys) also reveals the unmount button (`:focus-visible` rule).

---

## Tests (step_06 covers)

- Vault `<li>` element contains a `.vault-row-unmount-btn` child.
- Clicking the button on an inactive vault calls `vm.deleteVault(vaultId)`.
- Clicking the button on the active vault calls `window.confirm` before `vm.deleteVault`.
- Click event does not propagate to the row's activate handler.
