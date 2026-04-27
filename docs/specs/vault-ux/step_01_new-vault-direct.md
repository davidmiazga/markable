# Step 01 — Decouple "New Vault" from Manage Vaults Modal

**File to modify**: `src/plugins/file-browser/file-browser.plugin.ts`
**Related files (no modification)**: `src/plugins/file-browser/manage-vaults-ui.ts` (read-only; `showCreateVaultForm()` is already exported)

---

## Goal

When the user clicks "New Vault" — whether from the "+ Add…" row context menu or from the "no-vault" empty state button — the Manage Vaults modal opens directly on the create form, not on the vault list.

Currently both call sites invoke `openManageVaultsModal()` with no arguments, which calls `mountManageVaultsPanel(body)` with no `selectedVaultId`, which renders the list view first. The user then has to click "New Vault" again inside the modal to reach the form.

---

## Current Code

### Call site 1 — `buildAddRow()` (line ~1145 in file-browser.plugin.ts)

```ts
{
  label: "New Vault…",
  handler: () => openManageVaultsModal(),
},
```

### Call site 2 — `renderEmptyState()` variant `"no-vault"` (line ~1241)

```ts
btn.textContent = "New Vault";
btn.addEventListener("click", () => openManageVaultsModal());
```

### `openManageVaultsModal()` (line ~738)

```ts
function openManageVaultsModal(selectedVaultId?: string): void {
  if (document.getElementById("__fb_manage_vaults_overlay__")) return;
  const overlay = buildModalOverlay();
  const body = buildModalContent(overlay);
  mountManageVaultsPanel(body, selectedVaultId, () => overlay.remove());
  document.body.appendChild(overlay);
}
```

### `mountManageVaultsPanel()` in manage-vaults-ui.ts (line ~83)

```ts
export function mountManageVaultsPanel(
  container: HTMLElement,
  selectedVaultId?: string,
  onClose?: () => void
): void {
  panelRoot = container;
  _onClose = onClose ?? null;
  if (selectedVaultId) {
    currentView = "edit";
    editingVaultId = selectedVaultId;
  } else {
    currentView = "list";     // <-- always shows list when no id given
    editingVaultId = null;
  }
  render();
}
```

`showCreateVaultForm()` is already exported from `manage-vaults-ui.ts`:

```ts
export function showCreateVaultForm(): void {
  if (!panelRoot) return;
  currentView = "create";
  editingVaultId = null;
  render();
}
```

---

## Change Required

Add a new private function `openNewVaultModal()` that opens the modal and immediately calls `showCreateVaultForm()` after mounting.

```ts
/**
 * Open the Manage Vaults UI pre-navigated to the Create Vault form.
 *
 * This replaces direct calls to openManageVaultsModal() from "New Vault"
 * entry points so the user lands on the form immediately, not the vault list.
 */
function openNewVaultModal(): void {
  if (document.getElementById("__fb_manage_vaults_overlay__")) return;
  const overlay = buildModalOverlay();
  const body = buildModalContent(overlay);
  mountManageVaultsPanel(body, undefined, () => overlay.remove());
  showCreateVaultForm();   // skip the list view
  document.body.appendChild(overlay);
}
```

Then update both call sites:

1. In `buildAddRow()`: change `handler: () => openManageVaultsModal()` to `handler: () => openNewVaultModal()`.
2. In `renderEmptyState()` `"no-vault"` branch: change `btn.addEventListener("click", () => openManageVaultsModal())` to `btn.addEventListener("click", () => openNewVaultModal())`.

Leave `openManageVaultsModal()` unchanged — it is still used by "Edit Vault…" context menu (which correctly passes a `selectedVaultId`) and by the Manage Vaults entry points added in step_05.

---

## Imports

No new imports needed. `showCreateVaultForm` is already imported from `./manage-vaults-ui` at the top of the file.

---

## Acceptance Criteria

1. Clicking "New Vault…" from the "+ Add…" row opens the modal showing the create form (name input, root path picker, etc.), not the vault list.
2. Clicking "New Vault" from the empty-state panel opens the create form directly.
3. Clicking "Edit Vault…" from a vault node's context menu still opens the modal on the edit form for that vault (existing behaviour, not touched).
4. The double-open guard (`document.getElementById("__fb_manage_vaults_overlay__")`) still works: calling `openNewVaultModal()` twice does not produce two overlays.
5. Cancelling or saving in the create form still closes the modal and returns to the file browser (existing `onClose` callback behaviour is unchanged).

---

## Tests (step_06 covers)

- `openNewVaultModal()` renders the `.vault-form` element immediately (not `.vault-list-rows`).
- The double-open guard prevents a second overlay when called twice.
