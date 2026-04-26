---
title: "step_04 — StateField, Plugin Scaffold, and Build Registration"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_04 — StateField, Plugin Scaffold, and Build Registration

## Goal

Assemble the CM6 `StateField<DecorationSet>` that drives the decoration set, wire the
plugin `onEnable` / `onDisable` lifecycle, and register the plugin in the build script.
After this step the plugin is buildable, loadable, and can be enabled/disabled via the
Plugins panel (visual images may not be pixel-perfect until step_05 adds CSS).

---

## `buildImageDecorations(state, maxDisplayWidth): DecorationSet`

This function is the render-decision core. It calls `scanImageRanges(state)`, resolves
each URL, checks cursor overlap, and builds the `RangeSetBuilder`.

```typescript
export function buildImageDecorations(
  state: EditorState,
  maxDisplayWidth: number,
): DecorationSet {
  const ranges = scanImageRanges(state);
  const sel = state.selection.main;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const currentFile: string | null =
    (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const range of ranges) {
    // Cursor-on-reveal: if cursor/selection overlaps this image range, skip
    // the decoration so the raw Markdown source is shown (FR-1.3, FR-1.4).
    if (isCursorInsideRange(sel.anchor, sel.head, range.from, range.to)) {
      continue;
    }

    const resolvedSrc = resolveImageSrc(range.src, currentFile);

    const widget = new ImageWidget(
      resolvedSrc,
      range.cleanAlt,
      range.cssClasses,
      range.cssStyle,
      range.displayWidth,
      range.displayHeight,
      maxDisplayWidth,
      range.src, // originalSrc for broken-image hover title
    );

    builder.add(
      range.from,
      range.to,
      Decoration.replace({ widget }),
    );
  }

  return builder.finish();
}
```

Key points:
- `currentFile` is read fresh on every call (not cached) to reflect tab switches (AD-2).
- `resolveImageSrc` handles the empty-URL case by returning `""`, which causes
  `ImageWidget.toDOM()` to show the broken-image placeholder immediately (EC-03).
- `RangeSetBuilder.add()` requires ranges in ascending `from` order. `scanImageRanges()`
  guarantees this via its final sort.

---

## `createImageField(maxDisplayWidth: number)` Factory

```typescript
/**
 * Factory function — creates a fresh StateField per enable cycle (EC-24).
 *
 * The field is not a module-level constant. onEnable constructs a new one each
 * time it is called, ensuring no residual decoration state from a prior cycle.
 */
function createImageField(
  maxDisplayWidth: number,
): ReturnType<typeof StateField.define> {
  return StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
      return buildImageDecorations(state, maxDisplayWidth);
    },

    update(value: DecorationSet, tr: Transaction): DecorationSet {
      // Recompute on document change OR selection change.
      // Selection change is the trigger for cursor-on-reveal (FR-1.7).
      if (!tr.docChanged && !tr.selection) {
        return value;
      }
      return buildImageDecorations(tr.state, maxDisplayWidth);
    },

    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}
```

The `maxDisplayWidth` value is captured in the factory closure. If the user changes the
setting, `onDisable` + `onEnable` cycle produces a fresh field with the new value.

---

## Module-Level State

```typescript
/** Currently active StateField instance. Null when plugin is disabled. */
let _imageField: ReturnType<typeof StateField.define> | null = null;
```

---

## Plugin Lifecycle

### `onEnable(api: MarkablePluginAPI)`

```typescript
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // Step 1: Load settings (FR-7.2)
  const saved = await api.loadSettings();
  const maxDisplayWidth: number =
    typeof saved?.maxDisplayWidth === "number" && saved.maxDisplayWidth >= 0
      ? saved.maxDisplayWidth
      : 600; // FR-7.1 default

  // Step 2: Inject CSS (idempotent — EC-30)
  injectPluginCSS();

  // Step 3: Suppress core fallback (FR-6.2, AD-6)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Step 4: Create fresh StateField and register (EC-24)
  _imageField = createImageField(maxDisplayWidth);
  api.addExtensions([_imageField]);
}
```

### `onDisable(api: MarkablePluginAPI)`

```typescript
function onDisable(api: MarkablePluginAPI): void {
  // Step 1: Remove CM6 extensions (decorations disappear; raw Markdown shown)
  api.removeExtensions();

  // Step 2: Re-enable core fallback (FR-6.2)
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = false;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Step 3: Remove injected CSS
  removePluginCSS();

  // Step 4: Clear field reference
  _imageField = null;
}
```

---

## Plugin Export Object

```typescript
export default {
  id: "media-preview",
  name: "Media Preview",
  version: "1.0.0",
  description: "Render images inline in the live editor",
  detail:
    "Renders ![alt](url) image syntax as visual images in live preview mode. " +
    "Clicking a rendered image reveals the raw Markdown source for editing. " +
    "Supports local files (relative and absolute paths) and remote URLs. " +
    "Alt text supports CSS class shorthand (.classname) and inline style ({property:value}) annotations. " +
    "Configure maxDisplayWidth in plugin settings (default: 600px).",
  onEnable,
  onDisable,
};
```

---

## Build Registration

### `scripts/build-plugins.mjs`

Add the `media-preview` entry to the `PLUGINS` array (after the existing `math` entry):

```javascript
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
  ["backlinks",         "src/plugins/backlinks/backlinks.plugin.ts"],
  ["templates",         "src/plugins/templates/templates.plugin.ts"],
  ["yaml-pane",         "src/plugins/yaml-pane/yaml-pane.plugin.ts"],
  ["math",              "src/plugins/math/math.plugin.ts"],
  ["media-preview",     "src/plugins/media-preview/media-preview.plugin.ts"],  // NEW
];
```

No other changes to `build-plugins.mjs` are needed — the build configuration is generic
and applies equally to all plugins.

---

## CM6 Globals Destructure (Top of Plugin File)

The full globals destructure block at the top of `media-preview.plugin.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  WidgetType,
  Decoration,
  EditorView: _EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");

const {
  StateField,
  RangeSetBuilder,
} = (window as any).__CM_STATE__ as typeof import("@codemirror/state");

const {
  syntaxTree,
} = (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Type-only imports (erased at compile time, safe in IIFE context):

```typescript
import type { DecorationSet, WidgetType as WidgetTypeClass } from "@codemirror/view";
import type { Transaction, EditorState } from "@codemirror/state";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

---

## Complete File Structure

`src/plugins/media-preview/media-preview.plugin.ts` contains these sections in order:

1. File-level JSDoc comment (architecture reference, IIFE rules, same format as math plugin)
2. Type-only imports
3. CM6 globals destructure
4. `ImageRange` and `AltAnnotations` type definitions (step_02)
5. `parseAltAnnotations()` (step_02)
6. `scanImageRanges()` (step_02)
7. `resolveImageSrc()` (step_02)
8. `isCursorInsideRange()` (step_02)
9. CSS injection helpers: `injectPluginCSS()`, `removePluginCSS()` (step_05)
10. `renderBrokenImage()` (step_03)
11. `ImageWidget` class (step_03)
12. `buildImageDecorations()` (this step)
13. `createImageField()` factory (this step)
14. Module-level state: `_imageField` (this step)
15. `onEnable()` (this step)
16. `onDisable()` (this step)
17. `export default` object (this step)

---

## Stale Plugin Cleanup

The Rust `copy_core_plugins` command in `src-tauri/src/commands/plugins.rs` performs
stale plugin cleanup — it removes `.js` files in the user data core plugins directory
that are not in the current bundle. No change is needed to Rust code. The new
`media-preview.js` file will be copied automatically on the next `npm run build:plugins`
followed by `npm run tauri dev`.

---

## Implementation Notes

- `onEnable` is `async` because `api.loadSettings()` is async. The plugin interface
  allows `onEnable` to return `void | Promise<void>` (see `markable-plugin-api.ts`).

- `maxDisplayWidth` is captured in the factory closure, not as a module-level variable.
  This means a settings change requires a `restartSelf()` cycle. No settings UI is
  implemented in Phase 1, so this is acceptable.

- The `__MARKABLE_MEDIA_PREVIEW_ACTIVE__` flag is set to `true` (not the string `"true"`).
  The check in `live-preview.ts` uses a truthy test: `if ((window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__) return;`

- `onDisable` sets the flag to `false` (not `delete`s it). Setting to `false` is simpler
  and equivalent for the truthy check in `handleImage()`.

---

## Test Cases for This Step

Manual / integration verification:

1. `npm run build:plugins` — `media-preview.js` appears in `src-tauri/plugins/core/`.
2. `npm run tauri dev` — Plugin appears in the Plugins panel.
3. Enable the plugin — Images in a test document render as `<img>` elements.
4. Disable the plugin — Raw `![alt](url)` Markdown is visible; core fallback resumes.
5. Re-enable — Images render again (EC-24 fresh StateField).
6. Open a document with no images — no errors in console (EC-12 AC behavior).

---

## Definition of Done

- [ ] `buildImageDecorations()` exported; reads `__MARKABLE_CURRENT_FILE__` on every call.
- [ ] `createImageField()` factory returns fresh StateField; `maxDisplayWidth` captured in closure.
- [ ] `onEnable()` is async; loads settings; injects CSS; sets suppression flag; creates
  and registers fresh StateField.
- [ ] `onDisable()` removes extensions; clears suppression flag; removes CSS; nulls field reference.
- [ ] Plugin `export default` has all required fields matching FR-6.3.
- [ ] `["media-preview", ...]` added to `PLUGINS` array in `build-plugins.mjs`.
- [ ] `npm run build:plugins` succeeds with no errors.
- [ ] Plugin loads and toggles cleanly via Plugins panel in the running app.
- [ ] No TODO comments in source.
