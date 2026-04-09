# Step 02: Frontend Bridge + Init Sequence

**Covers:** R1 (frontend), TC-5, NF1
**Edge Cases:** EC-3 (frontend handling), EC-9 (read-only fallback)
**Depends on:** Step 01 (Rust commands exist)
**Files Created:** `src/lib/settings.ts`, `tests/settings.test.ts`
**Files Modified:** `src/lib/bridge.ts`, `src/lib/errors.ts`, `src/main.ts`, `tests/mocks/tauri.ts`

---

## Objective

Create the TypeScript settings types, bridge functions to call the Rust commands, an in-memory settings singleton, and integrate settings loading into the `initApp()` sequence so settings are applied before `window.show()`.

---

## 1. TypeScript Types

Add to `src/lib/settings.ts`:

```typescript
/** Mirrors the Rust MarkableSettings struct. */
export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
}

export interface WindowSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
  maximized: boolean;
}

export interface EditorSettings {
  contentMaxWidth: number;
  contentPadding: string;
  baseFontSize: number;
}

export interface ThemeSettings {
  active: string;
  fallback: string;
}
```

---

## 2. Default Settings (Frontend Copy)

The frontend needs its own copy of defaults for two reasons:
1. Fallback if `get_settings` fails entirely (EC-9 scenario).
2. "Reset to Defaults" in the settings panel.

```typescript
export const DEFAULT_SETTINGS: MarkableSettings = {
  version: 1,
  window: {
    x: -1,    // sentinel: compute from screen
    y: -1,
    width: 0, // sentinel: compute from screen
    height: 0,
    fullscreen: false,
    maximized: false,
  },
  editor: {
    contentMaxWidth: 900,
    contentPadding: "responsive",
    baseFontSize: 16,
  },
  theme: {
    active: "default-dark",
    fallback: "default-dark",
  },
  recentFiles: [],
};
```

---

## 3. Bridge Functions

Add to `src/lib/bridge.ts`:

```typescript
import type { MarkableSettings } from "./settings";

/**
 * Load settings from the Rust backend.
 * On first launch, Rust creates the file with defaults.
 * On corrupt file, Rust returns defaults.
 */
export async function getSettings(): Promise<FileResult<MarkableSettings>> {
  try {
    const json = await invoke<string>("get_settings");
    const settings: MarkableSettings = JSON.parse(json);
    return { ok: true, value: settings };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "get_settings",
      } satisfies TauriCommandError,
    };
  }
}

/**
 * Save settings to the Rust backend (atomic write).
 * The full settings object is serialized and sent.
 */
export async function saveSettings(
  settings: MarkableSettings
): Promise<FileResult<void>> {
  try {
    const json = JSON.stringify(settings);
    await invoke("save_settings", { settings: json });
    return { ok: true, value: undefined };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: {
        message,
        command: "save_settings",
      } satisfies TauriCommandError,
    };
  }
}
```

---

## 4. In-Memory Settings Singleton

In `src/lib/settings.ts`:

```typescript
import { getSettings, saveSettings } from "./bridge";

/** In-memory settings -- always holds the current state. */
let currentSettings: MarkableSettings = structuredClone(DEFAULT_SETTINGS);

/** Whether settings are writable (false if filesystem is read-only). */
let settingsWritable = true;

/** Get the current in-memory settings (never null). */
export function getCurrentSettings(): MarkableSettings {
  return currentSettings;
}

/**
 * Load settings from disk via the Rust backend.
 * Returns the loaded settings. On failure, returns defaults.
 * This must be called once during initApp(), before window.show().
 */
export async function loadSettings(): Promise<MarkableSettings> {
  const result = await getSettings();

  if (result.ok) {
    currentSettings = result.value;
  } else {
    console.error("Failed to load settings:", result.error.message);
    console.warn("Using default settings.");
    currentSettings = structuredClone(DEFAULT_SETTINGS);
    settingsWritable = false; // Assume write failure means read-only FS
  }

  return currentSettings;
}

/**
 * Update settings in memory and persist to disk.
 * Use for immediate saves (user actions in settings panel).
 *
 * @param updater - Function that receives current settings and returns updated settings.
 */
export async function updateSettings(
  updater: (current: MarkableSettings) => MarkableSettings
): Promise<void> {
  currentSettings = updater(currentSettings);

  if (!settingsWritable) {
    console.warn("Settings not writable. Changes are in-memory only.");
    return;
  }

  const result = await saveSettings(currentSettings);
  if (!result.ok) {
    console.error("Failed to save settings:", result.error.message);
    // EC-23: Non-fatal. Settings remain in memory. Retry on next trigger.
  }
}

/**
 * Debounced settings save.
 * Used for high-frequency events (window move/resize).
 * Only the final state within the debounce window is saved.
 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

export function saveSettingsDebounced(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;

    if (!settingsWritable) return;

    const result = await saveSettings(currentSettings);
    if (!result.ok) {
      console.error("Debounced settings save failed:", result.error.message);
    }
  }, DEBOUNCE_MS);
}

/**
 * Update settings in memory WITHOUT persisting.
 * Used when you want to batch changes and control when the save happens.
 */
export function updateSettingsInMemory(
  updater: (current: MarkableSettings) => MarkableSettings
): void {
  currentSettings = updater(currentSettings);
}
```

---

## 5. Init Sequence Update

Modify `src/main.ts` to load settings before showing the window:

```typescript
import { loadSettings } from "./lib/settings";

async function initApp() {
  console.log("Initializing Markable 2.0...");

  // --- Step 1: Load settings from disk (before any UI) ---
  const settings = await loadSettings();
  console.log("Settings loaded:", settings.version);

  // --- Step 2: Create editor ---
  const editorContainer = document.getElementById("editor");
  if (!editorContainer) {
    console.error("Editor container #editor not found in DOM");
    return;
  }
  editor = createEditor(editorContainer, "");

  // ... (existing editor setup) ...

  // --- Step 3: Apply settings to DOM ---
  // (Detailed in Step 04: editor settings, Step 06: theme persistence)
  // For now, just apply theme
  // setTheme(settings.theme.active as "light" | "dark" | "system");

  // --- Step 4: Set up event listeners ---
  // (existing menu event listener, window state listeners added in Step 03)
  await listen<{ action: string }>("menu-event", (event) => {
    // ... existing switch ...
  });

  // --- Step 5: Show the window ---
  await showWindow();

  console.log("Markable initialized successfully");
}
```

The key change is that `loadSettings()` is called **first**, before the editor is created, before any DOM is manipulated, and before `showWindow()`. This satisfies TC-5 (settings read before window show).

---

## 6. Test Mock Helpers

Add to `tests/mocks/tauri.ts`:

```typescript
import type { MarkableSettings } from "../../src/lib/settings";

export function mockGetSettingsSuccess(settings: MarkableSettings) {
  return vi.fn().mockResolvedValue({
    ok: true,
    value: settings,
  });
}

export function mockGetSettingsError(message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { message, command: "get_settings" },
  });
}

export function mockSaveSettingsSuccess() {
  return vi.fn().mockResolvedValue({
    ok: true,
    value: undefined,
  });
}

export function mockSaveSettingsError(message: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { message, command: "save_settings" },
  });
}
```

---

## 7. Frontend Tests

Create `tests/settings.test.ts`:

```typescript
describe("Settings Types", () => {
  it("DEFAULT_SETTINGS has correct schema version", () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
  });

  it("DEFAULT_SETTINGS has correct editor defaults", () => {
    expect(DEFAULT_SETTINGS.editor.baseFontSize).toBe(16);
    expect(DEFAULT_SETTINGS.editor.contentMaxWidth).toBe(900);
    expect(DEFAULT_SETTINGS.editor.contentPadding).toBe("responsive");
  });

  it("DEFAULT_SETTINGS has correct theme defaults", () => {
    expect(DEFAULT_SETTINGS.theme.active).toBe("default-dark");
    expect(DEFAULT_SETTINGS.theme.fallback).toBe("default-dark");
  });

  it("DEFAULT_SETTINGS has empty recent files", () => {
    expect(DEFAULT_SETTINGS.recentFiles).toEqual([]);
  });

  it("DEFAULT_SETTINGS window uses sentinel values", () => {
    expect(DEFAULT_SETTINGS.window.x).toBe(-1);
    expect(DEFAULT_SETTINGS.window.y).toBe(-1);
    expect(DEFAULT_SETTINGS.window.width).toBe(0);
    expect(DEFAULT_SETTINGS.window.height).toBe(0);
  });
});

describe("Settings Bridge (Mock Verification)", () => {
  it("mocks successful getSettings", async () => {
    const mockFn = mockGetSettingsSuccess(DEFAULT_SETTINGS);
    const result = await mockFn();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.version).toBe(1);
    }
  });

  it("mocks getSettings failure falls back to defaults", async () => {
    const mockFn = mockGetSettingsError("Permission denied");
    const result = await mockFn();
    expect(result.ok).toBe(false);
  });
});
```

---

## Done Criteria

- [ ] `MarkableSettings` and sub-interfaces defined and exported
- [ ] `DEFAULT_SETTINGS` constant matches the JSON schema in requirements
- [ ] `getSettings()` and `saveSettings()` bridge functions implemented
- [ ] `loadSettings()` called in `initApp()` before `createEditor()` and `showWindow()`
- [ ] `updateSettings()` for immediate saves works
- [ ] `saveSettingsDebounced()` for high-frequency saves works
- [ ] `settingsWritable` flag prevents writes when FS is read-only
- [ ] Mock helpers added to `tests/mocks/tauri.ts`
- [ ] `tests/settings.test.ts` passes with `npm test`
- [ ] `tsc --noEmit` passes with no errors
