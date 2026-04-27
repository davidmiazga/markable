# Step 03 — Inline Rename on Vault Row Double-Click

**File to modify**: `src/plugins/file-browser/file-browser.plugin.ts`
**Dependency**: step_01 and step_02 must be complete (or at least step_02's `attachVaultUnmountListener` addition to `attachNodeListeners` must exist so this step slots in cleanly).

---

## Goal

Double-clicking a vault row activates inline rename — an `<input>` replaces the vault name label in-place. Enter commits the rename (calls `updateVault(id, { name: newName, ... })`). Escape or blur cancels and restores the original label.

---

## How Rename Works for Files Today

`startInlineRename(el, path, vaultId)` in `file-browser.plugin.ts` replaces the `.tree-node-label` span with an `<input>`. On commit it calls `renameNode(path, newName, container)` which is a file-system rename.

Vault rename is different: it calls `updateVault(id, { name: newName })` from `vault-manager.ts`, which persists the new name to settings. No file-system path changes.

---

## New Function: `startVaultInlineRename(el)`

Add this function alongside `startInlineRename`:

```ts
/**
 * Activate inline rename for a vault row.
 *
 * Replaces the .tree-node-label span with a text input pre-filled with the
 * current vault name. Enter commits; Escape or blur cancels (EC-VUX-04).
 *
 * @param el - The vault <li> element to inline-edit.
 */
async function startVaultInlineRename(el: HTMLElement): Promise<void> {
  const labelEl = el.querySelector<HTMLElement>(".tree-node-label");
  if (!labelEl) return;

  const nodeVaultId = el.getAttribute("data-vault-id") ?? "";
  if (!nodeVaultId) return;

  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const allVaults = vm?.getAllVaults?.() ?? [];
  const vaultEntry = allVaults.find((v: any) => v.id === nodeVaultId);
  if (!vaultEntry) return;

  const originalName = vaultEntry.name as string;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-node-rename-input";
  input.value = originalName;

  const errSpan = document.createElement("span");
  errSpan.className = "tree-node-inline-error";

  labelEl.replaceWith(input);
  input.insertAdjacentElement("afterend", errSpan);
  input.focus();
  input.select();

  const cancel = () => {
    if (document.contains(input)) {
      input.replaceWith(labelEl);
      errSpan.remove();
      el.tabIndex = 0;
    }
  };

  const commit = async () => {
    const newName = input.value.trim();
    if (!newName || newName === originalName) { cancel(); return; }
    try {
      await vm.updateVault(nodeVaultId, { name: newName });
      // vault-manager fires onVaultChanged → renderPanel re-renders label
    } catch (err) {
      errSpan.textContent = String(err);
    }
  };

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    if (e.key === "Escape") { cancel(); }
  });

  // EC-VUX-04: blur cancels
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.contains(input)) cancel();
    }, 100);
  });

  input.addEventListener("click", (e: MouseEvent) => e.stopPropagation());
}
```

---

## Event Wiring: `attachNodeListeners()`

Add a `dblclick` listener for vault nodes. This must go after the existing `click` listener registration so that double-click does not also fire the single-click activate handler twice.

In `attachNodeListeners()`, after the existing `el.addEventListener("click", handleActivate)` line:

```ts
if (el.getAttribute("data-type") === "vault") {
  let singleClickTimer: ReturnType<typeof setTimeout> | null = null;

  el.addEventListener("dblclick", (e: MouseEvent) => {
    // Cancel any pending single-click activate
    if (singleClickTimer !== null) {
      clearTimeout(singleClickTimer);
      singleClickTimer = null;
    }
    e.stopPropagation();
    void startVaultInlineRename(el);
  });
}
```

Note on single-click interference: the activate handler (`buildActivateHandler`) fires on click, which may trigger a vault switch. This is fine — double-click fires click twice then dblclick. Vault switch on the first click of a double-click is acceptable because:
- If the vault is already active, `buildActivateHandler` toggles expand/collapse (harmless).
- If the vault is not active, the first click switches to it; the dblclick then opens rename on the now-active vault. This is the correct final state.

If the user preference is that double-click should NOT switch vaults at all, a `singleClickTimer` debounce can suppress the single-click activate. This is a UI polish question; leave it as simple `dblclick` for now and note in `00_index.md` if the user objects.

---

## `vault-manager.ts` — `updateVault` signature check

Before implementing, verify that `updateVault` in `src/lib/vault-manager.ts` accepts a partial patch object `{ name: string }` without requiring all fields. If it requires all fields, the commit handler must spread the existing vault entry:

```ts
await vm.updateVault(nodeVaultId, {
  name: newName,
  rootPaths: vaultEntry.rootPaths,
  excludePatterns: vaultEntry.excludePatterns,
  maxIndexSize: vaultEntry.maxIndexSize,
});
```

Confirm the signature and use the correct call form.

---

## CSS

No new CSS needed. `.tree-node-rename-input` and `.tree-node-inline-error` are already defined in `FILE_BROWSER_CSS` and reused here.

---

## Edge Cases

- **EC-VUX-03**: Two vaults with the same name are allowed. No validation needed on the input.
- **EC-VUX-04**: Pressing Escape or clicking away cancels rename; the label reverts.
- **EC-VUX-05**: Double-click on the vault icon or chevron still activates rename because the `dblclick` is on the `<li>` (whole row), not just the label span.
- If `vm.updateVault()` throws, the error is shown inline in `errSpan`. The input remains open so the user can correct or cancel.

---

## Acceptance Criteria

1. Double-clicking any part of a vault row (icon, label, chevron) activates an inline rename input.
2. Typing a new name and pressing Enter calls `updateVault(id, { name: newName })`.
3. Pressing Escape or clicking outside the input cancels the rename; the original name is restored.
4. After a successful rename, the panel re-renders with the new vault name (via `onVaultChanged` → `renderPanel()`).
5. The rename input reuses the existing `.tree-node-rename-input` CSS class.

---

## Tests (step_06 covers)

- Double-click on vault row inserts an `<input class="tree-node-rename-input">` into the row.
- Enter in the input calls `vm.updateVault` with the new name.
- Escape in the input restores the label without calling `vm.updateVault`.
- Blur restores the label (EC-VUX-04).
