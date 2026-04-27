# Step 06 — Tests

**Test file**: `tests/plugins/file-browser/vault-ux.test.ts`
**Framework**: Vitest
**Dependency**: steps 01–05 must be complete.

---

## Test Environment Setup

The file-browser plugin is an IIFE that relies on `window` globals. Tests must mock:
- `window.__MARKABLE_VAULT_MANAGER__` with at least `getActiveVault()`, `getAllVaults()`, `deleteVault()`, `updateVault()`.
- `window.__MARKABLE_TAB_MANAGER__` (can be an empty stub).
- `window.__TAURI_INTERNALS__` with a no-op `invoke`.
- `window.confirm` — override with `vi.fn()` returning `true` or `false` per test.

Follow the existing test setup pattern in `tests/plugins/file-browser/` (if that directory already has a setup file, extend it; otherwise create `vault-ux.test.ts` as a standalone file).

Import the functions under test as named exports (the file-browser plugin exports several functions — add exports for any new functions that need direct unit testing, following the existing `export function startInlineRename` pattern).

---

## Test Cases

### step_01: New Vault Direct

```ts
describe("openNewVaultModal", () => {
  it("renders the create form immediately (not the vault list)", () => {
    // Call openNewVaultModal() — exposed via a test export or via triggering
    // the "+ Add…" row's "New Vault…" click handler.
    // Assert that .vault-form is present in document.body.
    // Assert that .vault-list-rows is NOT present.
  });

  it("double-open guard prevents a second overlay", () => {
    openNewVaultModal();
    openNewVaultModal();
    const overlays = document.querySelectorAll("#__fb_manage_vaults_overlay__");
    expect(overlays.length).toBe(1);
  });

  it("empty-state 'New Vault' button opens create form directly", () => {
    // Set up no-active-vault state, render panel.
    // Click the .file-browser-empty button.
    // Assert .vault-form is present.
  });
});
```

### step_02: Hover Unmount Icon

```ts
describe("vault row unmount button", () => {
  it("vault <li> element contains a .vault-row-unmount-btn child", () => {
    // Build a vault TreeNode, call buildNodeEl(node, null).
    // Assert li.querySelector(".vault-row-unmount-btn") is not null.
  });

  it("directory <li> does NOT contain .vault-row-unmount-btn", () => {
    // Build a directory TreeNode.
    // Assert no .vault-row-unmount-btn.
  });

  it("clicking unmount on inactive vault calls vm.deleteVault without confirm", () => {
    const deleteVault = vi.fn().mockResolvedValue(undefined);
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "vault-A", name: "A" }),
      getAllVaults: () => [{ id: "vault-A" }, { id: "vault-B" }],
      deleteVault,
    };
    window.confirm = vi.fn();

    // Render a vault node for vault-B (inactive).
    // Click its .vault-row-unmount-btn.
    expect(window.confirm).not.toHaveBeenCalled();
    expect(deleteVault).toHaveBeenCalledWith("vault-B");
  });

  it("clicking unmount on active vault calls window.confirm then deleteVault", () => {
    const deleteVault = vi.fn().mockResolvedValue(undefined);
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "vault-A", name: "Active" }),
      getAllVaults: () => [{ id: "vault-A", name: "Active" }],
      deleteVault,
    };
    window.confirm = vi.fn().mockReturnValue(true);

    // Render vault node for vault-A (active). Click unmount btn.
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Active"));
    expect(deleteVault).toHaveBeenCalledWith("vault-A");
  });

  it("unmount click on active vault does nothing when confirm is cancelled", () => {
    const deleteVault = vi.fn();
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "vault-A", name: "Active" }),
      deleteVault,
    };
    window.confirm = vi.fn().mockReturnValue(false);

    // Click unmount btn.
    expect(deleteVault).not.toHaveBeenCalled();
  });

  it("unmount button click does not propagate to row activate handler", () => {
    const switchVault = vi.fn();
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "other", name: "Other" }),
      getAllVaults: () => [{ id: "vault-B" }],
      deleteVault: vi.fn(),
      switchVault,
    };
    // Click unmount btn on vault-B's row.
    expect(switchVault).not.toHaveBeenCalled();
  });
});
```

### step_03: Double-Click Rename

```ts
describe("vault inline rename", () => {
  it("double-click on vault row inserts a rename input", () => {
    // Fire dblclick on a vault <li>.
    // Assert li.querySelector("input.tree-node-rename-input") is not null.
    // Assert original label span is removed from the DOM.
  });

  it("Enter commits rename via vm.updateVault", async () => {
    const updateVault = vi.fn().mockResolvedValue(undefined);
    // Set up vault manager with vaultEntry.name = "Old Name".
    // Trigger dblclick, change input.value to "New Name", fire keydown Enter.
    expect(updateVault).toHaveBeenCalledWith("vault-id", expect.objectContaining({ name: "New Name" }));
  });

  it("Escape cancels rename — original label restored, updateVault not called", () => {
    const updateVault = vi.fn();
    // Trigger dblclick, fire keydown Escape.
    // Assert input is removed from DOM.
    // Assert original label span is back.
    expect(updateVault).not.toHaveBeenCalled();
  });

  it("blur cancels rename (EC-VUX-04)", async () => {
    const updateVault = vi.fn();
    // Trigger dblclick, fire blur on input (simulate clicking away).
    await vi.runAllTimersAsync();
    // Assert input removed, label restored.
    expect(updateVault).not.toHaveBeenCalled();
  });

  it("empty new name cancels without calling updateVault", async () => {
    const updateVault = vi.fn();
    // Trigger dblclick, clear input, fire Enter.
    expect(updateVault).not.toHaveBeenCalled();
  });

  it("unchanged name cancels without calling updateVault", async () => {
    const updateVault = vi.fn();
    // Trigger dblclick, do not change value, fire Enter.
    expect(updateVault).not.toHaveBeenCalled();
  });
});
```

### step_04: Vault Context Menu

```ts
describe("buildVaultContextMenuItems", () => {
  it("returns exactly 4 items: Unmount, Rename, separator, Edit Type", () => {
    const items = buildVaultContextMenuItems(mockEl, "/path", "vault-id");
    const nonSep = items.filter((i) => !i.separator);
    expect(nonSep).toHaveLength(3);
    expect(nonSep[0].label).toBe("Unmount");
    expect(nonSep[1].label).toBe("Rename");
    expect(nonSep[2].label).toBe("Edit Type");
  });

  it("Unmount handler: inactive vault — calls deleteVault, no confirm", () => {
    const deleteVault = vi.fn();
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "other" }),
      deleteVault,
    };
    window.confirm = vi.fn();
    const items = buildVaultContextMenuItems(mockEl, "", "vault-B");
    items.find((i) => i.label === "Unmount")!.handler!();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(deleteVault).toHaveBeenCalledWith("vault-B");
  });

  it("Unmount handler: active vault — calls confirm then deleteVault", () => {
    const deleteVault = vi.fn();
    window.__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ id: "vault-A", name: "Active" }),
      deleteVault,
    };
    window.confirm = vi.fn().mockReturnValue(true);
    const items = buildVaultContextMenuItems(mockEl, "", "vault-A");
    items.find((i) => i.label === "Unmount")!.handler!();
    expect(window.confirm).toHaveBeenCalled();
    expect(deleteVault).toHaveBeenCalledWith("vault-A");
  });

  it("Rename handler calls startVaultInlineRename", () => {
    const spy = vi.spyOn(module, "startVaultInlineRename");
    const items = buildVaultContextMenuItems(mockEl, "", "vault-id");
    items.find((i) => i.label === "Rename")!.handler!();
    expect(spy).toHaveBeenCalledWith(mockEl);
  });

  it("Edit Type handler calls openManageVaultsModal with vaultId", () => {
    const spy = vi.spyOn(module, "openManageVaultsModal");
    const items = buildVaultContextMenuItems(mockEl, "", "vault-id");
    items.find((i) => i.label === "Edit Type")!.handler!();
    expect(spy).toHaveBeenCalledWith("vault-id");
  });

  it("old items 'New Vault…', 'Edit Vault…', 'Delete Vault…' are NOT present", () => {
    const items = buildVaultContextMenuItems(mockEl, "", "vault-id");
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain("New Vault…");
    expect(labels).not.toContain("Edit Vault…");
    expect(labels).not.toContain("Delete Vault…");
  });
});
```

### step_05: Manage Vaults Entry Points

```ts
describe("Plugin Panel Manage Vaults footer", () => {
  it("showListView appends .plugin-panel-footer to bodyElement", () => {
    createPluginsPanel([], {}, async () => {});
    openPluginsPanel({});
    expect(document.querySelector(".plugin-panel-footer")).not.toBeNull();
  });

  it("clicking the footer button closes the plugin panel and calls openManageVaultsModal", () => {
    const openFn = vi.fn();
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openFn;
    // Open plugin panel, click .plugin-panel-footer-btn.
    expect(openFn).toHaveBeenCalled();
    expect(document.querySelector("#plugins-overlay")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("vault-manage keybinding", () => {
  it("COMMANDS array contains vault-manage entry in View section", () => {
    const cmd = COMMANDS.find((c) => c.id === "vault-manage");
    expect(cmd).toBeDefined();
    expect(cmd!.section).toBe("View");
    expect(cmd!.defaultKey).toBe("");
  });

  it("handleAction('vault-manage') calls __MARKABLE_OPEN_MANAGE_VAULTS__", () => {
    const openFn = vi.fn();
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openFn;
    handleAction("vault-manage");
    expect(openFn).toHaveBeenCalled();
  });

  it("handleAction('vault-manage') is a no-op when global is null", () => {
    (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;
    expect(() => handleAction("vault-manage")).not.toThrow();
  });
});
```

---

## Minimum Test Count

This test file should contain at least 20 named test cases. The list above provides ~22 distinct assertions. Expand with additional edge-case variants as needed to reach the project's standard.

---

## Acceptance Criteria for This Step

- All tests pass (`npm test` or `npx vitest run tests/plugins/file-browser/vault-ux.test.ts`).
- No TODO comments in the test file.
- Each test is deterministic (no timeouts depending on real async; use `vi.useFakeTimers()` for the blur-cancel timer in step_03 tests).
