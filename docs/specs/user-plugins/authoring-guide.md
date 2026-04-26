# Markable User Plugin Authoring Guide

## File format

A user plugin is a single `.js` file placed in:

    ~/Library/Application Support/com.markable.app/plugins/

The file must contain a `return` statement at the top level that yields a plugin object:

    "use strict";

    let _element = null;

    return {
      id: "my-plugin",           // unique string; no dots, slashes, or backslashes
      name: "My Plugin",
      description: "One-line summary shown in the Plugins panel.",
      detail: "Optional longer description shown in the detail view.",

      onEnable(api) {
        _element = document.createElement("span");
        _element.textContent = "Hello";
        api.statusBar.center.appendChild(_element);
        api.ensureStatusBar();
      },

      onDisable(api) {
        _element?.remove();
        _element = null;
        api.hideStatusBarIfUnused();
      },
    };

## Available API (api parameter)

| Property | Type | Description |
|---|---|---|
| `api.statusBar.left` | `HTMLElement` | Left zone of the status bar |
| `api.statusBar.center` | `HTMLElement` | Center zone of the status bar |
| `api.statusBar.right` | `HTMLElement` | Right zone of the status bar |
| `api.ensureStatusBar()` | `void` | Show the status bar |
| `api.hideStatusBarIfUnused()` | `void` | Hide the status bar if no other plugin needs it |
| `api.loadSettings()` | `Promise<object \| null>` | Load this plugin's settings.json |
| `api.saveSettings(data)` | `Promise<void>` | Save settings to plugins/<id>/settings.json |

## Sandbox boundary (important)

Your plugin runs in the same WebView as Markable. `window`, `document`, and other browser globals are accessible. However, **you should not access `window.__TAURI_INTERNALS__` or call `invoke()` directly** — these are internal Tauri APIs that can change without notice and will bypass Markable's security model.

The only officially supported API is the `api` parameter passed to `onEnable` and `onDisable`.

## Reloading plugins

After installing a new plugin file, click **Reload** in the User Plugins section of the Plugins panel (Cmd-Shift-P). The new file will be evaluated and registered. Already-loaded plugins are not re-evaluated.

**Limitation (EC-22):** If you fix a bug in a plugin file, you must quit and relaunch Markable to pick up the corrected version. The Reload button only registers *new* files, not updated ones.

## Persisting settings

Use `api.loadSettings()` and `api.saveSettings(data)` to store plugin-specific settings as a JSON object. Settings are stored at `plugins/<your-plugin-id>/settings.json`. Save eagerly on each change rather than only in `onDisable`, because `onDisable` may not complete before the window closes (EC-26).

### Important asymmetry between `loadSettings` and `saveSettings`

`api.loadSettings()` **never rejects**. If the settings file is absent (first run), unreadable, or contains invalid JSON, it resolves to `null` rather than throwing. Always check for `null` before accessing the returned object.

`api.saveSettings(data)` **can reject** in two cases:
- The filesystem write fails (e.g. disk full, permission error).
- `data` contains values that are not JSON-serializable (e.g. `undefined`, circular references, `BigInt`).

Wrap `saveSettings` calls in a `try/catch` and decide in your plugin whether a failed save should be silently swallowed or surfaced to the user via the status bar.

## Error handling

If `onEnable` or `onDisable` throws, the error is caught by Markable, logged to the console, and the plugin is marked disabled. Other plugins are unaffected.
