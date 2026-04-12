# step_04b — Cleanup: Dead Code Removal

**Chunk:** 4
**Prerequisite:** step_04a merged and passing.
**Status:** NOT STARTED

---

## Objective

Remove all deprecated scaffolding that was kept alive through Chunks 1–3 for backward compatibility. After this step, the codebase contains zero references to `PluginContext`, `UserPluginAPI`, `buildUserPluginAPI`, `MarkablePlugin` (old interface), `PluginDef`, `UserPlugin`, `UserPluginDef`, or the four old static wrapper `index.ts` files. The deprecated settings fields are removed from the `MarkableSettings` interface (the raw-JSON pass-through in Rust means removing them from the TypeScript interface does not corrupt existing settings files).

---

## Items to Delete or Modify

### A. Source files to DELETE entirely

These four files are the old `MarkablePlugin` static wrappers. After Chunk 3, nothing in `src/` imports from them. Their logic was replaced by the `*.plugin.ts` IIFE entry files.

| File | Why safe to delete |
|------|--------------------|
| `src/plugins/focus-mode/index.ts` | `FocusModePlugin` is no longer imported by `src/plugins/index.ts` (Chunk 3 removed the static array). The `focus-mode.ts` CM6 extension file and `focus-mode.plugin.ts` IIFE file are unaffected and must stay. |
| `src/plugins/typewriter-mode/index.ts` | Same rationale — `TypewriterModePlugin` removed from manager in Chunk 3. `typewriter-mode.ts` and `typewriter-mode.plugin.ts` stay. |
| `src/plugins/word-count/index.ts` | `WordCountPlugin` removed from manager in Chunk 3. `word-count.ts` and `word-count.plugin.ts` stay. |
| `src/plugins/status-bar/index.ts` | `StatusBarPlugin` removed from manager in Chunk 3. `status-bar.ts`, `status-bar.css`, and `status-bar.plugin.ts` stay. |

Confirm no import in `src/` references these before deleting. Run the import check command in the verification section.

### B. Source file to DELETE entirely

| File | Why safe to delete |
|------|--------------------|
| `src/plugins/user-plugin-types.ts` | All types (`UserPlugin`, `UserPluginAPI`, `UserPluginLoadResult`, `UserPluginDef`) are either superseded by unified types in `markable-plugin-api.ts` / `src/plugins/index.ts` or are no longer needed. The only remaining importer is `user-plugin-loader.ts` (see section C). |

### C. Files to MODIFY — remove deprecated exports

#### `src/plugins/user-plugin-loader.ts`

Remove the `buildUserPluginAPI` function entirely (lines 123–129 in the current file). Also remove the import of `UserPlugin` and `UserPluginLoadResult` from `./user-plugin-types` and replace with the equivalent types from `./markable-plugin-api` and `./plugin-types`.

The file currently imports:
```typescript
import type { UserPlugin, UserPluginLoadResult } from "./user-plugin-types";
```

After the cleanup, `UserPlugin` is no longer referenced (the function that used it, `buildUserPluginAPI`, is deleted). `UserPluginLoadResult` is still the return type of `evaluatePlugin`. Replace the import with a local type alias defined in the file itself, or import from the remaining type sources.

The `UserPluginLoadResult` type in `user-plugin-types.ts` is:
```typescript
export type UserPluginLoadResult =
  | { ok: true; plugin: UserPlugin }
  | { ok: false; filename: string; reason: string };
```

After deleting `user-plugin-types.ts`, define this type inline in `user-plugin-loader.ts`:
```typescript
// Local result type for evaluatePlugin. UserPlugin is the minimal structural
// contract; the caller casts to UnifiedPlugin after kind-based validation.
type EvaluateResult =
  | { ok: true; plugin: { id: string; name: string; description: string; detail?: string; version?: string; onEnable: Function; onDisable: Function } }
  | { ok: false; filename: string; reason: string };
```

Alternatively — and more cleanly — import `UnifiedPlugin` from `./markable-plugin-api` and reuse it as the success type, since all callers have been using `kind` param since step_03a. The result type becomes:

```typescript
import type { UnifiedPlugin } from "./markable-plugin-api";

export type EvaluatePluginResult =
  | { ok: true; plugin: UnifiedPlugin }
  | { ok: false; filename: string; reason: string };
```

Update the `evaluatePlugin` return type annotation and all internal usages accordingly. The callers (`src/plugins/index.ts` `_loadPluginFile`) must also be updated if the exported type name changes. Check the caller signature before deciding on the rename:

```typescript
// Current in src/plugins/index.ts:
const evalResult = evaluatePlugin(fileResult.source, filename, kind);
if (!evalResult.ok) { ... }
const plugin = evalResult.plugin as unknown as UnifiedPlugin;
```

If `EvaluatePluginResult` already types `.plugin` as `UnifiedPlugin`, the `as unknown as UnifiedPlugin` cast in `_loadPluginFile` can be removed.

#### `src/plugins/plugin-types.ts`

This file currently exports three deprecated interfaces: `PluginContext`, `MarkablePlugin`, and `PluginDef`. It also re-exports `MarkableSettings`.

After Chunk 4, nothing in `src/` should import from this file. Verify with the import check command in the verification section.

Delete the file entirely after confirming zero live importers. The `MarkableSettings` re-export it contained is not needed — callers import `MarkableSettings` directly from `../lib/settings`.

### D. Files to MODIFY — remove deprecated settings fields

#### `src/lib/settings.ts`

Remove the five deprecated fields from the `MarkableSettings` interface:

```typescript
// DELETE these five field declarations:
statusBar?: { visible: boolean };
wordCount?: boolean;
focusMode?: boolean;
typewriterMode?: boolean;
userPlugins?: Record<string, { enabled: boolean }>;
```

These fields were annotated `@deprecated since Chunk 3 (step_03c)` and kept through step_04c per the original plan. `migratePluginSettings()` has already read them and written their values into `settings.plugins` before any code uses them. Removing them from the TypeScript interface prevents future accidental use while leaving the raw JSON pass-through intact in Rust (so existing settings files are not corrupted).

---

## Test Files to Delete

These five test files test the deleted source files. They must be deleted to prevent broken imports from failing the test run.

| Test file | Tests | Reason for deletion |
|-----------|-------|---------------------|
| `tests/focus-mode-plugin.test.ts` | 13 tests — `FocusModePlugin` lifecycle, `getExtensions`, `restoreFromSettings` | Imports `FocusModePlugin` from `src/plugins/focus-mode/index.ts` (deleted). The `.plugin.ts` IIFE entry is not unit-testable through the same interface. |
| `tests/typewriter-mode-plugin.test.ts` | 10 tests — same pattern | Imports `TypewriterModePlugin` from `src/plugins/typewriter-mode/index.ts` (deleted). |
| `tests/word-count-plugin.test.ts` | 10 tests — same pattern | Imports `WordCountPlugin` from `src/plugins/word-count/index.ts` (deleted). |
| `tests/status-bar-plugin.test.ts` | 13 tests — `StatusBarPlugin` + status-bar infrastructure | Imports `StatusBarPlugin` from `src/plugins/status-bar/index.ts` (deleted). Note: the underlying `status-bar.ts` module tests (EC-1, EC-2, EC-3) are bundled here. Extract those 6 tests into a new `tests/status-bar.test.ts` before deleting (see section E). |
| `tests/plugin-types.test.ts` | 4 tests — compile-time shape tests for old interfaces | Imports `PluginContext`, `MarkablePlugin`, `PluginDef` from `src/plugins/plugin-types.ts` (deleted). These tested the old interface shape; the equivalent types are now in `markable-plugin-api.ts` and are covered by `tests/markable-plugin-api.test.ts`. |

## Test Files to UPDATE

### `tests/loader-unification.test.ts`

This file imports `buildUserPluginAPI` from `user-plugin-loader.ts` and tests the deprecated alias. After deleting the alias, the describe block `"buildUserPluginAPI deprecated alias"` (lines 155–195) must be removed. The remaining tests in this file (`evaluatePlugin()` tests for EC-2 through EC-22) are unaffected.

Also update the import line to remove `buildUserPluginAPI`:
```typescript
// Before:
import { evaluatePlugin, buildUserPluginAPI, buildMarkablePluginAPI } from "../src/plugins/user-plugin-loader";

// After:
import { evaluatePlugin, buildMarkablePluginAPI } from "../src/plugins/user-plugin-loader";
```

If `buildMarkablePluginAPI` is also exported from `user-plugin-loader.ts` via the re-export line `export { buildMarkablePluginAPI } from "./markable-plugin-api"`, confirm that re-export remains after the cleanup.

### `tests/user-plugin-loader.test.ts`

This file tests `evaluatePlugin()` with legacy `UserPlugin` validation (no `kind` param). After the cleanup, `evaluatePlugin` still supports the no-`kind` path for backward compat with any legacy user plugins that predate the version field requirement. However, if `EvaluatePluginResult` now types the plugin as `UnifiedPlugin` (which requires `version`), the legacy no-`kind` path now returns a structurally-typed result where `version` may be absent on the actual runtime object.

The test at line 103–117 (`"accepts plugin with optional detail field"`) does not use `kind`, so it exercises the legacy path. This test remains valid — it tests that a plugin without `version` still loads when `kind` is omitted.

No changes required to this file unless the `EvaluatePluginResult` type rename breaks the import. If it does, update:
```typescript
// If UserPluginLoadResult is renamed to EvaluatePluginResult:
// No direct import of that type in this file — the tests only use the return values.
// No change needed.
```

---

## Section E: Extract `status-bar.ts` unit tests before deleting `status-bar-plugin.test.ts`

`tests/status-bar-plugin.test.ts` bundles two distinct test subjects:
1. `StatusBarPlugin` (the old `index.ts` wrapper) — 7 tests referencing the `Plugin` object directly.
2. `status-bar.ts` infrastructure (`ensureStatusBar`, `hideStatusBarIfUnused`, `registerStatusBarDependent`, etc.) — 6 tests that are genuinely useful regardless of the plugin wrapper.

Before deleting `status-bar-plugin.test.ts`, create `tests/status-bar.test.ts` with the 6 infrastructure tests. These tests do not import anything from `src/plugins/status-bar/index.ts`; they only import from `src/plugins/status-bar/status-bar.ts` which is not being deleted.

The 6 tests to extract are:
- EC-1: `"does not throw when #statusbar is not in the DOM"`
- EC-1: `"sets the internal visible flag to true even without a DOM element"`
- EC-2: `"hides the bar when no dependents are registered"`
- EC-2: `"does NOT hide when Word Count is registered as a dependent"`
- EC-2: `"hides the bar once the sole dependent is unregistered"`
- EC-3: `"registering the same id twice keeps effective set size at 1"`

The `beforeEach` reset block (lines 78–88 of `status-bar-plugin.test.ts`) must be copied into the new file.

The 7 `StatusBarPlugin`-specific tests (EC-12 describe block + EC-15 describe block + "StatusBarPlugin metadata" describe block) are deleted along with the file.

---

## Deletion Order

Execute in this order to avoid TypeScript errors at intermediate stages:

1. Confirm zero live importers of the four plugin `index.ts` files (import check command below).
2. Delete `tests/focus-mode-plugin.test.ts`, `tests/typewriter-mode-plugin.test.ts`, `tests/word-count-plugin.test.ts`.
3. Create `tests/status-bar.test.ts` (extracted infrastructure tests).
4. Delete `tests/status-bar-plugin.test.ts`.
5. Delete `tests/plugin-types.test.ts`.
6. Remove the `"buildUserPluginAPI deprecated alias"` describe block from `tests/loader-unification.test.ts`; update the import line.
7. Delete `src/plugins/focus-mode/index.ts`.
8. Delete `src/plugins/typewriter-mode/index.ts`.
9. Delete `src/plugins/word-count/index.ts`.
10. Delete `src/plugins/status-bar/index.ts`.
11. Remove `buildUserPluginAPI` function from `src/plugins/user-plugin-loader.ts`; update the `UserPluginLoadResult` import; define or import the replacement type (see section C).
12. Confirm zero live importers of `src/plugins/plugin-types.ts`.
13. Confirm zero live importers of `src/plugins/user-plugin-types.ts`.
14. Delete `src/plugins/plugin-types.ts`.
15. Delete `src/plugins/user-plugin-types.ts`.
16. Remove the five deprecated fields from `MarkableSettings` in `src/lib/settings.ts`.
17. Run `npm test` and `cargo test` — both must pass with zero failures.

---

## Import Check Commands

Before deleting any file, run these to confirm no live importers remain. These are `grep` invocations for the terminal — run them from the project root.

```bash
# Check for any src/ import of the four plugin index.ts wrappers:
grep -r "plugins/focus-mode/index" src/ --include="*.ts"
grep -r "plugins/typewriter-mode/index" src/ --include="*.ts"
grep -r "plugins/word-count/index" src/ --include="*.ts"
grep -r "plugins/status-bar/index" src/ --include="*.ts"

# Check for any remaining imports of plugin-types.ts (beyond @deprecated users):
grep -r "from.*plugin-types" src/ --include="*.ts"
grep -r "from.*plugin-types" tests/ --include="*.ts"

# Check for any remaining imports of user-plugin-types.ts:
grep -r "from.*user-plugin-types" src/ --include="*.ts"
grep -r "from.*user-plugin-types" tests/ --include="*.ts"

# Check for any remaining references to buildUserPluginAPI:
grep -r "buildUserPluginAPI" src/ --include="*.ts"
grep -r "buildUserPluginAPI" tests/ --include="*.ts"
```

Expected output for each: empty (no matches). If any match is found, update that file before proceeding with the deletion.

---

## `tests/status-bar.test.ts` — Full Content

```typescript
/**
 * Tests for status-bar infrastructure (src/plugins/status-bar/status-bar.ts).
 *
 * These tests cover the status bar visibility helpers independent of any plugin wrapper.
 * Extracted from status-bar-plugin.test.ts during step_04b cleanup.
 *
 * EC-1:  ensureStatusBar does not throw when #statusbar is absent from the DOM.
 * EC-2:  hideStatusBarIfUnused does NOT hide the bar when a dependent is registered.
 * EC-3:  registerStatusBarDependent is idempotent (Set semantics).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureStatusBar,
  hideStatusBarIfUnused,
  registerStatusBarDependent,
  unregisterStatusBarDependent,
  getStatusBarVisible,
  setStatusBarVisible,
} from "../src/plugins/status-bar/status-bar";

beforeEach(() => {
  setStatusBarVisible(false);
  unregisterStatusBarDependent("wordCount");
  unregisterStatusBarDependent("focusMode");
  unregisterStatusBarDependent("typewriterMode");
  unregisterStatusBarDependent("statusBar");
});

describe("EC-1: ensureStatusBar — safe when #statusbar element is absent", () => {
  it("does not throw when #statusbar is not in the DOM", () => {
    expect(() => ensureStatusBar()).not.toThrow();
  });

  it("sets the internal visible flag to true even without a DOM element", () => {
    ensureStatusBar();
    expect(getStatusBarVisible()).toBe(true);
  });
});

describe("EC-2: hideStatusBarIfUnused — does not hide when a dependent is registered", () => {
  it("hides the bar when no dependents are registered", () => {
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });

  it("does NOT hide when Word Count is registered as a dependent", () => {
    setStatusBarVisible(true);
    registerStatusBarDependent("wordCount");
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(true);
  });

  it("hides the bar once the sole dependent is unregistered", () => {
    setStatusBarVisible(true);
    registerStatusBarDependent("wordCount");
    unregisterStatusBarDependent("wordCount");
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });
});

describe("EC-3: registerStatusBarDependent — idempotent (Set semantics)", () => {
  it("registering the same id twice keeps effective set size at 1", () => {
    registerStatusBarDependent("wordCount");
    registerStatusBarDependent("wordCount");
    unregisterStatusBarDependent("wordCount");
    setStatusBarVisible(true);
    hideStatusBarIfUnused();
    expect(getStatusBarVisible()).toBe(false);
  });
});
```

---

## Test Count Impact

| Change | Before | After |
|--------|--------|-------|
| `tests/focus-mode-plugin.test.ts` deleted | 13 tests | 0 |
| `tests/typewriter-mode-plugin.test.ts` deleted | 10 tests | 0 |
| `tests/word-count-plugin.test.ts` deleted | 10 tests | 0 |
| `tests/status-bar-plugin.test.ts` deleted | 13 tests | 0 |
| `tests/status-bar.test.ts` created | 0 | 6 |
| `tests/plugin-types.test.ts` deleted | 4 tests | 0 |
| `tests/loader-unification.test.ts` trimmed | 5 tests removed | 5 fewer |
| **Net change** | — | **-49 tests** |

Total test count moves from approximately 204 to approximately 155. The removed tests all exercised code that no longer exists. The `tests/status-bar.test.ts` replacement preserves coverage of the 6 genuinely useful infrastructure cases.

---

## Verification Checklist

- [ ] Import check commands (section above) all return empty before any deletion.
- [ ] `tests/status-bar.test.ts` created and passes (6 tests green) before `status-bar-plugin.test.ts` is deleted.
- [ ] All five source files deleted: `focus-mode/index.ts`, `typewriter-mode/index.ts`, `word-count/index.ts`, `status-bar/index.ts`, `user-plugin-types.ts`.
- [ ] `plugin-types.ts` deleted.
- [ ] `buildUserPluginAPI` absent from `user-plugin-loader.ts` and from all grep results.
- [ ] `MarkableSettings` in `settings.ts` has no `statusBar?`, `wordCount?`, `focusMode?`, `typewriterMode?`, or `userPlugins?` fields.
- [ ] `npm run build` (or `npx tsc --noEmit`) exits 0.
- [ ] `npm test` exits 0 (all remaining tests pass).
- [ ] `cargo test` exits 0.
- [ ] `npm run tauri dev` launches normally — all four core plugins load from `~/Library/.../plugins/core/` and function correctly.
