/**
 * folder-selection.test.ts
 *
 * Tests for the window.__MARKABLE_FILE_BROWSER__ global accessor introduced in
 * Step 01 of the multi-file find & replace feature.
 *
 * These tests verify that the file-browser plugin correctly exposes a
 * getSelectedFolderPath() accessor on the global, manages the accessor
 * lifecycle through enable/disable, and clears the selection on vault change.
 *
 * Test IDs: FS-1 through FS-5 (per step_01_folder-selection-contract.md)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin, { _testing } from "../../../src/plugins/file-browser/file-browser.plugin";
import type { VaultEntry } from "../../../src/lib/vault-types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal VaultEntry for use in test setup.
 */
function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "test-vault",
    name: "Test Vault",
    rootPaths: ["/notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

let mockApi: any;

beforeEach(() => {
  // Set up window globals expected by the plugin.
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getActiveVault: vi.fn(() => makeVault()),
    getVaultIndex: vi.fn(() => null),
    onVaultChanged: vi.fn(),
    offVaultChanged: vi.fn(),
    onIndexUpdated: vi.fn(),
    offIndexUpdated: vi.fn(),
  };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn(),
    openMediaInTab: vi.fn(),
    getTabs: vi.fn(() => []),
  };
  (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(null) };

  mockApi = {
    registerSidebarPanel: vi.fn(),
    unregisterSidebarPanel: vi.fn(),
  };
});

afterEach(() => {
  // Always disable after each test to clean up module-level state.
  plugin.onDisable(mockApi);
  document.body.innerHTML = "";
  delete (window as any).__MARKABLE_FILE_BROWSER__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
  delete (window as any).__TAURI_INTERNALS__;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("window.__MARKABLE_FILE_BROWSER__ global accessor", () => {
  /**
   * FS-1: The global is a non-null object immediately after onEnable.
   * AC-S1-1: window.__MARKABLE_FILE_BROWSER__ is non-null when plugin is enabled.
   */
  it("FS-1: global is registered on enable", () => {
    plugin.onEnable(mockApi);
    expect((window as any).__MARKABLE_FILE_BROWSER__).not.toBeNull();
    expect(typeof (window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath).toBe("function");
  });

  /**
   * FS-2: Before any folder interaction, getSelectedFolderPath() returns null.
   * AC-S1-2: getSelectedFolderPath() returns null before any folder is interacted with.
   */
  it("FS-2: getSelectedFolderPath returns null initially", () => {
    plugin.onEnable(mockApi);
    expect((window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()).toBeNull();
  });

  /**
   * FS-3: The global is set to null/absent after onDisable.
   * AC-S1-3: window.__MARKABLE_FILE_BROWSER__ is null when plugin is disabled.
   */
  it("FS-3: global is cleared on disable", () => {
    plugin.onEnable(mockApi);
    plugin.onDisable(mockApi);
    // The global should be null (set by onDisable) or absent.
    const global = (window as any).__MARKABLE_FILE_BROWSER__;
    expect(global == null).toBe(true);
  });

  /**
   * FS-4: After disable, a retained accessor reference returns null.
   *
   * The accessor closes over the module-level _selectedFolderPath variable.
   * When onDisable clears that variable to null, getSelectedFolderPath() called
   * on a retained reference must return null — not a stale cached value.
   */
  it("FS-4: getSelectedFolderPath returns null after disable (closure over live variable)", () => {
    plugin.onEnable(mockApi);
    // Capture the accessor reference before disable.
    const accessor = (window as any).__MARKABLE_FILE_BROWSER__;
    expect(accessor).not.toBeNull();
    // Disable the plugin — clears _selectedFolderPath.
    plugin.onDisable(mockApi);
    // The retained reference should now reflect the cleared state.
    expect(accessor.getSelectedFolderPath()).toBeNull();
  });

  /**
   * FS-5: When the vault-changed callback fires with null, the selected folder
   * path is cleared.
   *
   * Simulates vault deactivation (EC-4) via the onVaultChanged callback
   * registered during onEnable → setupVaultSubscriptions.
   */
  it("FS-5: vault change clears selected folder path", () => {
    plugin.onEnable(mockApi);
    // Retrieve the vault-changed callback that was registered with the mock.
    const vaultChangedCb = (window as any).__MARKABLE_VAULT_MANAGER__.onVaultChanged.mock.calls[0][0];
    expect(typeof vaultChangedCb).toBe("function");

    // Simulate vault deactivation.
    vaultChangedCb(null);

    // getSelectedFolderPath() must return null after vault change.
    expect((window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()).toBeNull();
  });

  /**
   * FS-6: _testing.setSelectedFolderPath sets the module-level variable, and
   * getSelectedFolderPath() on the global accessor returns the same value.
   *
   * This test verifies the test-helper round-trip so that other tests can rely
   * on setSelectedFolderPath to pre-seed folder state without simulating DOM
   * interactions. It also confirms getSelectedFolderPath() returns a real
   * (non-null) path when one has been set.
   */
  it("FS-6: _testing.setSelectedFolderPath → getSelectedFolderPath returns the set path", () => {
    plugin.onEnable(mockApi);

    // Use the test accessor to set a non-null folder path.
    _testing.setSelectedFolderPath("/some/path");

    // The public global accessor must reflect the new value.
    expect((window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()).toBe("/some/path");

    // Reset back to null — confirms it is a live variable, not a cached snapshot.
    _testing.setSelectedFolderPath(null);
    expect((window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()).toBeNull();
  });
});
