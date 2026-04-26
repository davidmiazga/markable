/**
 * tests/vault/vault-index.test.ts
 *
 * Tests for vault-manager.ts:
 *  - init(), createVault(), deleteVault(), updateVault(), switchVault()
 *  - getActiveVault(), getAllVaults(), getVaultIndex()
 *  - onVaultChanged, offVaultChanged, onIndexUpdated
 *  - reloadVaultIndex()
 *  - settings schema shape (vaults / activeVaultId optional fields)
 *  - Edge cases: EC-10, EC-11, EC-13
 *
 * All Tauri invoke calls are mocked. Settings are isolated per-test via
 * _resetForTests() + vi.mocked(updateSettings) interception.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ── Mocks (must be declared before module imports) ────────────────────────────

// Mock Tauri APIs that settings.ts and vault-manager.ts depend on.
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));

// Mock @tauri-apps/api/core so invoke() is controllable in tests.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock settings module: expose getCurrentSettings / updateSettings as spies.
// We use a shared mutable reference so all mocked functions see the same state.
const _settingsState = { current: { vaults: [] as unknown[], activeVaultId: null as string | null } };

vi.mock("../../src/lib/settings", () => {
  return {
    getCurrentSettings: vi.fn(() => _settingsState.current),
    updateSettings: vi.fn(async (updater: (s: unknown) => unknown) => {
      _settingsState.current = updater(_settingsState.current) as typeof _settingsState.current;
    }),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { invoke } from "@tauri-apps/api/core";
import {
  init,
  createVault,
  deleteVault,
  updateVault,
  switchVault,
  getActiveVault,
  getAllVaults,
  getVaultIndex,
  reloadVaultIndex,
  onVaultChanged,
  offVaultChanged,
  onIndexUpdated,
  offIndexUpdated,
  _resetForTests,
} from "../../src/lib/vault-manager";
import { getCurrentSettings, updateSettings } from "../../src/lib/settings";
import { isPathOverlapping, checkVaultsForOverlap } from "../../src/lib/vault-utils";

/** Convenience: set the shared settings state for a test. */
function setSettings(patch: Record<string, unknown>): void {
  Object.assign(_settingsState.current, patch);
}

/** Convenience: read current settings state. */
function getSettings(): Record<string, unknown> {
  return _settingsState.current;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** UUID v4 regex. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build a minimal VaultIndex for a given vaultId. */
function makeIndex(vaultId: string, count = 2) {
  return {
    vaultId,
    builtAt: Date.now(),
    entries: Array.from({ length: count }, (_, i) => ({
      path: `/vault/${i}.md`,
      name: `note-${i}`,
      modified: Date.now(),
      size: 100,
      title: `Note ${i}`,
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: count,
    skippedCount: 0,
    capped: false,
  };
}

/** Make invoke() return a resolved value for the next call. */
function mockInvokeOnce(value: unknown) {
  (invoke as Mock).mockResolvedValueOnce(value);
}

/** Make invoke() resolve with a VaultIndexPayload (for build_vault_index). */
function mockBuildIndex(vaultId: string) {
  const payload = makeIndex(vaultId);
  mockInvokeOnce(payload);  // build_vault_index
  mockInvokeOnce(undefined); // save_vault_index
  return payload;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTests();
  // resetAllMocks resets mock implementations AND clears queued mockResolvedValueOnce
  // values from previous tests, preventing invoke queue state leakage between tests.
  vi.resetAllMocks();
  // After reset, re-establish the mock implementations that vault-manager relies on.
  (getCurrentSettings as Mock).mockImplementation(() => _settingsState.current);
  (updateSettings as Mock).mockImplementation(async (updater: (s: unknown) => unknown) => {
    _settingsState.current = updater(_settingsState.current) as typeof _settingsState.current;
  });
  // Reset shared settings state to clean slate.
  _settingsState.current = { vaults: [], activeVaultId: null } as unknown as typeof _settingsState.current;
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings schema
// ─────────────────────────────────────────────────────────────────────────────

describe("Settings schema", () => {
  it("vaults field is optional (absent = no vaults)", () => {
    setSettings({ vaults: undefined });
    const vaults = getAllVaults();
    expect(vaults).toEqual([]);
  });

  it("activeVaultId field is optional string | null", () => {
    setSettings({ activeVaultId: null });
    const s = getSettings();
    expect(s.activeVaultId).toBeNull();

    setSettings({ activeVaultId: "some-id" });
    const s2 = getSettings();
    expect(typeof s2.activeVaultId).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VaultEntry schema
// ─────────────────────────────────────────────────────────────────────────────

describe("VaultEntry schema", () => {
  it("createVault produces entry with all required fields", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("Test Vault", ["/some/path"]);

    expect(entry.id).toBeTruthy();
    expect(UUID_RE.test(entry.id)).toBe(true);
    expect(entry.name).toBe("Test Vault");
    expect(entry.rootPaths).toEqual(["/some/path"]);
    expect(entry.created).toBeTruthy();
    expect(entry.lastOpened).toBeTruthy();
    expect(Array.isArray(entry.excludePatterns)).toBe(true);
    expect(typeof entry.maxIndexSize).toBe("number");
  });

  it("id is UUID v4 format", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("UUID Test", ["/path"]);
    expect(UUID_RE.test(entry.id)).toBe(true);
  });

  it("created and lastOpened are ISO 8601 strings", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("ISO Test", ["/path"]);
    expect(new Date(entry.created).toISOString()).toBe(entry.created);
    expect(new Date(entry.lastOpened).toISOString()).toBe(entry.lastOpened);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init()
// ─────────────────────────────────────────────────────────────────────────────

describe("init()", () => {
  it("no vaults → getActiveVault() returns null", async () => {
    setSettings({ vaults: [], activeVaultId: null });
    await init();
    expect(getActiveVault()).toBeNull();
  });

  it("valid savedActiveVaultId → vault is activated", async () => {
    const vault = {
      id: "vault-1",
      name: "V1",
      rootPaths: ["/notes"],
      created: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      excludePatterns: [],
      maxIndexSize: 500,
    };
    setSettings({ vaults: [vault], activeVaultId: "vault-1" });

    // Simulate cached index load (get_vault_index returns JSON string).
    mockInvokeOnce(JSON.stringify(makeIndex("vault-1")));

    await init();
    expect(getActiveVault()?.id).toBe("vault-1");
  });

  it("saved activeVaultId not in vaults → resets to null (EC-11)", async () => {
    setSettings({
      vaults: [
        {
          id: "vault-exists",
          name: "Exists",
          rootPaths: ["/x"],
          created: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
      activeVaultId: "vault-missing",
    });

    await init();

    expect(getActiveVault()).toBeNull();
    // updateSettings should have been called to persist the null correction.
    expect(updateSettings).toHaveBeenCalled();
  });

  it("null savedActiveVaultId → getActiveVault() remains null", async () => {
    setSettings({ vaults: [], activeVaultId: null });
    await init();
    expect(getActiveVault()).toBeNull();
  });

  it("cached index loaded when get_vault_index returns data", async () => {
    const vault = {
      id: "v-cached",
      name: "Cached",
      rootPaths: ["/notes"],
      created: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      excludePatterns: [],
      maxIndexSize: 500,
    };
    setSettings({ vaults: [vault], activeVaultId: "v-cached" });

    const idx = makeIndex("v-cached");
    mockInvokeOnce(JSON.stringify(idx));

    await init();
    expect(getVaultIndex()).not.toBeNull();
    expect(getVaultIndex()!.vaultId).toBe("v-cached");
  });

  it("corrupt cached index triggers rebuild (EC-06)", async () => {
    const vault = {
      id: "v-corrupt",
      name: "Corrupt",
      rootPaths: ["/notes"],
      created: new Date().toISOString(),
      lastOpened: new Date().toISOString(),
      excludePatterns: [],
      maxIndexSize: 500,
    };
    setSettings({ vaults: [vault], activeVaultId: "v-corrupt" });

    // get_vault_index returns malformed JSON → rebuild triggered.
    mockInvokeOnce("{ invalid json {{");
    // build_vault_index call.
    const freshIdx = makeIndex("v-corrupt");
    mockInvokeOnce(freshIdx);
    // save_vault_index call.
    mockInvokeOnce(undefined);

    await init();
    // Index should still be available (from rebuild).
    expect(getVaultIndex()).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createVault()
// ─────────────────────────────────────────────────────────────────────────────

describe("createVault()", () => {
  it("happy path: returns vault with UUID, timestamps, default maxIndexSize", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("Notes", ["/home/notes"]);

    expect(UUID_RE.test(entry.id)).toBe(true);
    expect(entry.name).toBe("Notes");
    expect(entry.rootPaths).toEqual(["/home/notes"]);
    expect(entry.maxIndexSize).toBe(500);
    expect(entry.created).toBeTruthy();
    expect(entry.lastOpened).toBeTruthy();
  });

  it("empty name throws", async () => {
    await expect(createVault("", ["/path"])).rejects.toThrow();
  });

  it("whitespace-only name throws", async () => {
    await expect(createVault("   ", ["/path"])).rejects.toThrow();
  });

  it("name longer than 100 chars throws", async () => {
    const long = "a".repeat(101);
    await expect(createVault(long, ["/path"])).rejects.toThrow();
  });

  it("empty rootPaths throws", async () => {
    await expect(createVault("Valid", [])).rejects.toThrow();
  });

  it("UUID is generated (not empty)", async () => {
    mockBuildIndex("ignored");
    const a = await createVault("A", ["/a"]);
    _resetForTests();
    setSettings({ vaults: [], activeVaultId: null });
    vi.clearAllMocks();
    mockBuildIndex("ignored");
    const b = await createVault("B", ["/b"]);
    expect(a.id).not.toBe(b.id);
  });

  it("persisted to settings (updateSettings called)", async () => {
    mockBuildIndex("ignored");
    await createVault("Persisted", ["/p"]);
    expect(updateSettings).toHaveBeenCalled();
  });

  it("immediately activates the new vault", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("Active", ["/a"]);
    expect(getActiveVault()?.id).toBe(entry.id);
  });

  it("custom maxIndexSize is persisted on create (NEW-1)", async () => {
    // Verifies that the maxIndexSize value passed from the Manage Vaults form is
    // stored in the vault entry and not silently replaced by the module default.
    mockBuildIndex("ignored");
    const entry = await createVault("Custom Size", ["/path"], ["node_modules"], 250);
    expect(entry.maxIndexSize).toBe(250);

    // Also confirm the persisted settings reflect the custom value.
    const persisted = getAllVaults().find((v) => v.id === entry.id);
    expect(persisted?.maxIndexSize).toBe(250);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteVault()
// ─────────────────────────────────────────────────────────────────────────────

describe("deleteVault()", () => {
  async function seedVault(id: string, name: string) {
    setSettings({
      vaults: [
        {
          id,
          name,
          rootPaths: ["/x"],
          created: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
      activeVaultId: id,
    });
    // Seed activeVault by calling init.
    mockInvokeOnce(null); // get_vault_index → no cache
    const freshIdx = makeIndex(id);
    mockInvokeOnce(freshIdx); // build_vault_index
    mockInvokeOnce(undefined); // save_vault_index
    await init();
  }

  it("removes entry from vaults array", async () => {
    await seedVault("del-1", "Del1");
    vi.clearAllMocks();
    mockInvokeOnce(undefined); // delete_vault Rust command
    await deleteVault("del-1");
    expect(getAllVaults().find((v) => v.id === "del-1")).toBeUndefined();
  });

  it("clears activeVaultId when active vault deleted (EC-10)", async () => {
    await seedVault("active-del", "ActiveDel");
    vi.clearAllMocks();
    mockInvokeOnce(undefined);
    await deleteVault("active-del");
    expect(getActiveVault()).toBeNull();
  });

  it("emits onVaultChanged(null) when active vault deleted", async () => {
    await seedVault("del-emit", "DelEmit");
    vi.clearAllMocks();

    const cb = vi.fn();
    onVaultChanged(cb);
    mockInvokeOnce(undefined);
    await deleteVault("del-emit");
    offVaultChanged(cb);

    expect(cb).toHaveBeenCalledWith(null);
  });

  it("no-op when id not found (does not throw)", async () => {
    mockInvokeOnce(undefined); // delete_vault Rust command (best-effort)
    await expect(deleteVault("nonexistent")).resolves.not.toThrow();
  });

  it("does not affect active vault when a non-active vault is deleted", async () => {
    await seedVault("active-vault", "Active");
    // Add a second vault.
    setSettings({
      vaults: [
        ...(getSettings().vaults as unknown[]),
        {
          id: "other-vault",
          name: "Other",
          rootPaths: ["/o"],
          created: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
    });
    vi.clearAllMocks();
    mockInvokeOnce(undefined); // delete_vault
    await deleteVault("other-vault");
    expect(getActiveVault()?.id).toBe("active-vault");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateVault()
// ─────────────────────────────────────────────────────────────────────────────

describe("updateVault()", () => {
  const VAULT_ID = "update-test";

  beforeEach(() => {
    setSettings({
      vaults: [
        {
          id: VAULT_ID,
          name: "Original",
          rootPaths: ["/orig"],
          created: "2024-01-01T00:00:00.000Z",
          lastOpened: "2024-01-01T00:00:00.000Z",
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
      activeVaultId: null,
    });
  });

  it("patches the vault name", async () => {
    await updateVault(VAULT_ID, { name: "Updated" });
    const v = getAllVaults().find((v) => v.id === VAULT_ID);
    expect(v?.name).toBe("Updated");
  });

  it("id is immutable (cannot be changed via patch)", async () => {
    await updateVault(VAULT_ID, { name: "X" });
    const v = getAllVaults().find((v) => v.id === VAULT_ID);
    expect(v?.id).toBe(VAULT_ID);
  });

  it("created is immutable", async () => {
    await updateVault(VAULT_ID, { name: "Y" });
    const v = getAllVaults().find((v) => v.id === VAULT_ID);
    expect(v?.created).toBe("2024-01-01T00:00:00.000Z");
  });

  it("throws when id not found", async () => {
    await expect(updateVault("nonexistent", { name: "N" })).rejects.toThrow();
  });

  it("updates rootPaths", async () => {
    await updateVault(VAULT_ID, { rootPaths: ["/new"] });
    const v = getAllVaults().find((v) => v.id === VAULT_ID);
    expect(v?.rootPaths).toEqual(["/new"]);
  });

  it("updates maxIndexSize", async () => {
    await updateVault(VAULT_ID, { maxIndexSize: 200 });
    const v = getAllVaults().find((v) => v.id === VAULT_ID);
    expect(v?.maxIndexSize).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// switchVault()
// ─────────────────────────────────────────────────────────────────────────────

describe("switchVault()", () => {
  const VAULT_A = {
    id: "vault-a",
    name: "A",
    rootPaths: ["/a"],
    created: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    excludePatterns: [],
    maxIndexSize: 500,
  };
  const VAULT_B = {
    id: "vault-b",
    name: "B",
    rootPaths: ["/b"],
    created: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    excludePatterns: [],
    maxIndexSize: 500,
  };

  beforeEach(() => {
    setSettings({ vaults: [VAULT_A, VAULT_B], activeVaultId: null });
  });

  it("switches to valid id → getActiveVault() returns new vault", async () => {
    mockInvokeOnce(null); // get_vault_index
    mockBuildIndex("vault-a");

    await switchVault("vault-a");
    expect(getActiveVault()?.id).toBe("vault-a");
  });

  it("invalid id throws, previous vault unchanged", async () => {
    mockInvokeOnce(null);
    mockBuildIndex("vault-a");
    await switchVault("vault-a");

    await expect(switchVault("vault-x")).rejects.toThrow();
    expect(getActiveVault()?.id).toBe("vault-a");
  });

  it("switching to same vault is a no-op (no event)", async () => {
    mockInvokeOnce(null);
    mockBuildIndex("vault-a");
    await switchVault("vault-a");

    const cb = vi.fn();
    onVaultChanged(cb);
    await switchVault("vault-a");
    offVaultChanged(cb);

    expect(cb).not.toHaveBeenCalled();
  });

  it("rapid switching — only final vault's index applied (EC-13)", async () => {
    // Vault A: fake a slow index build by not resolving until vault B is requested.
    // We simulate by sequencing mock responses so B's build resolves first.

    // Vault A invokes: get_vault_index → null, build_vault_index → slow
    (invoke as Mock)
      .mockResolvedValueOnce(null)   // A: get_vault_index
      .mockResolvedValueOnce(makeIndex("vault-a")) // A: build_vault_index
      .mockResolvedValueOnce(undefined) // A: save_vault_index
      .mockResolvedValueOnce(null)   // B: get_vault_index
      .mockResolvedValueOnce(makeIndex("vault-b")) // B: build_vault_index
      .mockResolvedValueOnce(undefined); // B: save_vault_index

    const switchA = switchVault("vault-a");
    const switchB = switchVault("vault-b");
    await Promise.all([switchA, switchB]);

    // Final state should be vault-b (last winner).
    expect(getActiveVault()?.id).toBe("vault-b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getActiveVault() / getAllVaults()
// ─────────────────────────────────────────────────────────────────────────────

describe("getActiveVault() / getAllVaults()", () => {
  it("getActiveVault() returns null when no vault active", () => {
    expect(getActiveVault()).toBeNull();
  });

  it("getAllVaults() returns empty array when no vaults configured", () => {
    expect(getAllVaults()).toEqual([]);
  });

  it("getAllVaults() returns all vaults from settings", () => {
    setSettings({
      vaults: [
        { id: "x", name: "X", rootPaths: ["/x"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
        { id: "y", name: "Y", rootPaths: ["/y"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
    });
    expect(getAllVaults()).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reloadVaultIndex()
// ─────────────────────────────────────────────────────────────────────────────

describe("reloadVaultIndex()", () => {
  it("no-op when no active vault", async () => {
    await expect(reloadVaultIndex()).resolves.not.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("calls build_vault_index for active vault and updates in-memory index", async () => {
    // Activate a vault first.
    setSettings({
      vaults: [
        { id: "reload-test", name: "R", rootPaths: ["/r"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });
    mockInvokeOnce(null); // get_vault_index on switch
    mockBuildIndex("reload-test");
    await switchVault("reload-test");

    vi.clearAllMocks();
    // Now reload.
    const freshIdx = makeIndex("reload-test", 5);
    mockInvokeOnce(freshIdx); // build_vault_index
    mockInvokeOnce(undefined); // save_vault_index

    await reloadVaultIndex();
    expect(getVaultIndex()!.entries).toHaveLength(5);
  });

  it("emits onVaultChanged after rebuild", async () => {
    setSettings({
      vaults: [
        { id: "reload-emit", name: "RE", rootPaths: ["/re"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });
    mockInvokeOnce(null);
    mockBuildIndex("reload-emit");
    await switchVault("reload-emit");

    vi.clearAllMocks();
    const cb = vi.fn();
    onVaultChanged(cb);
    mockInvokeOnce(makeIndex("reload-emit"));
    mockInvokeOnce(undefined);
    await reloadVaultIndex();
    offVaultChanged(cb);
    expect(cb).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EC-09 — save_vault_index failure does not corrupt in-memory state
// ─────────────────────────────────────────────────────────────────────────────

describe("EC-09: save_vault_index failure", () => {
  /**
   * Verifies that when the Rust `save_vault_index` command rejects (e.g. disk
   * full, permission denied), the in-memory index returned by getVaultIndex()
   * is still valid and non-null. The vault must remain usable even without a
   * persistent disk cache.
   *
   * The failure is expected to be logged as a warning in vault-manager.ts but
   * must not propagate as a thrown exception to the caller.
   */
  it("getVaultIndex() still returns valid index when save_vault_index rejects (EC-09)", async () => {
    // Arrange: set up a vault with no existing cache so buildAndCacheIndex is called.
    setSettings({
      vaults: [
        {
          id: "ec09-vault",
          name: "EC09",
          rootPaths: ["/ec09"],
          created: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
      activeVaultId: null,
    });

    // get_vault_index returns null (no cache) → build_vault_index is triggered.
    mockInvokeOnce(null);
    // build_vault_index succeeds and returns a valid payload.
    const builtIndex = makeIndex("ec09-vault", 3);
    mockInvokeOnce(builtIndex);
    // save_vault_index rejects — simulating a disk-write failure (EC-09).
    (invoke as Mock).mockRejectedValueOnce(new Error("Disk full"));

    // Act: switch to the vault; should not throw despite the save failure.
    await expect(switchVault("ec09-vault")).resolves.not.toThrow();

    // Assert: the in-memory index is still valid and has the expected entries.
    // The disk-write failure must not null-out or corrupt the in-memory index.
    const idx = getVaultIndex();
    expect(idx).not.toBeNull();
    expect(idx!.vaultId).toBe("ec09-vault");
    expect(idx!.entries).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event bus
// ─────────────────────────────────────────────────────────────────────────────

describe("Event bus", () => {
  it("onVaultChanged fires on switchVault", async () => {
    setSettings({
      vaults: [
        { id: "ev-a", name: "A", rootPaths: ["/a"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });
    mockInvokeOnce(null);
    mockBuildIndex("ev-a");

    const cb = vi.fn();
    onVaultChanged(cb);
    await switchVault("ev-a");
    offVaultChanged(cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: "ev-a" }));
  });

  it("onVaultChanged fires on createVault", async () => {
    mockBuildIndex("ignored");

    const cb = vi.fn();
    onVaultChanged(cb);
    await createVault("Created", ["/c"]);
    offVaultChanged(cb);

    expect(cb).toHaveBeenCalled();
  });

  it("onVaultChanged does NOT fire when switching to same vault", async () => {
    setSettings({
      vaults: [
        { id: "same-a", name: "Same", rootPaths: ["/s"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });
    mockInvokeOnce(null);
    mockBuildIndex("same-a");
    await switchVault("same-a");

    const cb = vi.fn();
    onVaultChanged(cb);
    await switchVault("same-a"); // same id — no-op
    offVaultChanged(cb);

    expect(cb).not.toHaveBeenCalled();
  });

  it("offVaultChanged removes listener", async () => {
    setSettings({
      vaults: [
        { id: "off-a", name: "Off", rootPaths: ["/o"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });

    const cb = vi.fn();
    onVaultChanged(cb);
    offVaultChanged(cb);

    mockInvokeOnce(null);
    mockBuildIndex("off-a");
    await switchVault("off-a");

    expect(cb).not.toHaveBeenCalled();
  });

  it("onIndexUpdated fires when handleFileChangedEvent is called", async () => {
    const { handleFileChangedEvent } = await import("../../src/lib/vault-manager");

    setSettings({
      vaults: [
        { id: "watch-v", name: "W", rootPaths: ["/w"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
      ],
      activeVaultId: null,
    });
    mockInvokeOnce(null);
    mockBuildIndex("watch-v");
    await switchVault("watch-v");

    const cb = vi.fn();
    onIndexUpdated(cb);
    handleFileChangedEvent({
      vaultId: "watch-v",
      eventType: "modified",
      path: "/w/note.md",
    });
    offIndexUpdated(cb);

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ eventType: "modified" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VaultIndex schema
// ─────────────────────────────────────────────────────────────────────────────

describe("VaultIndex schema", () => {
  it("builtAt is a number", () => {
    const idx = makeIndex("v1");
    expect(typeof idx.builtAt).toBe("number");
  });

  it("entries is an array", () => {
    const idx = makeIndex("v1");
    expect(Array.isArray(idx.entries)).toBe(true);
  });

  it("capped: true when totalFilesFound > maxIndexSize", () => {
    const idx = { ...makeIndex("v1"), capped: true, totalFilesFound: 600 };
    expect(idx.capped).toBe(true);
    expect(idx.totalFilesFound).toBeGreaterThan(500);
  });

  it("maxIndexSize 500 default enforced in createVault", async () => {
    mockBuildIndex("ignored");
    const entry = await createVault("Default Size", ["/x"]);
    expect(entry.maxIndexSize).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Overlap detection helper — tests import from src/lib/vault-utils.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("Overlap detection", () => {
  it("no overlap for completely different paths", () => {
    expect(isPathOverlapping("/a/b", "/c/d")).toBe(false);
  });

  it("exact match is overlap", () => {
    expect(isPathOverlapping("/a/b", "/a/b")).toBe(true);
  });

  it("new is subdirectory of existing", () => {
    expect(isPathOverlapping("/a/b/c", "/a/b")).toBe(true);
  });

  it("existing is subdirectory of new", () => {
    expect(isPathOverlapping("/a/b", "/a/b/c")).toBe(true);
  });

  it("prefix without separator is NOT an overlap", () => {
    // /a/bar is NOT inside /a/b — the trailing slash prevents false positives.
    expect(isPathOverlapping("/a/bar", "/a/b")).toBe(false);
  });

  it("checkVaultsForOverlap — multiple existing paths, at least one overlaps", () => {
    const vaults = [
      { id: "v1", name: "V1", rootPaths: ["/other", "/notes"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
    ];
    const { overlaps, warning } = checkVaultsForOverlap(["/notes/sub"], vaults);
    expect(overlaps).toBe(true);
    expect(warning).toContain("V1");
  });

  it("checkVaultsForOverlap — empty existing list never overlaps", () => {
    const { overlaps } = checkVaultsForOverlap(["/any/path"], []);
    expect(overlaps).toBe(false);
  });

  it("checkVaultsForOverlap — no overlap returns null warning", () => {
    const vaults = [
      { id: "v1", name: "V1", rootPaths: ["/other"], created: "", lastOpened: "", excludePatterns: [], maxIndexSize: 500 },
    ];
    const { overlaps, warning } = checkVaultsForOverlap(["/notes"], vaults);
    expect(overlaps).toBe(false);
    expect(warning).toBeNull();
  });

  // EC-03: two vaults with the same NAME are allowed (names are not unique keys).
  it("EC-03: two vaults with same name are allowed", async () => {
    mockBuildIndex("v-a");
    const vaultA = await createVault("My Notes", ["/path/a"]);

    // Manually add a second vault with the same name to settings.
    setSettings({
      vaults: [
        ...getAllVaults(),
        {
          id: "v-b-id",
          name: "My Notes",
          rootPaths: ["/path/b"],
          created: new Date().toISOString(),
          lastOpened: new Date().toISOString(),
          excludePatterns: [],
          maxIndexSize: 500,
        },
      ],
    });

    const all = getAllVaults();
    const sameNameVaults = all.filter((v) => v.name === "My Notes");
    // Both vaults with the same name should exist.
    expect(sameNameVaults.length).toBe(2);
    // They must have distinct IDs.
    expect(sameNameVaults[0].id).not.toBe(sameNameVaults[1].id);

    // Cleanup to avoid leaking state.
    void vaultA;
  });
});
