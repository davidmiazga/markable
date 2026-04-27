# Step 05 — Manage Vaults Entry Points (Plugin Panel Button + Keybinding)

**Files to modify**:
- `src/plugins/plugins-panel/plugins-panel.ts`
- `src/keybindings/keybindings-panel.ts`
- `src/main.ts`
- `docs/keybindings-default.json`

---

## Goal

Make the Manage Vaults modal reachable from two new entry points that do not require the file browser sidebar to be open:

1. A "Manage Vaults" button in the Plugin Panel (appended to the panel body footer).
2. A keybinding slot `vault-manage` registered in the keybindings system.

---

## Part A — Plugin Panel "Manage Vaults" Button

### Where to add it

The Plugin Panel (`plugins-panel.ts`) renders its body via `showListView()`. The body element is `bodyElement` (a `<div id="plugins-body">`). The three sections (Workflow / Core / User) are appended to it.

Add a footer row at the bottom of `showListView()`, after the three `buildSection(...)` calls:

```ts
// After the three buildSection calls in showListView():
bodyElement.appendChild(buildManageVaultsFooter());
```

### `buildManageVaultsFooter()`

Add this private function to `plugins-panel.ts`:

```ts
/**
 * Build a footer row with a "Manage Vaults" button.
 *
 * The button calls openManageVaultsModal() via the file-browser plugin's
 * window global __MARKABLE_OPEN_MANAGE_VAULTS__. This avoids a direct import
 * dependency between plugins-panel and file-browser.
 */
function buildManageVaultsFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "plugin-panel-footer";

  const btn = document.createElement("button");
  btn.className = "plugin-panel-footer-btn";
  btn.textContent = "Manage Vaults";
  btn.addEventListener("click", () => {
    closePluginsPanel();
    const openFn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
    if (typeof openFn === "function") openFn();
  });

  footer.appendChild(btn);
  return footer;
}
```

### Window global `__MARKABLE_OPEN_MANAGE_VAULTS__`

In `file-browser.plugin.ts`, in `onEnable`, register the global:

```ts
(window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openManageVaultsModal;
```

In `onDisable`, unregister it:

```ts
(window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;
```

This follows the existing pattern used by `__MARKABLE_COMMAND_BAR_OPEN__`, `__MARKABLE_TEMPLATES__`, etc.

### CSS for Plugin Panel footer

Add to `plugins-panel.css`:

```css
.plugin-panel-footer {
  padding: 12px 16px 8px;
  border-top: 1px solid var(--border-color, rgba(128,128,128,.15));
  margin-top: 8px;
}
.plugin-panel-footer-btn {
  width: 100%;
  padding: 7px 12px;
  background: none;
  border: 1px solid var(--border-color, rgba(128,128,128,.25));
  border-radius: 6px;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.plugin-panel-footer-btn:hover {
  background: var(--hover-bg, rgba(128,128,128,.08));
  color: var(--text-primary);
}
```

---

## Part B — Keybinding Slot `vault-manage`

### 1. Register in `keybindings-panel.ts`

Add to the `COMMANDS` array in the `"View"` section, after `file-browser-toggle`:

```ts
{ id: "vault-manage", label: "Manage Vaults", defaultKey: "", section: "View" },
```

No default key is assigned. The user can bind it via the Keyboard Shortcuts panel.

### 2. Handle in `main.ts` `handleAction()`

Add a case to the `handleAction` switch:

```ts
case "vault-manage": {
  const openVaultFn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
  if (typeof openVaultFn === "function") openVaultFn();
  break;
}
```

### 3. Add to `docs/keybindings-default.json`

In the `"View"` section, add after `"file-browser-toggle"`:

```json
"vault-manage": ""
```

---

## EC-VUX-08 and EC-VUX-09 coverage

- EC-VUX-08 (double-open guard): `openManageVaultsModal()` already guards via `document.getElementById("__fb_manage_vaults_overlay__")`. The global and keybinding both call `openManageVaultsModal()`, so the guard applies.
- EC-VUX-09 (Plugin Panel closed when button clicked): `buildManageVaultsFooter()` calls `closePluginsPanel()` before `openManageVaultsModal()`, so the plugin panel is dismissed cleanly before the vault modal appears.

---

## Acceptance Criteria

1. The Plugin Panel shows a "Manage Vaults" button at the bottom of its body when the File Browser plugin is enabled.
2. Clicking "Manage Vaults" in the Plugin Panel closes the Plugin Panel and opens the Manage Vaults modal on the vault list view.
3. The keybinding entry `vault-manage` appears in the Keyboard Shortcuts panel under "View" with no default key.
4. Binding a key to `vault-manage` and pressing it opens the Manage Vaults modal.
5. If the File Browser plugin is disabled (`__MARKABLE_OPEN_MANAGE_VAULTS__` is null), the Plugin Panel button is either hidden or shows an alert "Enable the File Browser plugin to manage vaults." (choose one approach and be consistent).
6. `docs/keybindings-default.json` contains the `"vault-manage": ""` entry.

### Note on item 5

Recommended approach: hide the button entirely when `__MARKABLE_OPEN_MANAGE_VAULTS__` is null. The Plugin Panel re-renders via `showListView()` each time it opens, so the footer will not appear when the file browser is off.

Alternatively, always show the button and alert when the global is null. This makes the feature more discoverable. Leave the choice to the developer; document the decision in `00_index.md`.

---

## Tests (step_06 covers)

- `showListView()` appends a `.plugin-panel-footer` element containing a `.plugin-panel-footer-btn` to `bodyElement`.
- Clicking the footer button calls `closePluginsPanel()` then `openManageVaultsModal()`.
- `COMMANDS` array in `keybindings-panel.ts` contains an entry with `id: "vault-manage"`.
- `handleAction("vault-manage")` calls `__MARKABLE_OPEN_MANAGE_VAULTS__` when the global is a function.
- `handleAction("vault-manage")` is a no-op when `__MARKABLE_OPEN_MANAGE_VAULTS__` is null.
