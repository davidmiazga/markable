# Step 03 — Plugin Loader + Bridge Wrappers

**Objective:** Create `src/plugins/user-plugin-loader.ts` (evaluation engine, validation, API builder); add 4 bridge wrapper functions to `src/lib/bridge.ts`.

**Traceability:** PC-1, PC-2, PC-3, PC-4, PC-8, EC-2, EC-3, EC-4, EC-5, EC-14.

---

## Files to Create

### `src/plugins/user-plugin-loader.ts` (new file)

#### Evaluation Strategy Rationale

The `new Function` approach is selected (see `00_index.md` section 1 for full trade-off analysis). The plugin source is passed as the body of a strict-mode function whose only parameter is `api`. The convention: the plugin source file must end with a `return` statement yielding the plugin object.

The `new Function` call does NOT use `.call(window, ...)`, so `this` inside the plugin is `undefined` in strict mode. `window` and `document` remain accessible via the global scope — this is the documented, convention-only limitation (EC-14). The loader does not inject any reference to `window`, `document`, `invoke`, or `__TAURI_INTERNALS__` into the function's explicit parameter list.

#### Authoring convention for plugin files

A valid plugin file looks like:

```javascript
// my-plugin.js
"use strict";

let _enabled = false;
let _element = null;

return {
  id: "my-plugin",
  name: "My Plugin",
  description: "Does something useful.",
  onEnable(api) {
    _enabled = true;
    _element = document.createElement("span");
    _element.textContent = "Hello from My Plugin";
    api.statusBar.center.appendChild(_element);
    api.ensureStatusBar();
  },
  onDisable(api) {
    _enabled = false;
    if (_element) {
      _element.remove();
      _element = null;
    }
    api.hideStatusBarIfUnused();
  },
};
```

The loader prepends `"use strict";\n` to the source before passing it to `new Function` so that plugins that omit the directive still run in strict mode.

```typescript
/**
 * UserPluginLoader — evaluate, validate, and build API for user plugins.
 *
 * Evaluation strategy: new Function('api', '"use strict";\n' + source).
 * See docs/specs/user-plugins/00_index.md §1 for trade-off analysis.
 *
 * EC-14: window/document are accessible from within the plugin execution
 * context (same WebView). The UserPluginAPI parameter is the only explicit
 * injection. This limitation is documented and convention-enforced only.
 */

import type { UserPlugin, UserPluginAPI, UserPluginLoadResult } from "./user-plugin-types";
import { readPluginSettings, writePluginSettings } from "../lib/bridge";
import { ensureStatusBar, hideStatusBarIfUnused } from "./status-bar/status-bar";

// ── Validation ────────────────────────────────────────────────────────────────

/** Fields required on every UserPlugin object. */
const REQUIRED_FIELDS: ReadonlyArray<keyof UserPlugin> = [
  "id",
  "name",
  "description",
  "onEnable",
  "onDisable",
];

/**
 * Characters that make a plugin id invalid as a settings key.
 * EC-20: empty string, '.', '/', '\', NUL.
 */
const INVALID_ID_RE = /[./\\\0]/;

/**
 * Validate that obj satisfies UserPlugin structurally.
 *
 * Returns null on success; an error string describing the first violation
 * on failure. The caller logs this string and skips the plugin.
 *
 * EC-4: null/non-object default export rejected here.
 * EC-5: missing required fields detected here with named-field list.
 * EC-20: invalid id characters rejected here.
 */
function validate(obj: unknown, filename: string): string | null {
  if (obj === null || typeof obj !== "object") {
    return `${filename}: default export is not an object (got ${obj === null ? "null" : typeof obj})`;
  }

  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in (obj as Record<string, unknown>))) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    return `${filename}: missing required field(s): ${missing.join(", ")}`;
  }

  const record = obj as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.trim() === "") {
    return `${filename}: 'id' must be a non-empty string`;
  }

  if (INVALID_ID_RE.test(record.id as string)) {
    return `${filename}: 'id' contains invalid characters (got "${record.id}")`;
  }

  if (typeof record.name !== "string" || record.name.trim() === "") {
    return `${filename}: 'name' must be a non-empty string`;
  }

  if (typeof record.description !== "string" || record.description.trim() === "") {
    return `${filename}: 'description' must be a non-empty string`;
  }

  if (typeof record.onEnable !== "function") {
    return `${filename}: 'onEnable' must be a function`;
  }

  if (typeof record.onDisable !== "function") {
    return `${filename}: 'onDisable' must be a function`;
  }

  return null; // valid
}

// ── API builder ───────────────────────────────────────────────────────────────

/**
 * Build the UserPluginAPI object for a specific plugin.
 *
 * The api object captures the plugin's id in the loadSettings/saveSettings
 * closures; the plugin never receives its id directly from the API object
 * (it already has it as plugin.id).
 *
 * statusBar zone references are passed in from the PluginManager so the
 * loader does not need to query the DOM itself.
 *
 * PC-3: Only the listed properties are present. EditorView, invoke,
 * window.__TAURI_INTERNALS__, and all CM6 constructs are absent.
 */
export function buildUserPluginAPI(
  pluginId: string,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): UserPluginAPI {
  return {
    statusBar: statusBarZones,

    ensureStatusBar,

    hideStatusBarIfUnused,

    async loadSettings(): Promise<Record<string, unknown> | null> {
      try {
        return await readPluginSettings(pluginId);
      } catch (err) {
        console.warn(`[UserPlugin:${pluginId}] loadSettings failed:`, err);
        return null;
      }
    },

    async saveSettings(data: Record<string, unknown>): Promise<void> {
      await writePluginSettings(pluginId, data);
    },
  };
}

// ── Evaluator ─────────────────────────────────────────────────────────────────

/**
 * Evaluate plugin source text and return a validated UserPlugin or an error.
 *
 * Evaluation uses `new Function('api', '"use strict";\n' + source)`.
 * The api parameter passed here is a stub used during evaluation — the real
 * api is built per-plugin in buildUserPluginAPI() and injected at enable time.
 * During evaluation the return value is captured; api is not called.
 *
 * EC-2: empty/whitespace-only source → no-op, returns error.
 * EC-3: syntax errors thrown by `new Function` are caught here.
 * EC-4: non-object return value rejected by validate().
 * EC-5: missing fields rejected by validate().
 * EC-14: convention-only boundary; window is not blocked.
 *
 * @param source    UTF-8 text of the plugin file (already read by Rust command).
 * @param filename  Original filename, used in error messages.
 */
export function evaluatePlugin(
  source: string,
  filename: string,
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
    // Prepend strict mode. The plugin source is the function body.
    // The plugin must `return { id, name, ... }` at the top level of its source.
    // A stub api (null cast) is passed; the real api is injected at enable time.
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

  // EC-4, EC-5: structural validation.
  const validationError = validate(pluginObj, filename);
  if (validationError !== null) {
    return { ok: false, filename, reason: validationError };
  }

  return { ok: true, plugin: pluginObj as UserPlugin };
}
```

---

## Files to Modify

### `src/lib/bridge.ts`

Add 4 new async wrapper functions at the end of the file (after line ~204, after `readThemeCss`).

Import the `UserPluginAPI` return type is not needed in bridge.ts — the return types are primitives and simple objects.

Append after the last existing export:

```typescript
// ── User Plugin commands ──────────────────────────────────────────────────────

/**
 * List top-level .js filenames in the user plugins directory.
 * Returns [] if the directory does not exist (Rust creates it on first call).
 * EC-1, EC-27.
 */
export async function listUserPlugins(): Promise<string[]> {
  try {
    return await invoke<string[]>("list_user_plugins");
  } catch (error) {
    console.error("Failed to list user plugins:", error);
    return [];
  }
}

/**
 * Read the source text of a user plugin file.
 * Returns null if the file does not exist or is rejected (too large, binary).
 * EC-11, EC-12, EC-13.
 */
export async function readPluginFile(filename: string): Promise<string | null> {
  try {
    return await invoke<string>("read_plugin_file", { filename });
  } catch (error) {
    console.warn(`Failed to read plugin file "${filename}":`, error);
    return null;
  }
}

/**
 * Read per-plugin settings JSON.
 * Returns the parsed object, or null if no settings file exists yet (EC-23).
 */
export async function readPluginSettings(
  pluginId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await invoke<string | null>("read_plugin_settings", { pluginId });
    if (raw === null || raw === undefined) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    console.warn(`Failed to read settings for plugin "${pluginId}":`, error);
    return null;
  }
}

/**
 * Write per-plugin settings JSON.
 * Throws if data is not JSON-serialisable (EC-25 — Rust validates before write).
 */
export async function writePluginSettings(
  pluginId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(data);
  await invoke("write_plugin_settings", { pluginId, data: json });
}
```

Note: the `invoke` import already exists at line 8 of `bridge.ts` — do not add a duplicate import.

---

## Test file to create: `tests/user-plugin-loader.test.ts`

```typescript
/**
 * Tests for UserPluginLoader (src/plugins/user-plugin-loader.ts).
 *
 * evaluatePlugin() is a pure synchronous function (new Function eval).
 * All cases are testable without a real DOM or Tauri runtime.
 */

import { describe, it, expect } from "vitest";
import { evaluatePlugin } from "../src/plugins/user-plugin-loader";

const MINIMAL_PLUGIN = `
return {
  id: "test-plugin",
  name: "Test Plugin",
  description: "A test plugin.",
  onEnable(api) {},
  onDisable(api) {},
};
`;

describe("evaluatePlugin()", () => {
  it("returns ok:true for a valid minimal plugin", () => {
    const result = evaluatePlugin(MINIMAL_PLUGIN, "test.js");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plugin.id).toBe("test-plugin");
      expect(result.plugin.name).toBe("Test Plugin");
    }
  });

  it("EC-2: rejects empty source", () => {
    const result = evaluatePlugin("", "empty.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("EC-2: rejects whitespace-only source", () => {
    const result = evaluatePlugin("   \n\t  ", "ws.js");
    expect(result.ok).toBe(false);
  });

  it("EC-3: rejects source with a syntax error", () => {
    const result = evaluatePlugin("return { id: 'x', ;;; }", "bad-syntax.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("evaluation error");
  });

  it("EC-4: rejects source that returns null", () => {
    const result = evaluatePlugin("return null;", "null.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not an object");
  });

  it("EC-4: rejects source that returns a string", () => {
    const result = evaluatePlugin('return "hello";', "string.js");
    expect(result.ok).toBe(false);
  });

  it("EC-5: rejects plugin missing 'id' field", () => {
    const src = `return { name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "no-id.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("id");
  });

  it("EC-5: reports all missing fields in the error message", () => {
    const src = `return { id: "x" };`;
    const result = evaluatePlugin(src, "partial.js");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("name");
      expect(result.reason).toContain("description");
      expect(result.reason).toContain("onEnable");
      expect(result.reason).toContain("onDisable");
    }
  });

  it("EC-20: rejects plugin with empty id", () => {
    const src = `return { id: "", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "empty-id.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("id");
  });

  it("EC-20: rejects plugin id containing '.'", () => {
    const src = `return { id: "foo.bar", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "dotted-id.js");
    expect(result.ok).toBe(false);
  });

  it("EC-20: rejects plugin id containing '/'", () => {
    const src = `return { id: "foo/bar", name: "X", description: "Y", onEnable(){}, onDisable(){} };`;
    const result = evaluatePlugin(src, "slash-id.js");
    expect(result.ok).toBe(false);
  });

  it("filename is included in error result", () => {
    const result = evaluatePlugin("return null;", "specific-file.js");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.filename).toBe("specific-file.js");
  });

  it("accepts plugin with optional detail field", () => {
    const src = `
      return {
        id: "plugin-with-detail",
        name: "X",
        description: "Y",
        detail: "Long description.",
        onEnable(api) {},
        onDisable(api) {},
      };
    `;
    const result = evaluatePlugin(src, "detail.js");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plugin.detail).toBe("Long description.");
  });
});
```

---

## Verification Checklist

- [ ] `evaluatePlugin` returns `ok: true` for a valid minimal plugin (MINIMAL_PLUGIN above).
- [ ] `evaluatePlugin` returns `ok: false` with `reason` containing "empty" for empty source (EC-2).
- [ ] `evaluatePlugin` catches syntax errors and returns them in `reason` (EC-3).
- [ ] `evaluatePlugin` rejects `null` return value (EC-4).
- [ ] `evaluatePlugin` lists all missing field names in the error reason (EC-5).
- [ ] `evaluatePlugin` rejects id with `.`, `/`, `\`, or empty string (EC-20).
- [ ] `buildUserPluginAPI` does not include `editor`, `invoke`, or any Tauri globals in the returned object (PC-3).
- [ ] `bridge.ts` 4 new functions compile cleanly — `invoke` import is not duplicated.
- [ ] All new test cases in `user-plugin-loader.test.ts` pass.
