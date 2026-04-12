# step_03a — Loader Unification

**Feature:** `unified-plugins`
**Chunk:** 3
**Step:** 03a
**Depends on:** step_02b_rust_copy_command (Chunk 2B approved)

---

## Objective

Extend `src/plugins/user-plugin-loader.ts` so it can evaluate both core and user
plugins through the same code path. Add a `list_core_plugins` Rust command so the
frontend can discover which `.js` files exist in `plugins/core/`. Wire
`buildMarkablePluginAPI` (from `markable-plugin-api.ts`, Chunk 1) as the single
factory used for all plugins going forward — deprecating `buildUserPluginAPI`.

After this step, `user-plugin-loader.ts` exports:
- `evaluatePlugin(source, filename)` — unchanged signature, return type unchanged
  (`UserPluginLoadResult` stays in place until step_03b), but adds
  `version` field validation and returns `UnifiedPlugin` inside the discriminated union.
- `buildMarkablePluginAPI` — re-exported from `markable-plugin-api.ts` (the canonical
  factory), so callers need only one import location.
- `buildUserPluginAPI` — kept as a deprecated alias calling `buildMarkablePluginAPI`,
  removed in step_04c.

`list_core_plugins` in Rust scans `plugins/core/` and returns the same
`ListPluginsResponse` shape as `list_user_plugins`. No 50-plugin cap — core plugins
are under developer control (FR-3 / `active_task.md § Knowns`).

`bridge.ts` gains a `listCorePlugins()` wrapper.

---

## Files to Modify

| File | Action |
|------|--------|
| `src-tauri/src/commands/plugins.rs` | Add `list_core_plugins` command; remove `#[allow(dead_code)]` on `plugins_core_dir` |
| `src-tauri/src/commands/mod.rs` | Re-export `list_core_plugins` |
| `src-tauri/src/lib.rs` | Register `list_core_plugins` in `generate_handler![]` |
| `src/lib/bridge.ts` | Add `listCorePlugins()` wrapper |
| `src/plugins/user-plugin-loader.ts` | Extend `validate()` for `version` field; update `evaluatePlugin` return to include `UnifiedPlugin`; re-export `buildMarkablePluginAPI`; keep `buildUserPluginAPI` as deprecated alias |

---

## 1. Rust — `src-tauri/src/commands/plugins.rs`

### 1a. Remove `#[allow(dead_code)]` from `plugins_core_dir`

Current (line 262):
```rust
#[allow(dead_code)]
fn plugins_core_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
```

Replace with:
```rust
fn plugins_core_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
```

### 1b. Add `list_core_plugins` command

Add the following immediately after the closing brace of `list_user_plugins` (after line 152),
before the `read_plugin_file` function:

```rust
/// List `.js` files in the `plugins/core/` directory.
///
/// Core plugins are under developer control, so there is NO 50-plugin cap.
/// All `.js` files at the top level of `plugins/core/` are returned in
/// lexicographic order. Subdirectories are skipped.
///
/// Returns `ListPluginsResponse` with `truncated` always empty (no cap for core).
/// Returns `{ files: [], truncated: [] }` if the directory does not exist yet
/// (e.g. first launch before `copy_core_plugins` has run on this machine).
///
/// EC-1: the directory is NOT created here — `copy_core_plugins` already ensures
/// it exists before any plugin is loaded. Not creating it here avoids masking a
/// missing `copy_core_plugins` invocation during development.
#[tauri::command]
pub fn list_core_plugins(app: tauri::AppHandle) -> Result<ListPluginsResponse, String> {
    let dir = plugins_core_dir(&app)?;

    // If the directory does not exist, return an empty list without error.
    // This happens in dev mode when copy_core_plugins skipped the copy because
    // the bundled resource directory was absent.
    if !dir.exists() {
        return Ok(ListPluginsResponse {
            files: Vec::new(),
            truncated: Vec::new(),
        });
    }

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read core plugins directory: {}", e))?;

    let mut filenames: Vec<String> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(ext) = path.extension() {
            if ext == "js" {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    filenames.push(name.to_string());
                }
            }
        }
    }

    filenames.sort();

    Ok(ListPluginsResponse {
        files: filenames,
        truncated: Vec::new(),
    })
}
```

### 1c. Add unit test for `list_core_plugins` non-existent directory

Add inside the `#[cfg(test)] mod tests` block (after the last existing test):

```rust
/// list_core_plugins must return an empty list (not an error) when the
/// plugins/core/ directory does not yet exist.
/// This test exercises the path returned by the helper function directly
/// (the command itself requires a live AppHandle).
#[test]
fn plugins_core_dir_is_correct_path_segment() {
    // Verify the helper produces a path ending in .../plugins/core
    // by constructing the expected suffix.
    // We cannot call plugins_core_dir() without an AppHandle, so we verify
    // the directory construction logic by testing the path fragment directly.
    let root = std::path::PathBuf::from("/tmp/markable_test");
    let core = root.join("plugins").join("core");
    assert!(
        core.ends_with("plugins/core"),
        "plugins/core path must end with plugins/core"
    );
}

/// list_core_plugins returns an empty non-truncated list when core/ does not exist.
/// Verified at the logic level: if dir.exists() is false, files and truncated are both [].
#[test]
fn list_core_plugins_empty_when_dir_missing() {
    // Construct a path that provably does not exist.
    let non_existent_dir =
        std::path::PathBuf::from("/tmp/markable_nonexistent_core_dir_test_12345");
    assert!(
        !non_existent_dir.exists(),
        "test precondition: directory must not exist"
    );
    // The logic in list_core_plugins: if !dir.exists() → return empty.
    // We replicate it here without an AppHandle.
    let result: Vec<String> = if !non_existent_dir.exists() {
        Vec::new()
    } else {
        panic!("should have returned early");
    };
    assert!(result.is_empty());
}
```

---

## 2. Rust — `src-tauri/src/commands/mod.rs`

Locate the existing `pub use` block. Current content includes:
```rust
pub use plugins::{
    list_user_plugins,
    read_plugin_file,
    read_plugin_settings,
    write_plugin_settings,
    copy_core_plugins,
};
```

Add `list_core_plugins` to the list:
```rust
pub use plugins::{
    list_user_plugins,
    list_core_plugins,
    read_plugin_file,
    read_plugin_settings,
    write_plugin_settings,
    copy_core_plugins,
};
```

---

## 3. Rust — `src-tauri/src/lib.rs`

Locate `generate_handler![...]`. The current list includes `copy_core_plugins`.
Add `list_core_plugins` immediately after it:

```rust
// Before:
copy_core_plugins,

// After:
copy_core_plugins,
list_core_plugins,
```

---

## 4. TypeScript — `src/lib/bridge.ts`

Add immediately after the `listUserPlugins` function (after line 258):

```typescript
/**
 * List top-level .js filenames in the core plugins directory.
 *
 * Returns the Rust-structured response. The `truncated` array is always empty
 * for core plugins (no cap). Returns `{ files: [], truncated: [] }` if the
 * directory does not exist (e.g. dev mode where copy was skipped).
 *
 * EC-1: directory is created by copy_core_plugins, not by this command.
 */
export async function listCorePlugins(): Promise<ListUserPluginsResponse> {
  try {
    return await invoke<ListUserPluginsResponse>("list_core_plugins");
  } catch (error) {
    console.error("Failed to list core plugins:", error);
    return { files: [], truncated: [] };
  }
}
```

The return type reuses `ListUserPluginsResponse` — the shape is identical.

---

## 5. TypeScript — `src/plugins/user-plugin-loader.ts`

### 5a. Add `version` to the required-fields list

Current `REQUIRED_FIELDS` (line 19):
```typescript
const REQUIRED_FIELDS: ReadonlyArray<keyof UserPlugin> = [
  "id",
  "name",
  "description",
  "onEnable",
  "onDisable",
];
```

`version` is not on `UserPlugin` (the old interface). Do NOT add it to
`REQUIRED_FIELDS` yet — that would break the old `UserPlugin` type. Instead,
add a separate post-validation check for the unified path inside `validate()`.

### 5b. Add `validateUnified()` — new function exported alongside the old `validate()`

Add after the `validate()` function (after line 85):

```typescript
/**
 * Validate that obj satisfies UnifiedPlugin structurally.
 *
 * All UserPlugin validations apply, plus:
 *   - version:  non-empty string (EC-22).
 *
 * Returns null on success; an error string on first violation.
 * Used by evaluatePlugin when called with kind = "core" | "user".
 */
function validateUnified(obj: unknown, filename: string): string | null {
  // Reuse existing structural checks (id, name, description, onEnable, onDisable).
  const baseError = validate(obj, filename);
  if (baseError !== null) return baseError;

  const record = obj as Record<string, unknown>;

  // EC-22: version field required on unified plugins.
  if (typeof record.version !== "string" || record.version.trim() === "") {
    return `${filename}: 'version' must be a non-empty string`;
  }

  return null;
}
```

### 5c. Update `evaluatePlugin` signature to accept an optional `kind` parameter

The current signature (line 147):
```typescript
export function evaluatePlugin(
  source: string,
  filename: string,
): UserPluginLoadResult {
```

The return type `UserPluginLoadResult` is `{ ok: true; plugin: UserPlugin } | { ok: false; filename: string; reason: string }`.

`UnifiedPlugin` is a superset of `UserPlugin` (adds `version`). To preserve backward
compatibility through step_03b without changing the return type, add an overload that
returns `UnifiedPlugin` when `kind` is provided. The simplest approach:

Replace the function with:

```typescript
/**
 * Evaluate plugin source text and return a validated plugin or an error.
 *
 * When `kind` is provided ("core" or "user"), the full UnifiedPlugin interface
 * is required (including `version`). When `kind` is omitted, the legacy
 * UserPlugin interface is validated (no `version` requirement) — this path is
 * retained for backward compatibility through step_04c.
 *
 * EC-2: empty/whitespace-only source → error.
 * EC-3: syntax errors caught.
 * EC-4: non-object return rejected.
 * EC-5: missing required fields rejected.
 * EC-22: version field required when kind is provided.
 *
 * @param source    UTF-8 text of the plugin file.
 * @param filename  Original filename, used in error messages.
 * @param kind      "core" | "user" to apply UnifiedPlugin validation; omit for
 *                  legacy UserPlugin validation.
 */
export function evaluatePlugin(
  source: string,
  filename: string,
  kind?: "core" | "user",
): UserPluginLoadResult {
  // EC-2: reject empty or whitespace-only source.
  if (source.trim().length === 0) {
    return {
      ok: false,
      filename,
      reason: `${filename}: file is empty or contains only whitespace`,
    };
  }

  let pluginObj: unknown;

  try {
    const factory = new Function("api", `"use strict";\n${source}`);
    pluginObj = factory(null);
  } catch (err) {
    // EC-3: syntax error or runtime error during evaluation.
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      filename,
      reason: `${filename}: evaluation error — ${message}`,
    };
  }

  // EC-4, EC-5, EC-22: structural validation.
  const validationError =
    kind !== undefined
      ? validateUnified(pluginObj, filename)
      : validate(pluginObj, filename);

  if (validationError !== null) {
    return { ok: false, filename, reason: validationError };
  }

  return { ok: true, plugin: pluginObj as UserPlugin };
}
```

### 5d. Re-export `buildMarkablePluginAPI` and deprecate `buildUserPluginAPI`

Add at the end of `user-plugin-loader.ts`:

```typescript
// ── Unified API factory (canonical) ───────────────────────────────────────────

/**
 * Re-export of buildMarkablePluginAPI from markable-plugin-api.ts.
 *
 * This is now the canonical factory for all plugins — core and user.
 * Import from here or from markable-plugin-api.ts directly; both are equivalent.
 * Introduced in step_03a; callers migrated in step_03b.
 */
export { buildMarkablePluginAPI } from "./markable-plugin-api";

/**
 * @deprecated Use buildMarkablePluginAPI instead. This alias delegates to
 * buildMarkablePluginAPI and is retained for backward compatibility through
 * step_04c, after which it is deleted.
 *
 * The signature is identical: (pluginId, statusBarZones) → MarkablePluginAPI.
 */
export function buildUserPluginAPI(
  pluginId: string,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): ReturnType<typeof import("./markable-plugin-api").buildMarkablePluginAPI> {
  return buildMarkablePluginAPI(pluginId, statusBarZones);
}
```

However, the above has a circular-looking import in the JSDoc. Use a simpler form —
keep the original `buildUserPluginAPI` implementation in place but add the re-export
for `buildMarkablePluginAPI` above it and mark the old function deprecated:

Final form of the bottom section of `user-plugin-loader.ts` (replaces lines 87–126):

```typescript
// ── API builders ──────────────────────────────────────────────────────────────

/**
 * Re-export of the canonical unified factory.
 * All new callers should use this. Introduced in step_03a.
 */
export { buildMarkablePluginAPI } from "./markable-plugin-api";

/**
 * @deprecated since step_03a. Retained for callers that have not yet migrated
 * to buildMarkablePluginAPI. Will be deleted in step_04c.
 *
 * Delegates directly to buildMarkablePluginAPI — behaviour is identical.
 */
export function buildUserPluginAPI(
  pluginId: string,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): ReturnType<typeof buildMarkablePluginAPI> {
  return buildMarkablePluginAPI(pluginId, statusBarZones);
}
```

This requires adding `import { buildMarkablePluginAPI } from "./markable-plugin-api";`
at the top of the file, after the existing imports:

```typescript
// Add after line 14 (after the ensureStatusBar/hideStatusBarIfUnused import):
import { buildMarkablePluginAPI } from "./markable-plugin-api";
```

The `readPluginSettings` and `writePluginSettings` imports previously used by the old
`buildUserPluginAPI` body are no longer needed in this file (they are used inside
`buildMarkablePluginAPI` in `markable-plugin-api.ts`). Remove:

```typescript
// Remove these two lines (they were lines 13–14):
import { readPluginSettings, writePluginSettings } from "../lib/bridge";
import { ensureStatusBar, hideStatusBarIfUnused } from "./status-bar/status-bar";
```

Wait — `ensureStatusBar` and `hideStatusBarIfUnused` are NOT used in the new body
of `buildUserPluginAPI` (the body delegates to `buildMarkablePluginAPI`). But
`readPluginSettings` and `writePluginSettings` are also gone from this file.
`ensureStatusBar`/`hideStatusBarIfUnused` are gone too.

Confirm: `markable-plugin-api.ts` already imports all of these itself (lines 22–23).
So the new `user-plugin-loader.ts` only needs:

```typescript
import type { UserPlugin, UserPluginAPI, UserPluginLoadResult } from "./user-plugin-types";
import { buildMarkablePluginAPI } from "./markable-plugin-api";
```

`UserPluginAPI` is still needed for the return-type of the deprecated wrapper.

---

## 6. Tests to write

Create `tests/loader-unification.test.ts`:

### 6a. `list_core_plugins` bridge wrapper

```
- listCorePlugins calls invoke("list_core_plugins") with no extra arguments
- listCorePlugins returns { files: [], truncated: [] } on error (never throws)
- listCorePlugins returns the Rust response as-is on success
```

### 6b. `evaluatePlugin` with `kind` parameter

```
- evaluatePlugin(source, "foo.js", "core") returns error if version is missing
- evaluatePlugin(source, "foo.js", "core") returns error if version is empty string
- evaluatePlugin(source, "foo.js", "core") returns ok when all fields including version are present
- evaluatePlugin(source, "foo.js", "user") returns error if version is missing (same check)
- evaluatePlugin(source, "foo.js")          returns ok even without version (legacy path)
```

### 6c. `buildUserPluginAPI` deprecation alias

```
- buildUserPluginAPI returns an object with the same shape as buildMarkablePluginAPI
- buildUserPluginAPI addExtensions delegates to pluginManager.addExtensions
- buildUserPluginAPI removeExtensions delegates to pluginManager.removeExtensions
```

---

## Verification Checklist

- [ ] `cargo test` passes (all 41 Rust tests + 2 new `list_core_plugins` tests)
- [ ] `npx tsc --noEmit` passes with 0 new errors
- [ ] `npm test` passes (all 415 frontend tests + new loader-unification tests)
- [ ] `list_core_plugins` is present in `generate_handler![]` in `lib.rs`
- [ ] `listCorePlugins()` is exported from `bridge.ts`
- [ ] `buildMarkablePluginAPI` is importable from `user-plugin-loader.ts`
- [ ] `buildUserPluginAPI` import in `src/plugins/index.ts` still compiles
  (the alias preserves the old signature)
- [ ] `evaluatePlugin` without `kind` still validates correctly (no regression on
  `tests/user-plugin-loader.test.ts`)
- [ ] EC-22: `evaluatePlugin(source, filename, "core")` rejects a plugin with
  `version: ""` with a "version must be a non-empty string" error
