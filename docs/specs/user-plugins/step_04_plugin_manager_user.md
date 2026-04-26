# Step 04 — PluginManager Extension

**Objective:** Extend `src/plugins/index.ts` with user plugin storage, `loadUserPlugins()`, `reloadUserPlugins()`, `toggleUserPlugin()`, `getUserDefinitions()`, and `getUserStates()`. All built-in plugin methods are unchanged.

**Traceability:** PC-2, PC-7, PC-10, EC-6, EC-7, EC-8, EC-9, EC-10, EC-17, EC-21, EC-22.

---

## Files to Modify

### `src/plugins/index.ts`

The current file is 171 lines. The complete modified version is described below as a diff. Built-in plugin methods (`getExtensions`, `toggle`, `restoreAll`, `getStates`, `getDefinitions`) are untouched.

#### New imports to add (after existing imports at lines 21–24)

```typescript
import type { UserPlugin, UserPluginDef } from "./user-plugin-types";
import type { MarkableSettings } from "../lib/settings";
import { evaluatePlugin, buildUserPluginAPI } from "./user-plugin-loader";
import { listUserPlugins, readPluginFile } from "../lib/bridge";
import { updateSettings } from "../lib/settings";
```

Note: `updateSettings` is already imported at line 24 — do not duplicate it.

#### New internal type to add inside the class (or just above the class)

Place this interface just above the `export class PluginManager` declaration:

```typescript
/**
 * Internal record for a registered user plugin.
 * Tracks the plugin object, its pre-built API, and its load status.
 */
interface UserPluginRecord {
  /** The plugin object returned by evaluation. Null for failed-to-load entries. */
  plugin: UserPlugin | null;
  /** The UserPluginAPI instance bound to this plugin. Null for failed entries. */
  api: ReturnType<typeof buildUserPluginAPI> | null;
  /** Filename on disk, used to deduplicate during reload (PC-10). */
  filename: string;
  /** "loaded" = OK; "failed" = eval/validation error; "missing" = file gone. */
  status: "loaded" | "failed" | "missing";
  failReason?: string;
}
```

#### New private field to add to the class body (after `private plugins: MarkablePlugin[];`)

```typescript
  private userPluginRecords: UserPluginRecord[] = [];
```

#### New methods to add to the class body (after `getDefinitions()`)

```typescript
  // ── User Plugin API ──────────────────────────────────────────────────────

  /**
   * Discover, evaluate, validate, and register user plugins from disk.
   *
   * Called once during initApp() after the editor is created and built-in
   * plugins are restored. Reads the plugins directory via Rust commands,
   * evaluates each .js file, and restores enabled state from settings.
   *
   * Already-registered filenames are skipped (EC-21 idempotency).
   * Failed-to-load plugins are recorded with status "failed" so the panel
   * can display them with an error badge (EC-3).
   * One failing plugin does not prevent others from loading (EC-3).
   *
   * @param ctx       PluginContext from buildPluginContext() in main.ts.
   * @param settings  Loaded MarkableSettings for restoring enabled state.
   */
  async loadUserPlugins(ctx: PluginContext, settings: MarkableSettings): Promise<void> {
    const builtinIds = new Set(this.plugins.map((p) => p.id));

    let filenames: string[];
    try {
      filenames = await listUserPlugins(); // PC-7: max 50, lexicographic (Rust side)
    } catch (err) {
      console.error("PluginManager.loadUserPlugins: failed to list plugins directory:", err);
      return;
    }

    const registeredFilenames = new Set(this.userPluginRecords.map((r) => r.filename));

    for (const filename of filenames) {
      // EC-21: skip already-registered filenames (including failed ones).
      if (registeredFilenames.has(filename)) continue;

      // Read source via Rust (path-confined, size-limited — PC-4, PC-8).
      const source = await readPluginFile(filename);
      if (source === null) {
        // Rust command rejected the file (too large, binary, not found).
        this.userPluginRecords.push({
          plugin: null,
          api: null,
          filename,
          status: "failed",
          failReason: `${filename}: failed to read (file too large, binary, or not found)`,
        });
        console.warn(`[PluginManager] Skipped "${filename}": could not read file.`);
        continue;
      }

      // Evaluate and validate (EC-2 through EC-5, EC-20).
      const result = evaluatePlugin(source, filename);

      if (!result.ok) {
        this.userPluginRecords.push({
          plugin: null,
          api: null,
          filename,
          status: "failed",
          failReason: result.reason,
        });
        console.warn(`[PluginManager] Skipped "${filename}": ${result.reason}`);
        continue;
      }

      const { plugin } = result;

      // EC-7: user plugin id must not collide with built-in ids.
      if (builtinIds.has(plugin.id)) {
        this.userPluginRecords.push({
          plugin: null,
          api: null,
          filename,
          status: "failed",
          failReason: `${filename}: id "${plugin.id}" collides with a built-in plugin id`,
        });
        console.warn(
          `[PluginManager] Rejected "${filename}": id "${plugin.id}" collides with built-in.`,
        );
        continue;
      }

      // EC-6: user plugin id must not collide with already-registered user plugins.
      const existingIds = new Set(
        this.userPluginRecords
          .filter((r) => r.plugin !== null)
          .map((r) => r.plugin!.id),
      );
      if (existingIds.has(plugin.id)) {
        this.userPluginRecords.push({
          plugin: null,
          api: null,
          filename,
          status: "failed",
          failReason: `${filename}: id "${plugin.id}" collides with another user plugin`,
        });
        console.warn(
          `[PluginManager] Rejected "${filename}": id "${plugin.id}" already registered.`,
        );
        continue;
      }

      // Build API for this plugin (statusBar zones from ctx).
      const api = buildUserPluginAPI(plugin.id, ctx.statusBar);

      this.userPluginRecords.push({
        plugin,
        api,
        filename,
        status: "loaded",
      });

      // Restore enabled state from settings (PC-5).
      const savedState = settings.userPlugins?.[plugin.id];
      if (savedState?.enabled === true) {
        await this._enableUserPlugin(plugin, api);
      }
    }
  }

  /**
   * Rescan the plugins directory and register any new .js files.
   *
   * PC-10: Already-registered filenames (including failed ones) are NOT
   * re-evaluated. Only brand-new files are processed.
   *
   * EC-21: already-loaded plugins are kept as-is.
   * EC-22: corrected files are not picked up until the next app launch.
   *
   * @param ctx       PluginContext to use for any newly-enabled plugins.
   * @param settings  Current settings for restoring enabled state of new plugins.
   * @returns         Number of newly registered plugins (for UI feedback).
   */
  async reloadUserPlugins(ctx: PluginContext, settings: MarkableSettings): Promise<number> {
    const countBefore = this.userPluginRecords.length;
    await this.loadUserPlugins(ctx, settings);
    return this.userPluginRecords.length - countBefore;
  }

  /**
   * Enable or disable a user plugin by id.
   *
   * Errors in onEnable/onDisable are caught per-plugin (EC-8, EC-9, EC-10).
   * The enabled state is persisted to settings.userPlugins (PC-5).
   *
   * @param id      Plugin id — must match a loaded user plugin's id.
   * @param enabled Target state.
   * @param ctx     PluginContext (needed to build API if not yet built).
   */
  async toggleUserPlugin(id: string, enabled: boolean, ctx: PluginContext): Promise<void> {
    const record = this.userPluginRecords.find(
      (r) => r.plugin !== null && r.plugin.id === id,
    );
    if (!record || record.plugin === null || record.api === null) {
      console.warn(`PluginManager.toggleUserPlugin: unknown or failed plugin id "${id}"`);
      return;
    }

    if (enabled) {
      await this._enableUserPlugin(record.plugin, record.api);
    } else {
      await this._disableUserPlugin(record.plugin, record.api);
    }

    // Persist state (PC-5).
    void updateSettings((s) => ({
      ...s,
      userPlugins: {
        ...(s.userPlugins ?? {}),
        [id]: { enabled },
      },
    }));
  }

  /**
   * Returns UserPluginDef[] for all registered user plugin records (loaded +
   * failed + missing), in registration order.
   * Used by createPluginsPanel() as the data source for the User Plugins section.
   */
  getUserDefinitions(): UserPluginDef[] {
    return this.userPluginRecords.map((r) => ({
      id: r.plugin?.id ?? `__failed__${r.filename}`,
      name: r.plugin?.name ?? r.filename,
      description: r.plugin?.description ?? "Failed to load",
      detail: r.plugin?.detail ?? r.plugin?.description ?? "Failed to load",
      status: r.status,
      failReason: r.failReason,
    }));
  }

  /**
   * Returns a snapshot of all loaded user plugins' enabled states.
   * Failed and missing plugins are reported as false.
   */
  getUserStates(): Record<string, boolean> {
    const states: Record<string, boolean> = {};
    for (const record of this.userPluginRecords) {
      if (record.plugin) {
        // isEnabled is not part of UserPlugin; track enabled state externally.
        // The enabled state is derived from the last toggle call or settings restore.
        // Store it on the record (see _enableUserPlugin/_disableUserPlugin).
        states[record.plugin.id] = (record as UserPluginRecord & { _enabled?: boolean })._enabled ?? false;
      }
    }
    return states;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Call plugin.onEnable(api) with async-aware error isolation.
   * EC-8: synchronous throw caught.
   * EC-9: rejected promise caught.
   */
  private async _enableUserPlugin(plugin: UserPlugin, api: UserPluginAPI): Promise<void> {
    try {
      const result = plugin.onEnable(api);
      if (result instanceof Promise) {
        await result;
      }
      // Mark enabled on the record.
      const record = this.userPluginRecords.find((r) => r.plugin === plugin);
      if (record) (record as UserPluginRecord & { _enabled?: boolean })._enabled = true;
    } catch (err) {
      console.error(`[UserPlugin:${plugin.id}] onEnable threw:`, err);
      const record = this.userPluginRecords.find((r) => r.plugin === plugin);
      if (record) (record as UserPluginRecord & { _enabled?: boolean })._enabled = false;
    }
  }

  /**
   * Call plugin.onDisable(api) with error isolation.
   * EC-10: throw caught; state forced to disabled.
   * EC-16: called even if the plugin is in an error state.
   */
  private async _disableUserPlugin(plugin: UserPlugin, api: UserPluginAPI): Promise<void> {
    try {
      const result = plugin.onDisable(api);
      if (result instanceof Promise) {
        await result;
      }
    } catch (err) {
      console.error(`[UserPlugin:${plugin.id}] onDisable threw:`, err);
    } finally {
      const record = this.userPluginRecords.find((r) => r.plugin === plugin);
      if (record) (record as UserPluginRecord & { _enabled?: boolean })._enabled = false;
    }
  }
```

#### Note on `_enabled` tracking

`UserPlugin` does not have an `isEnabled()` method (unlike `MarkablePlugin`). The enabled state is tracked by augmenting `UserPluginRecord` with a `_enabled` boolean flag that is set by `_enableUserPlugin` and `_disableUserPlugin`. The `UserPluginAPI` import is needed in `index.ts` — add it to the imports from `./user-plugin-types`.

The complete private `_enabled` field should be added to `UserPluginRecord` directly rather than casting at runtime. Revise the interface definition:

```typescript
interface UserPluginRecord {
  plugin: UserPlugin | null;
  api: ReturnType<typeof buildUserPluginAPI> | null;
  filename: string;
  status: "loaded" | "failed" | "missing";
  failReason?: string;
  _enabled: boolean;  // Track runtime enabled state
}
```

Initialize `_enabled: false` when pushing new records. Replace all `(record as UserPluginRecord & { _enabled?: boolean })._enabled` casts with `record._enabled`.

---

## Test file to create: `tests/plugin-manager-user.test.ts`

```typescript
/**
 * Tests for PluginManager user plugin methods.
 *
 * Uses vi.mock to stub bridge functions so no Tauri runtime is needed.
 * Exercises loadUserPlugins, toggleUserPlugin, getUserDefinitions, getUserStates.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager } from "../src/plugins/index";
import type { PluginContext } from "../src/plugins/plugin-types";
import type { MarkableSettings } from "../src/lib/settings";

// Stub bridge functions
vi.mock("../src/lib/bridge", () => ({
  listUserPlugins: vi.fn(),
  readPluginFile: vi.fn(),
  readPluginSettings: vi.fn().mockResolvedValue(null),
  writePluginSettings: vi.fn().mockResolvedValue(undefined),
  updateRecentFilesMenu: vi.fn(),
  listThemes: vi.fn().mockResolvedValue([]),
  updateThemeMenu: vi.fn(),
  readThemeCss: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  saveHtmlDialog: vi.fn(),
  readResourceFile: vi.fn(),
  readText: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("../src/lib/settings", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lib/settings")>();
  return { ...orig, updateSettings: vi.fn().mockResolvedValue(undefined) };
});

const VALID_SOURCE = `
return {
  id: "user-test-plugin",
  name: "User Test Plugin",
  description: "A test user plugin.",
  onEnable(api) {},
  onDisable(api) {},
};
`;

function makeCtx(): PluginContext {
  return {
    editor: { dispatch: vi.fn() } as unknown as PluginContext["editor"],
    statusBar: {
      left: document.createElement("div"),
      center: document.createElement("div"),
      right: document.createElement("div"),
    },
    ensureStatusBar: vi.fn(),
    hideStatusBarIfUnused: vi.fn(),
  };
}

function makeSettings(userPlugins?: Record<string, { enabled: boolean }>): MarkableSettings {
  return {
    version: 1,
    window: { sizeW: "80%", sizeH: "80%", maximizeOnLaunch: false },
    editor: { contentWidth: "900px", fontSize: 16 },
    theme: { active: "system" },
    recentFiles: [],
    findWidget: null,
    userPlugins,
  } as unknown as MarkableSettings;
}

describe("PluginManager — user plugin loading", () => {
  let mgr: PluginManager;
  let ctx: PluginContext;

  beforeEach(async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue(["my-plugin.js"]);
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_SOURCE);
    mgr = new PluginManager();
    ctx = makeCtx();
  });

  it("loads a valid plugin and adds it to getUserDefinitions()", async () => {
    await mgr.loadUserPlugins(ctx, makeSettings());
    const defs = mgr.getUserDefinitions();
    expect(defs.some((d) => d.id === "user-test-plugin")).toBe(true);
  });

  it("sets status 'loaded' for a valid plugin", async () => {
    await mgr.loadUserPlugins(ctx, makeSettings());
    const def = mgr.getUserDefinitions().find((d) => d.id === "user-test-plugin");
    expect(def?.status).toBe("loaded");
  });

  it("restores enabled state from settings", async () => {
    await mgr.loadUserPlugins(ctx, makeSettings({ "user-test-plugin": { enabled: true } }));
    expect(mgr.getUserStates()["user-test-plugin"]).toBe(true);
  });

  it("EC-6: rejects second plugin with duplicate id", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue(["a.js", "b.js"]);
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_SOURCE);
    await mgr.loadUserPlugins(ctx, makeSettings());
    const defs = mgr.getUserDefinitions();
    const loaded = defs.filter((d) => d.status === "loaded");
    const failed = defs.filter((d) => d.status === "failed");
    expect(loaded.length).toBe(1);
    expect(failed.length).toBe(1);
  });

  it("EC-7: rejects user plugin whose id matches a built-in", async () => {
    const bridge = await import("../src/lib/bridge");
    const collidingSource = VALID_SOURCE.replace("user-test-plugin", "focusMode");
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(collidingSource);
    await mgr.loadUserPlugins(ctx, makeSettings());
    const def = mgr.getUserDefinitions()[0];
    expect(def.status).toBe("failed");
    expect(def.failReason).toContain("built-in");
  });

  it("EC-21: does not re-evaluate already-registered filenames on reload", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_SOURCE);
    await mgr.loadUserPlugins(ctx, makeSettings());
    const readCount = (bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length;
    await mgr.reloadUserPlugins(ctx, makeSettings());
    expect((bridge.readPluginFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(readCount);
  });

  it("EC-3: marks plugin as failed when source has syntax error", async () => {
    const bridge = await import("../src/lib/bridge");
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue("return { ;;; }");
    await mgr.loadUserPlugins(ctx, makeSettings());
    const def = mgr.getUserDefinitions()[0];
    expect(def.status).toBe("failed");
  });

  it("EC-8/EC-9: onEnable throw does not propagate to caller", async () => {
    const bridge = await import("../src/lib/bridge");
    const throwSrc = `
      return {
        id: "throwing-plugin",
        name: "Throwing",
        description: "Throws on enable.",
        onEnable(api) { throw new Error("boom"); },
        onDisable(api) {},
      };
    `;
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(throwSrc);
    await expect(
      mgr.loadUserPlugins(ctx, makeSettings({ "throwing-plugin": { enabled: true } }))
    ).resolves.not.toThrow();
    expect(mgr.getUserStates()["throwing-plugin"]).toBe(false);
  });
});

describe("PluginManager — toggleUserPlugin()", () => {
  let mgr: PluginManager;
  let ctx: PluginContext;

  beforeEach(async () => {
    vi.resetAllMocks();
    const bridge = await import("../src/lib/bridge");
    (bridge.listUserPlugins as ReturnType<typeof vi.fn>).mockResolvedValue(["p.js"]);
    (bridge.readPluginFile as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_SOURCE);
    mgr = new PluginManager();
    ctx = makeCtx();
    await mgr.loadUserPlugins(ctx, makeSettings());
  });

  it("enables a user plugin", async () => {
    await mgr.toggleUserPlugin("user-test-plugin", true, ctx);
    expect(mgr.getUserStates()["user-test-plugin"]).toBe(true);
  });

  it("disables a user plugin", async () => {
    await mgr.toggleUserPlugin("user-test-plugin", true, ctx);
    await mgr.toggleUserPlugin("user-test-plugin", false, ctx);
    expect(mgr.getUserStates()["user-test-plugin"]).toBe(false);
  });

  it("warns on unknown id and does not throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(mgr.toggleUserPlugin("no-such-id", true, ctx)).resolves.not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no-such-id"));
    warn.mockRestore();
  });
});
```

---

## Verification Checklist

- [ ] `PluginManager.loadUserPlugins()` is `async` and awaits all bridge and plugin calls.
- [ ] `PluginManager.reloadUserPlugins()` skips already-registered filenames (EC-21).
- [ ] Corrected plugin files are not re-evaluated on reload (EC-22 — documented limitation, not a bug).
- [ ] `toggleUserPlugin` catches `onEnable` throws synchronously and via promise rejection (EC-8, EC-9).
- [ ] `toggleUserPlugin` catches `onDisable` throws (EC-10), forces `_enabled = false`.
- [ ] `getUserDefinitions()` returns records for failed plugins with `status: "failed"` and `failReason` set.
- [ ] Built-in plugin methods (`getExtensions`, `toggle`, `restoreAll`, `getStates`, `getDefinitions`) are unchanged and all existing `tests/plugin-manager.test.ts` tests still pass.
- [ ] User plugin id collision with built-in is rejected with `status: "failed"` (EC-7).
- [ ] User plugin id collision with another user plugin is rejected (EC-6).
- [ ] All new tests in `tests/plugin-manager-user.test.ts` pass.
