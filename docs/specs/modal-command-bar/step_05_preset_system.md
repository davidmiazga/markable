---
title: "Step 05 — Preset System"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 05 — Preset System

## Goal and Scope

Implement the keybinding preset system: a dropdown in the Keybindings mode bar that lets users save, load, rename, and delete preset keybinding configurations. At the end of this step:

- The preset row is visible when the bar is in Keybindings mode
- The "Default" preset is always present and read-only
- User presets are discovered via the `list_preset_files` Rust command, which scans the `keybinding-presets/` directory
- Switching presets writes to keybindings, dispatches the cache-invalidation event, and closes the bar (with confirmation)
- "Save as preset" inline input works; duplicate names and "Default" are rejected
- Rename and delete operations work for user presets; Default cannot be renamed or deleted
- All edge cases EC-23 through EC-36 are handled

---

## Files to Create

### `src/plugins/command-bar/preset-manager.ts`

All pure/async functions. No DOM access. No window globals — all dependencies injected.

```typescript
// ── Types ──────────────────────────────────────────────────────────────────

/** A loaded preset entry */
export interface PresetEntry {
  name: string;
  bindings: Record<string, string>;   // actionId → keyString
  isDefault: boolean;                  // true for the synthetic "Default" preset
}

/** API surface injected into preset functions */
export interface PresetApiDeps {
  /** Load settings for a named namespace (plugin settings API) */
  loadSettings: (namespace: string) => Promise<Record<string, unknown> | null>;
  /** Save settings for a named namespace */
  saveSettings: (namespace: string, data: Record<string, unknown>) => Promise<void>;
  /**
   * Scan a directory for .json preset filenames.
   * Wraps the `list_preset_files` Rust command.
   * Returns an empty array if the directory does not exist.
   */
  listPresetFiles: (dirPath: string) => Promise<string[]>;
}

// ── Constants ────────────────────────────────────────────────────────────

export const DEFAULT_PRESET_NAME = "Default";
export const PRESET_NAMESPACE_PREFIX = "keybinding-preset-";
export const KEYBINDING_PRESETS_DIR = "keybinding-presets"; // subdirectory name within app data dir

// ── Sanitize preset name for use as a settings namespace key ─────────────

/**
 * Convert a user-visible preset name to a storage namespace key.
 * Replaces non-alphanumeric characters with hyphens; lowercases.
 * e.g. "My Preset!" → "my-preset-"
 */
export function sanitizePresetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

/**
 * Returns the full namespace key for a preset.
 */
export function presetNamespace(name: string): string {
  return PRESET_NAMESPACE_PREFIX + sanitizePresetName(name);
}

// ── Validation ───────────────────────────────────────────────────────────

/**
 * Returns an error string if the preset name is invalid, or null if valid.
 *
 * Rules:
 * - Must be non-empty
 * - Cannot be "Default" (case-insensitive) (EC-26)
 * - Cannot match an existing preset name (case-insensitive) (EC-25)
 */
export function validatePresetName(name: string, existingNames: string[]): string | null {
  if (!name.trim()) return "Preset name cannot be empty";
  if (name.trim().toLowerCase() === DEFAULT_PRESET_NAME.toLowerCase()) {
    return `"${DEFAULT_PRESET_NAME}" is reserved`; // EC-26
  }
  if (existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())) {
    return `A preset named "${name.trim()}" already exists`; // EC-25
  }
  return null;
}

// ── Load presets ─────────────────────────────────────────────────────────

/**
 * Load all user presets by scanning the keybinding-presets/ directory.
 *
 * Returns an array with "Default" first (always), followed by user presets
 * sorted by filename. Malformed presets are skipped with console.warn (EC-34).
 *
 * EC-24: if the directory does not exist or is empty (listPresetFiles returns []),
 * returns only the Default entry. No error thrown.
 *
 * EC-36: if a .json file has no valid data in plugin settings
 * (null from loadSettings), it is skipped with console.warn.
 *
 * @param presetsDir - Absolute path to the keybinding-presets/ directory
 */
export async function loadPresets(
  api: PresetApiDeps,
  presetsDir: string,
): Promise<PresetEntry[]> {
  const presets: PresetEntry[] = [
    { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
  ];

  let filenames: string[] = [];
  try {
    filenames = await api.listPresetFiles(presetsDir);
  } catch (err) {
    console.warn("[PresetManager] Failed to scan preset directory:", err);
    return presets; // EC-24: directory unreadable
  }

  // filenames are bare names like "my-preset.json"; derive preset name from filename
  for (const filename of filenames) {
    const name = filename.replace(/\.json$/i, "");
    if (!name) continue;

    try {
      const data = await api.loadSettings(presetNamespace(name));
      if (!data || typeof data !== "object") {
        console.warn(`[PresetManager] Preset file "${filename}" has no valid settings data (EC-36)`);
        continue;
      }
      const bindings = (data.bindings ?? {}) as Record<string, string>;
      if (typeof bindings !== "object") {
        console.warn(`[PresetManager] Preset file "${filename}" has malformed bindings (EC-34)`);
        continue;
      }
      // Use display name from data if present, otherwise derive from filename
      const displayName = typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : name;
      presets.push({ name: displayName, bindings, isDefault: false });
    } catch (err) {
      console.warn(`[PresetManager] Failed to load preset "${filename}":`, err); // EC-35
    }
  }

  return presets;
}

// ── Save a new preset ─────────────────────────────────────────────────────

/**
 * Save a new user preset.
 *
 * Throws if validation fails (EC-25, EC-26). Returns the updated preset list.
 * The preset is stored via `write_plugin_settings` under the sanitized name namespace.
 * The `name` field is included in the stored data so `loadPresets` can recover
 * the display name from the file content rather than inferring it from the filename.
 */
export async function saveNewPreset(
  name: string,
  bindings: Record<string, string>,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  const existingNames = existingPresets
    .filter((p) => !p.isDefault)
    .map((p) => p.name);

  const validationError = validatePresetName(name, existingNames);
  if (validationError) throw new Error(validationError);

  const trimmedName = name.trim();

  // Save preset data — include display name in stored object
  await api.saveSettings(presetNamespace(trimmedName), { name: trimmedName, bindings });

  return [...existingPresets, { name: trimmedName, bindings, isDefault: false }];
}

// ── Delete a preset ───────────────────────────────────────────────────────

/**
 * Delete a user preset by name. Default cannot be deleted (throws).
 * Returns the updated preset list.
 * Writes a tombstone (empty object) to the plugin settings namespace since
 * the Rust `write_plugin_settings` command does not have a delete operation.
 */
export async function deletePreset(
  name: string,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  if (name === DEFAULT_PRESET_NAME) throw new Error("Cannot delete the Default preset");

  await api.saveSettings(presetNamespace(name), null as any);  // null → tombstone

  return existingPresets.filter((p) => p.name !== name);
}

// ── Rename a preset ───────────────────────────────────────────────────────

/**
 * Rename a user preset. Default cannot be renamed (throws).
 * Validation: new name must pass validatePresetName checks.
 * Returns the updated preset list.
 */
export async function renamePreset(
  oldName: string,
  newName: string,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  if (oldName === DEFAULT_PRESET_NAME) throw new Error("Cannot rename the Default preset");

  const existingNames = existingPresets
    .filter((p) => !p.isDefault && p.name !== oldName)
    .map((p) => p.name);

  const validationError = validatePresetName(newName, existingNames);
  if (validationError) throw new Error(validationError);

  // Load old preset data
  const oldData = await api.loadSettings(presetNamespace(oldName));
  const bindings = (oldData?.bindings ?? {}) as Record<string, string>;

  const trimmedNew = newName.trim();

  // Save under new name (include display name in stored data)
  await api.saveSettings(presetNamespace(trimmedNew), { name: trimmedNew, bindings });

  // Tombstone the old namespace
  await api.saveSettings(presetNamespace(oldName), null as any);

  return existingPresets.map((p) =>
    p.name === oldName ? { ...p, name: trimmedNew } : p
  );
}
```

---

## New Rust Command

### `src-tauri/src/commands/files.rs`

Add the following command. It accepts a directory path and returns the basenames of all `.json` files in that directory. Returns an empty vec if the directory does not exist — it does not error.

```rust
#[tauri::command]
pub fn list_preset_files(dir_path: String) -> Vec<String> {
    let path = std::path::Path::new(&dir_path);
    if !path.is_dir() {
        return vec![];
    }
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".json") {
                names.push(name);
            }
        }
    }
    names
}
```

Register this in `src-tauri/src/lib.rs` (or wherever other commands from `files.rs` are registered), by adding `commands::files::list_preset_files` to the `.invoke_handler(tauri::generate_handler![...])` call.

---

## Files to Modify

### `src/plugins/command-bar/command-bar.plugin.ts`

1. **Import `preset-manager.ts`**:
   ```typescript
   import {
     loadPresets,
     saveNewPreset,
     deletePreset,
     renamePreset,
     validatePresetName,
     DEFAULT_PRESET_NAME,
     type PresetEntry,
     type PresetApiDeps,
   } from "./preset-manager";
   ```

2. **Add preset module-level state**:
   ```typescript
   let _presets: PresetEntry[] = [];
   let _presetsLoaded: boolean = false;
   let _presetSaveInputVisible: boolean = false;
   ```

3. **Add `makePresetApiDeps()` helper** — creates the `PresetApiDeps` object using `__TAURI_INTERNALS__`:
   ```typescript
   function makePresetApiDeps(): PresetApiDeps {
     return {
       loadSettings: (namespace) => {
         return (window as any).__TAURI_INTERNALS__.invoke("read_plugin_settings", {
           pluginId: namespace,
         }).catch(() => null);
       },
       saveSettings: (namespace, data) => {
         // data === null means deletion: write a tombstone empty object
         return (window as any).__TAURI_INTERNALS__.invoke("write_plugin_settings", {
           pluginId: namespace,
           data: JSON.stringify(data ?? {}),
         });
       },
       listPresetFiles: (dirPath) => {
         return (window as any).__TAURI_INTERNALS__.invoke("list_preset_files", {
           dirPath,
         }).catch(() => []);
       },
     };
   }
   ```

   **Important note for Developer**: `read_plugin_settings` returns a raw JSON string (not a parsed object — see `bridge.ts`). Parse the string before accessing fields. `write_plugin_settings` receives `data` as a string. The `makePresetApiDeps` implementation above must match the actual Tauri command signatures in `bridge.ts`.

4. **Update `openBar("keybindings")`** to also load presets asynchronously:
   ```typescript
   if (targetMode === "keybindings") {
     // ... existing results build ...

     // Async: scan keybinding-presets/ directory and load preset data
     _presetsLoaded = false;
     // presetsDir: derive from app data directory path stored in _settings or a known global
     const presetsDir = _settings.presetsDir ?? "";  // populated from app data path at enable time
     void loadPresets(makePresetApiDeps(), presetsDir).then((presets) => {
       if (!_isOpen || _mode !== "keybindings") return; // stale guard
       _presets = presets;
       _presetsLoaded = true;
       // Fallback: if activePreset is not in the list, reset to Default (EC-36)
       const found = presets.find((p) => p.name === _settings.activePreset);
       if (!found) {
         console.warn(`[CommandBar] Active preset "${_settings.activePreset}" not found; falling back to Default (EC-36)`);
         _settings.activePreset = DEFAULT_PRESET_NAME;
         if (_api) void _api.saveSettings(_settings as unknown as Record<string, unknown>);
       }
       renderPresetRow();
     });
   }
   ```

5. **Add `renderPresetRow()` function** — populates the `.cb-preset-row` DOM:
   ```typescript
   function renderPresetRow(): void {
     if (!_presetRowEl) return;
     _presetRowEl.innerHTML = "";

     const label = document.createElement("span");
     label.className = "cb-preset-name";
     label.textContent = `Preset: ${_settings.activePreset}`;
     _presetRowEl.appendChild(label);

     const dropdownBtn = document.createElement("button");
     dropdownBtn.type = "button";
     dropdownBtn.className = "cb-preset-dropdown-btn";
     dropdownBtn.textContent = "▾";
     dropdownBtn.addEventListener("click", (e) => {
       e.stopPropagation();
       togglePresetDropdown();
     });
     _presetRowEl.appendChild(dropdownBtn);

     // "Save as preset" inline input (hidden by default)
     if (_presetSaveInputVisible) {
       renderSaveAsPresetInput();
     }
   }

   function togglePresetDropdown(): void {
     const existing = _presetRowEl?.querySelector(".cb-preset-dropdown");
     if (existing) {
       existing.remove();
       return;
     }
     renderPresetDropdown();
   }

   function renderPresetDropdown(): void {
     if (!_presetRowEl) return;

     const dropdown = document.createElement("div");
     dropdown.className = "cb-preset-dropdown";
     dropdown.setAttribute("role", "listbox");
     dropdown.setAttribute("aria-label", "Keybinding presets");

     // Loaded preset entries
     for (const preset of _presets) {
       const item = document.createElement("div");
       item.className = "cb-preset-dropdown-item";
       if (preset.name === _settings.activePreset) item.classList.add("cb-preset-dropdown-item--active");
       item.textContent = preset.isDefault ? `${preset.name} (read-only)` : preset.name;

       item.addEventListener("click", () => {
         dropdown.remove();
         void handleApplyPreset(preset);
       });

       if (!preset.isDefault) {
         // Rename button
         const renameBtn = document.createElement("button");
         renameBtn.type = "button";
         renameBtn.textContent = "Rename";
         renameBtn.addEventListener("click", (e) => {
           e.stopPropagation();
           dropdown.remove();
           void handleRenamePreset(preset);
         });
         item.appendChild(renameBtn);

         // Delete button
         const deleteBtn = document.createElement("button");
         deleteBtn.type = "button";
         deleteBtn.textContent = "Delete";
         deleteBtn.addEventListener("click", (e) => {
           e.stopPropagation();
           dropdown.remove();
           void handleDeletePreset(preset);
         });
         item.appendChild(deleteBtn);
       }

       dropdown.appendChild(item);
     }

     // "Save as preset…" entry
     const saveItem = document.createElement("div");
     saveItem.className = "cb-preset-dropdown-item cb-preset-dropdown-item--action";
     saveItem.textContent = "Save as preset…";
     saveItem.addEventListener("click", () => {
       dropdown.remove();
       _presetSaveInputVisible = true;
       renderPresetRow();
     });
     dropdown.appendChild(saveItem);

     _presetRowEl.appendChild(dropdown);
   }
   ```

6. **Add `renderSaveAsPresetInput()` function**:
   ```typescript
   function renderSaveAsPresetInput(): void {
     if (!_presetRowEl) return;

     const inputEl = document.createElement("input");
     inputEl.type = "text";
     inputEl.placeholder = "Preset name…";
     inputEl.className = "cb-preset-save-input";
     inputEl.addEventListener("keydown", (e) => {
       e.stopPropagation();
       if (e.key === "Enter") {
         e.preventDefault();
         void handleSaveAsPreset(inputEl.value);
       } else if (e.key === "Escape") {
         e.preventDefault();
         _presetSaveInputVisible = false;
         renderPresetRow();
       }
     });

     const errorEl = document.createElement("div");
     errorEl.className = "cb-preset-save-error";

     const validateAndShow = () => {
       const existingNames = _presets.filter((p) => !p.isDefault).map((p) => p.name);
       const err = validatePresetName(inputEl.value, existingNames);
       errorEl.textContent = err ?? "";
       errorEl.style.display = err ? "block" : "none";
     };

     inputEl.addEventListener("input", validateAndShow);

     _presetRowEl.appendChild(inputEl);
     _presetRowEl.appendChild(errorEl);
     inputEl.focus();
   }
   ```

7. **Add `handleApplyPreset()` function** (FR-07.8):
   ```typescript
   async function handleApplyPreset(preset: PresetEntry): Promise<void> {
     if (preset.isDefault) {
       // Applying Default clears all custom bindings
       const confirmed = window.confirm(
         `Replace all current shortcuts with the ${preset.name} preset?`
       );
       if (!confirmed) return;

       try {
         await saveKeybindings({});
         _settings.activePreset = DEFAULT_PRESET_NAME;
         if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
         closeBar();
       } catch (err) {
         console.error("[CommandBar] Failed to apply Default preset:", err);
       }
       return;
     }

     const confirmed = window.confirm(
       `Replace all current shortcuts with the "${preset.name}" preset?`
     );
     if (!confirmed) return;

     try {
       await saveKeybindings(preset.bindings);
       _settings.activePreset = preset.name;
       if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
       closeBar();
     } catch (err) {
       // EC-35: read attempt for a deleted preset fails here; the next bar open rebuilds the list
       console.error(`[CommandBar] Failed to apply preset "${preset.name}":`, err);
     }
   }
   ```

8. **Add `saveKeybindings()` helper** — writes the keybindings key in settings and dispatches the event:
   ```typescript
   async function saveKeybindings(bindings: Record<string, string>): Promise<void> {
     const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
     const appSettings = typeof getSettings === "function" ? getSettings() : {};
     const merged = { ...appSettings, keybindings: bindings };
     await (window as any).__TAURI_INTERNALS__.invoke("save_settings", {
       settings: JSON.stringify(merged),
     });
     document.dispatchEvent(
       new CustomEvent("markable-keybindings-changed", { detail: { keybindings: bindings } })
     );
   }
   ```

9. **Add `handleSaveAsPreset()` function**:
   ```typescript
   async function handleSaveAsPreset(name: string): Promise<void> {
     const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
     const appSettings = typeof getSettings === "function" ? getSettings() : { keybindings: {} };
     const currentBindings: Record<string, string> = appSettings.keybindings ?? {};

     try {
       _presets = await saveNewPreset(name, currentBindings, _presets, makePresetApiDeps());
       _presetSaveInputVisible = false;
       _settings.activePreset = name.trim();
       if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
       renderPresetRow();
     } catch (err) {
       // Validation errors: shown inline by renderSaveAsPresetInput (re-render with error)
       console.warn("[CommandBar] saveNewPreset failed:", err);
       // The input field stays open; the error is visible via the validate-on-input handler
     }
   }
   ```

10. **Add `handleRenamePreset()` and `handleDeletePreset()` stubs** (full implementation uses window.prompt for simplicity; a more polished version uses inline rename input similar to save):
    ```typescript
    async function handleRenamePreset(preset: PresetEntry): Promise<void> {
      const newName = window.prompt(`Rename "${preset.name}" to:`);
      if (!newName) return;
      try {
        _presets = await renamePreset(preset.name, newName, _presets, makePresetApiDeps());
        if (_settings.activePreset === preset.name) {
          _settings.activePreset = newName.trim();
          if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
        }
        renderPresetRow();
      } catch (err) {
        console.error("[CommandBar] renamePreset failed:", err);
      }
    }

    async function handleDeletePreset(preset: PresetEntry): Promise<void> {
      const confirmed = window.confirm(`Delete preset "${preset.name}"?`);
      if (!confirmed) return;
      try {
        _presets = await deletePreset(preset.name, _presets, makePresetApiDeps());
        if (_settings.activePreset === preset.name) {
          _settings.activePreset = DEFAULT_PRESET_NAME;
          if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
        }
        renderPresetRow();
      } catch (err) {
        console.error("[CommandBar] deletePreset failed:", err);
      }
    }
    ```

11. **Update `onDisable()`** to null preset state:
    ```typescript
    _presets = [];
    _presetsLoaded = false;
    _presetSaveInputVisible = false;
    ```

12. **CSS additions** to `CSS_TEXT`:
    ```css
    .cb-preset-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      z-index: 10000;
      overflow: hidden;
    }

    .cb-preset-dropdown-item {
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .cb-preset-dropdown-item:hover {
      background: var(--code-bg);
    }

    .cb-preset-dropdown-item--active {
      color: var(--accent-color);
      font-weight: 600;
    }

    .cb-preset-dropdown-item--action {
      color: var(--text-secondary);
      font-style: italic;
    }

    .cb-preset-save-input {
      flex: 1;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 3px 6px;
      font-family: var(--ui-font);
      font-size: 12px;
      color: var(--text-primary);
    }

    .cb-preset-save-error {
      font-size: 11px;
      color: var(--accent-color);
      display: none;
    }
    ```

---

## Exported Interfaces and Functions (from `preset-manager.ts`)

```typescript
export interface PresetEntry { name, bindings, isDefault }
export interface PresetApiDeps { loadSettings, saveSettings, listPresetFiles }
export const DEFAULT_PRESET_NAME: string;
export const PRESET_NAMESPACE_PREFIX: string;
export const KEYBINDING_PRESETS_DIR: string;
export function sanitizePresetName(name): string;
export function presetNamespace(name): string;
export function validatePresetName(name, existingNames): string | null;
export async function loadPresets(api, presetsDir): Promise<PresetEntry[]>;
export async function saveNewPreset(name, bindings, existingPresets, api): Promise<PresetEntry[]>;
export async function deletePreset(name, existingPresets, api): Promise<PresetEntry[]>;
export async function renamePreset(oldName, newName, existingPresets, api): Promise<PresetEntry[]>;
```

---

## TDD Anchors

New describe block: `"Step 05 — Preset System"`:

```
// validatePresetName
it("returns null for a valid unique name")
it("EC-25: returns error for duplicate name (case-insensitive)")
it("EC-26: returns error for name 'Default' (case-insensitive)")
it("EC-26: rejects 'default' and 'DEFAULT' as reserved")
it("returns error for empty name")

// sanitizePresetName
it("lowercases and replaces spaces with hyphens")
it("replaces special characters")

// loadPresets
it("EC-24: returns only Default when listPresetFiles returns empty array")
it("EC-34: skips malformed preset data (bad bindings type) with console.warn")
it("EC-36: skips filename whose loadSettings returns null, console.warns")
it("returns Default plus loaded user presets in filename sort order")
it("EC-33: returns only Default when directory is empty")

// saveNewPreset
it("saves a new preset and returns updated list")
it("EC-25: throws on duplicate name")
it("EC-26: throws on reserved name 'Default'")

// deletePreset
it("deletes a user preset from registry")
it("throws when attempting to delete Default")

// renamePreset
it("renames a preset and updates registry")
it("throws on invalid new name")
it("throws when attempting to rename Default")

// Integration: apply preset
it("EC-23: applying a preset shows confirmation dialog")
it("EC-35: applying a deleted preset shows error, bar stays open")
it("EC-36: bar open falls back to Default when activePreset not found")
```

---

## Definition of Done

- [ ] `src/plugins/command-bar/preset-manager.ts` exists with all exported pure functions
- [ ] `list_preset_files` Rust command added to `src-tauri/src/commands/files.rs` and registered in `lib.rs`
- [ ] Preset row is visible in Keybindings mode and hidden in Files/Commands modes
- [ ] "Default" preset is always first, always read-only
- [ ] User presets are discovered via `list_preset_files` directory scan (true filesystem scan, not a registry)
- [ ] EC-24: empty or non-existent preset directory shows only Default
- [ ] EC-25: duplicate name validation blocks save
- [ ] EC-26: "Default" name is case-insensitively rejected
- [ ] EC-33: empty directory shows only Default
- [ ] EC-34: malformed preset data is skipped with console.warn
- [ ] EC-35: applying a deleted preset shows inline error without closing bar
- [ ] EC-36: missing settings data for a discovered filename falls back gracefully with console.warn
- [ ] Apply preset shows confirmation (FR-07.8)
- [ ] "Save as preset" inline input works with real-time validation
- [ ] activePreset is persisted in plugin settings after every preset change
- [ ] Cache-invalidation event is dispatched after every keybinding write from preset apply
- [ ] All 84 existing tests pass
- [ ] All new preset system tests pass
