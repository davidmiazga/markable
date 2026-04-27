# Vault UX Refactor — Master Index

**Feature slug**: `vault-ux`
**Source requirements**: docs/requirements/active_task.md (FR-01.12, FR-01.13, FR-02.4, FR-02.6, FR-02.7)
**Status**: Architecture complete — ready for implementation

---

## Problem Statement

The current "New Vault" button in the file-browser sidebar opens the full "Manage Vaults" modal. This conflates two unrelated actions: creating a vault (a one-shot workflow) and managing existing vaults (an administrative screen). The result is confusing UX — pressing "New Vault" opens a vault list, not a creation form.

Additionally, the vault row in the sidebar has no hover affordances and no quick actions for the most common operations (rename, unmount). These actions currently require navigating through the Manage Vaults modal.

---

## Agreed Design (from user brief)

### Vault node in sidebar — new interactions

| Trigger | Action |
|---|---|
| Hover | Show an unmount icon on the right side of the vault row |
| Double-click | Inline rename (input in-place; Enter commits, Escape cancels) |
| Right-click / Ctrl-click | Context menu: Unmount, Rename, Edit Type |
| Context menu → "Edit Type" | Opens Manage Vaults modal focused on that vault |
| Context menu → "Rename" | Same inline rename as double-click |
| Context menu → "Unmount" | Disconnects the vault from Markable (does not delete from disk) |

### "New Vault" button — decoupled from Manage Vaults modal

The existing folder-picker → name-prompt creation flow stays intact. The only change is that "New Vault" triggers `showCreateVaultForm()` directly inside a modal, bypassing the vault list view that `openManageVaultsModal()` currently shows first.

### Vault Management Panel

- Kept as a modal overlay (existing `openManageVaultsModal()` / `mountManageVaultsPanel()` infrastructure is unchanged).
- Entry points: (a) a "Manage Vaults" button in the Plugins Panel footer, (b) a new keybinding slot `vault-manage` registered in `keybindings-panel.ts`.
- When opened via "Edit Type" context menu, it opens focused on that vault's edit form (existing `selectedVaultId` parameter already supports this).

---

## Implementation Steps

| Step | File | What it does |
|---|---|---|
| [step_01](step_01_new-vault-direct.md) | file-browser.plugin.ts | Decouple "New Vault" from Manage Vaults modal — open create form directly |
| [step_02](step_02_vault-hover-unmount.md) | file-browser.plugin.ts | Add hover-reveal unmount icon to vault rows |
| [step_03](step_03_vault-double-click-rename.md) | file-browser.plugin.ts | Inline rename on vault row double-click |
| [step_04](step_04_vault-context-menu.md) | file-browser.plugin.ts | Replace vault context menu items with Unmount / Rename / Edit Type |
| [step_05](step_05_manage-vaults-entrypoints.md) | plugins-panel.ts, keybindings-panel.ts, main.ts | Add Manage Vaults button to Plugin Panel + keybinding slot |
| [step_06](step_06_tests.md) | tests/plugins/file-browser/ | Vitest tests for all new vault UX behaviours |

---

## Step Checklist (for Lead Developer)

- [x] step_01 — New Vault decoupled
- [x] step_02 — Hover unmount icon
- [x] step_03 — Double-click rename on vault row
- [x] step_04 — Vault context menu (Unmount / Rename / Edit Type)
- [x] step_05 — Manage Vaults button in Plugin Panel + keybinding
- [x] step_06 — Tests

---

## Edge Cases

**EC-VUX-01: Unmount the active vault**
When the user unmounts the currently active vault, `activeVaultId` is set to null. The file browser shows the "no vault" empty state. The editor keeps its open tabs (they become unsaved/orphaned until the vault is re-mounted or another vault is activated). No confirmation dialog is needed beyond the hover-icon affordance — the action is reversible by re-adding the vault.

**EC-VUX-02: Unmount a non-active vault**
Unmounting an inactive vault removes it from the vault list without affecting the active vault, the file browser tree, or open tabs. Silent success.

**EC-VUX-03: Rename vault to a name that already exists**
Vault names are not unique identifiers (AD-03). Two vaults may share a name. No validation error is needed; the rename proceeds. The vault list shows both entries — they are distinguished by ID and last-opened date.

**EC-VUX-04: Inline rename cancelled mid-type**
If the user presses Escape or clicks away from the inline rename input on a vault row, the vault name reverts to its original value. The vault is not modified.

**EC-VUX-05: Double-click fires on vault icon or chevron, not label**
The double-click handler is attached to the entire vault `<li>` row, not just the label span. This prevents a dead zone if the user double-clicks slightly off the text.

**EC-VUX-06: Unmount icon is clicked while context menu is open**
Clicking the unmount icon closes any open context menu first, then executes the unmount. The two affordances do not conflict.

**EC-VUX-07: "New Vault" button is clicked when no vault exists (empty state)**
The empty state shows a "New Vault" button. After step_01 it calls `showCreateVaultForm()` directly. No regression from current behaviour; the create form appears immediately.

**EC-VUX-08: Manage Vaults keybinding fires while the modal is already open**
The existing `document.getElementById("__fb_manage_vaults_overlay__")` guard in `openManageVaultsModal()` prevents double-open. The keybinding handler delegates to `openManageVaultsModal()` so the guard applies.

**EC-VUX-09: Plugins Panel is closed when "Manage Vaults" button is clicked**
The Plugin Panel's "Manage Vaults" button calls `openManageVaultsModal()` regardless of panel state. `openManageVaultsModal()` appends the overlay to `document.body` which is always accessible.

---

## Open Questions

**OQ-VUX-01 (RESOLVED): Unmount confirmation**
Silent for inactive vaults. Single confirm dialog for the active vault only.

**OQ-VUX-02 (RESOLVED): Unmount icon**
Use `chip_extraction` Material Symbol — added to index.ts as `ICON_UNMOUNT`. Render at 12% opacity on the vault row by default, 100% opacity on hover.

---

## Deferred Work (not in this spec)

- Vault type icons (future `vaultType` / `iconId` field on VaultEntry) — per active_task.md Section 4.1 extension point.
- Full vault edit UI improvements (root path add/remove, exclude patterns) — these remain in manage-vaults-ui.ts as-is.
- Command Bar commands for vault operations (FR-01.13) — out of scope for this UX refactor; those are wired into the Command Bar plugin's result builder.
- The `docs/specs/vault-ux/step_05_manage-vaults-entrypoints.md` step noted two options for the Plugin Panel button when the file-browser plugin is disabled: hide it (chosen) or show an alert. Decision: the footer is hidden when `__MARKABLE_OPEN_MANAGE_VAULTS__` is null because `showListView()` only appends the footer element when the global is a function.
- Sticky error state after failed vault inline rename — no retry UX; consistent with existing file-rename behaviour. Deferred.

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/file-browser.plugin.ts` — steps 01–04 + step 05 global registration
  - `src/plugins/file-browser/icons/material/index.ts` — `ICON_UNMOUNT` export (pre-existing, verified present)
  - `src/plugins/plugins-panel/plugins-panel.ts` — step 05 footer button
  - `src/plugins/plugins-panel/plugins-panel.css` — step 05 footer styles
  - `src/keybindings/keybindings-panel.ts` — step 05 `vault-manage` command entry
  - `src/main.ts` — step 05 `vault-manage` case in `handleAction()`
  - `docs/keybindings-default.json` — step 05 `vault-manage` default (empty string)
  - `tests/plugins/file-browser/vault-ux.test.ts` — step 06 (new file, 31 tests)

- **Steps completed** (in order):
  - step_01_new-vault-direct.md
  - step_02_vault-hover-unmount.md
  - step_03_vault-double-click-rename.md
  - step_04_vault-context-menu.md
  - step_05_manage-vaults-entrypoints.md
  - step_06_tests.md

- **Known limitations**:
  - The `plugin-panel-footer` "Manage Vaults" button is hidden when the File Browser plugin is disabled (rather than showing an alert). This is the recommended approach from step_05 spec note.
  - `startVaultDblClickListener()` does not debounce the first single-click activate on a vault row before double-click fires. Per the spec, the double-click-then-rename on an inactive vault first switches to it (harmless), then renames. The spec defers any single-click suppression to a future polish pass.

- **Edge cases covered by tests**:

  | Edge Case | Test |
  |---|---|
  | EC-VUX-01: Confirm before unmounting active vault | `clicking unmount on the active vault shows window.confirm` |
  | EC-VUX-01: Cancelling confirm does not delete | `cancelling the confirm dialog does NOT call deleteVault` |
  | EC-VUX-02: Silent unmount for inactive vault | `clicking unmount on an inactive vault calls deleteVault without window.confirm` |
  | EC-VUX-03: Duplicate vault names allowed | `unchanged name cancels without calling updateVault` (no validation tested) |
  | EC-VUX-04: Escape/blur cancels rename | `Escape cancels rename`, `blur cancels rename` |
  | EC-VUX-05: Double-click anywhere on vault row fires rename | `startVaultInlineRename inserts an input into the row` |
  | EC-VUX-06: Unmount button click does not propagate | `unmount button click does not propagate to the row's activate handler` |
  | EC-VUX-07: Empty-state "New Vault" button opens create form | `empty-state 'New Vault' button click opens the create form directly` |
  | EC-VUX-08: Double-open guard on modal | `double-open guard: calling openNewVaultModal() twice produces only one overlay` |
  | EC-VUX-09: Plugin Panel closed before modal opened | `buildManageVaultsFooter` calls `closePluginsPanel()` first (code audit; not unit-testable without full plugin mount) |

---

## Review Sign-off

- **Date**: 2026-04-25
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — both targeted fixes verified clean; no new issues introduced by the changes under review.
- **Requirements traceability**: FR-02.4 (panel header menu action at `headerActions[1]` with stable `id`), FR-02.6 / step_03 (vault inline rename), and all vault-ux edge cases (EC-VUX-01 through EC-VUX-09) remain covered.
- **Edge case coverage**: All Edge Case Inventory items in `docs/requirements/active_task.md` that are in scope for Phase 2 (vault UX refactor) are covered by passing tests. `tests/plugins/file-browser/file-browser.test.ts` — 102 tests, 0 failures confirmed by `npm run test:run`.
- **Specific items verified**:
  1. `tests/plugins/file-browser/file-browser.test.ts` line 722 — `headerActions[1]` check: `action.icon === "⋯"`, `action.title === "Panel menu"`, `action.id === "file-browser-manage-vaults-btn"`. Assertion is correct and the test passes.
  2. `src/plugins/file-browser/file-browser.plugin.ts` lines 1504–1525 — `startVaultInlineRename` carries a substantive length-justification comment. The comment correctly names the irreducible-closure pattern (shared mutable state: `input`, `errSpan`, `originalName`, `labelEl`), explains why splitting into helper functions would increase indirection rather than clarity, and explicitly cross-references the identical pattern accepted on `renderTreeContent`. The justification mirrors the `renderTreeContent` JSDoc at lines 1251–1259 in structure and reasoning.
- **Status**: Approved for Merge
