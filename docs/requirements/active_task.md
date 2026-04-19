---
title: "Media Preview — FC2 #7"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Media Preview (FC2 #7) Requirements Spec

## Summary

As a user, I want inline images (and optionally other media) to render as actual visual elements in the live editor — so that my notes display images in place rather than raw Markdown syntax — while still revealing the raw source when my cursor enters the image region for editing.

---

## Background and Motivation

FEATURES.md item 7 is labeled "Advanced Media Preview — inserting/previewing images, video, embedded `.md`." The scope for this implementation covers **images as the core deliverable**; other media types are explicitly deferred (see Out of Scope).

### What Already Exists

Image rendering in Markable already exists in `src/editor/live-preview.ts` as part of the core live-preview `ViewPlugin`. It is not a plugin — it is wired directly into the editor and cannot be toggled. The Media Preview plugin will:

1. Replace the existing non-toggleable image rendering in `live-preview.ts` with a proper, toggleable plugin that owns the image `WidgetType` and the `StateField`.
2. Keep the `resolveImageSrc` / `convertFileSrc` URL conversion logic — it already correctly handles relative paths, absolute paths, and remote URLs.
3. Add missing capabilities: broken-image error state, GIF/SVG edge cases, load-error fallback, accessibility attributes, and settings.

The existing implementation in `live-preview.ts` is the **authoritative reference** for how images are currently rendered. Key facts:
- `resolveImageSrc()` uses `convertFileSrc` from `@tauri-apps/api/core` (which converts a local path to the Tauri `asset://` protocol).
- Images are matched via the lezer syntax tree (`Image` node), not a regex scanner.
- Dimensions are parsed from alt text using the `alt|WxH` convention (e.g., `![photo|400x300](img.png)`).
- The `ImageWidget` passes `ignoreEvent(): true` (clicks pass through to the editor), which means clicking a rendered image does NOT reveal raw source today — this must change.

### IIFE Constraint

The plugin is a bundled IIFE file loaded at runtime. It cannot use `@tauri-apps/api/core` directly because that is an app-internal module not available via window globals. The `convertFileSrc` function must be exposed via `window.__MARKABLE_CONVERT_FILE_SRC__` (see FR-3 and the Architecture Decisions section).

---

## Functional Requirements

### FR-1: Image Rendering in Live Preview

**FR-1.1** The plugin renders any standard CommonMark inline image syntax `![alt](url)` as a visual `<img>` element in the editor, replacing the raw Markdown syntax when the cursor is not on the image's line(s).

**FR-1.2** The rendered image widget is a CM6 `ReplaceDecoration` wrapping an `<img>` element. The image element carries:
- `src` set to the resolved URL (see FR-3 for URL resolution rules).
- `alt` set to the cleaned alt text (after dimension annotations and CSS annotations are stripped, per FR-2).
- `class="cm-media-image"` for CSS targeting, plus any additional CSS classes derived from alt text annotation (per FR-2.4).

**FR-1.3** Cursor-on-reveal (Typora-style contract): when the cursor is on any position within the image's source range `[from, to)`, the raw Markdown syntax is shown and the widget is not rendered. When the cursor leaves the range, the widget re-renders.

**FR-1.4** "Cursor inside" is defined identically to the Math plugin: any position where `selFrom < to && selTo >= from` (using normalized selection). Inclusive on both delimiter characters.

**FR-1.5** Clicking on a rendered image widget moves the cursor into the image's source range (which triggers FR-1.3 to reveal the raw source). The `ignoreEvent()` method on the widget must return `false`. This is a behavior change from the current live-preview.ts implementation (which uses `ignoreEvent: true`).

**FR-1.6** The plugin uses a CM6 `StateField<DecorationSet>` (not a `ViewPlugin`) for the decoration set. Rationale: consistency with the Math plugin pattern; block decorations require StateField stability; and the plugin needs to be independently registered/removed via `api.addExtensions()`.

**FR-1.7** The `StateField` recomputes on every `docChanged` or `selectionSet` transaction.

### FR-2: Alt Text Annotation Parsing

**FR-2.1** The existing `alt|WxH` and `alt|W` dimension-annotation convention is preserved:
- `![photo|400x300](img.png)` → `width: 400px; height: 300px`
- `![photo|400](img.png)` → `width: 400px; height: auto`
- `![photo](img.png)` → no explicit size (natural image size, capped by `maxDisplayWidth`)

**FR-2.2** The separator may be `|` (pipe) with optional surrounding spaces. The Unicode multiply character `×` is accepted as an alternative to `x` for dimensions (matching the existing implementation).

**FR-2.3** The cleaned alt text (with all annotation tokens stripped) is used as the `<img alt="">` attribute.

**FR-2.4** The plugin supports two CSS annotation mechanisms in alt text, both of which may coexist with dimension annotations:

**Class shorthand** — A dot-prefixed token in alt text (e.g., `![photo.center](img.png)`) maps to a CSS class on the `<img>` element:
- `![photo.center](img.png)` → `<img class="cm-media-image center" ...>`
- Multiple classes are supported: `![photo.center.shadow](img.png)` → class list includes `center` and `shadow`.
- The class shorthand may appear before or after a dimension annotation. All dot-class tokens are stripped from the alt text passed to `<img alt="">`.

**Inline CSS properties** — An arbitrary CSS string may be included using the `{...}` syntax (e.g., `![photo{border:2px solid red}](img.png)`):
- The content between `{` and `}` is treated as a CSS `style` attribute value and applied to the `<img>` element via `element.style.cssText`.
- Multiple properties are supported, comma-separated in standard CSS shorthand form.
- The `{...}` token is stripped from the alt text passed to `<img alt="">`.

Security constraint: inline CSS values are applied via the DOM `style` attribute only (not injected as raw HTML). JavaScript protocol values (`javascript:`) in CSS are ignored. (See EC-31 in the Edge Case Inventory.)

**FR-2.5** Zero or negative dimension values are ignored (treated as "no explicit size").

### FR-3: URL Resolution

**FR-3.1** The plugin must correctly render images from three URL categories:

| Category | Example | Resolution |
|---|---|---|
| Remote (http/https) | `![](https://example.com/a.png)` | Used as-is — no conversion needed |
| Absolute local path | `![](/Users/foo/img.png)` | Convert via `__MARKABLE_CONVERT_FILE_SRC__()` to `asset://` |
| Relative local path | `![](./img.png)` or `![](img.png)` | Resolve against current file's directory, then convert via `__MARKABLE_CONVERT_FILE_SRC__()` |

**FR-3.2** The current file path is accessed via `window.__MARKABLE_CURRENT_FILE__`. This global is confirmed to be updated synchronously on every tab switch via `_applyActiveTab()` in `tab-manager.ts` — no race conditions.

**FR-3.3** `file://` URLs must be rejected and treated as broken-image (EC-09). Tauri's security policy does not allow `file://` for local assets.

**FR-3.4** `data:` URLs (base64-embedded images) are supported as-is — they require no conversion.

**FR-3.5** An empty URL `![]()` or `![alt]()` produces a broken-image placeholder (EC-03), not a rendering attempt.

### FR-4: Image Scanning Strategy

The plugin uses **Option A: lezer syntax tree via `window.__CM_LANGUAGE__`**. The `__CM_LANGUAGE__` global already exists in the codebase (`cm-globals.ts`). The plugin calls `syntaxTree(state)` (accessed from `window.__CM_LANGUAGE__`) to walk the parsed AST for `Image` nodes, identical to how `live-preview.ts` currently scans images.

This is more accurate than a regex scanner and is not fragile for edge cases such as images inside fenced code blocks or inline code spans. The lezer parser natively excludes image syntax inside code fences from the `Image` node type.

**FR-4.1** The scanner must not produce decorations for image syntax appearing inside:
- Fenced code blocks (` ``` `)
- Inline code spans (`` ` ``)

These cases are handled automatically by the lezer AST — no additional filtering is required.

**FR-4.2** The scanner returns an array of `ImageRange` objects sorted ascending by `from` (required by `RangeSetBuilder`).

**FR-4.3** Each `ImageRange` contains: `from`, `to` (document offsets for the full `![alt](url)` span), `src` (raw URL string), `alt` (raw alt text including all annotations), `cssClasses` (string[] of class shorthand tokens), `cssStyle` (raw CSS string from `{...}` token or undefined), and `displayWidth`/`displayHeight` (parsed integers or undefined).

**FR-4.4** Edge case: if `syntaxTree(state)` returns an incomplete tree on the very first render (document not yet fully parsed), the scanner may produce an empty result. The StateField will recompute on the next transaction and recover. This is acceptable behavior (EC-32).

### FR-5: Broken Image Handling

**FR-5.1** When an image fails to load (network error, file not found, permission denied), the widget displays a broken-image placeholder instead of a blank area or broken browser icon. The placeholder contains:
- A visual icon (SVG inline, or CSS-drawn broken-image symbol).
- The `alt` text displayed as a caption below the icon.
- A `title` attribute on the container with the raw URL, so the user can hover to see what path failed.

**FR-5.2** The broken-image state is set via the `<img>` element's `onerror` event. The handler replaces the `<img>` with the placeholder DOM or applies a CSS error class.

**FR-5.3** An empty URL (EC-03) produces the broken-image placeholder immediately, without attempting to load anything.

**FR-5.4** The placeholder is styled with a CSS variable-compatible approach for theme compatibility (e.g., `color: var(--media-error-color, #c0392b)`).

**FR-5.5** A broken image is still subject to the cursor-on-reveal rule: the placeholder is shown when the cursor is away; the raw Markdown source is shown when the cursor enters the image range.

### FR-6: Plugin Lifecycle

**FR-6.1** The plugin is a new file: `src/plugins/media-preview/media-preview.plugin.ts`.

**FR-6.2** Image rendering coordination with `live-preview.ts`: a minimal image fallback remains in `live-preview.ts` even when the plugin is disabled. When the media-preview plugin is enabled, it must suppress the core fallback to prevent double rendering. The agreed mechanism is a global flag (`window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__`) that `live-preview.ts` checks: when true, the core fallback skips image decorations. The plugin sets this flag in `onEnable` and clears it in `onDisable`.

The minimal core fallback in `live-preview.ts` exists so users who have never installed or enabled the plugin still see images rendered. The plugin is not required to be enabled-by-default (though the Architect may choose that if the implementation is cleaner).

**FR-6.3** Plugin metadata:
- `id`: `"media-preview"`
- `name`: `"Media Preview"`
- `version`: `"1.0.0"`
- `description`: `"Render images inline in the live editor"`
- `detail`: A longer description explaining that `![alt](url)` image syntax is rendered inline; clicking a rendered image reveals the source Markdown for editing; supports local files (relative and absolute paths) and remote URLs; alt text supports CSS class shorthand (`.classname`) and inline style (`{property:value}`) annotations.

**FR-6.4** `onEnable` sequence:
1. Inject plugin CSS as a `<style>` tag (idempotent, guarded by element id).
2. Set `window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = true` to suppress the core fallback in `live-preview.ts`.
3. Construct a fresh `StateField<DecorationSet>`.
4. Register via `api.addExtensions([mediaPreviewField])`.

**FR-6.5** `onDisable` sequence:
1. `api.removeExtensions()` — removes decorations; raw Markdown syntax becomes visible.
2. Clear `window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__` — re-enables the core fallback in `live-preview.ts`.
3. Remove injected CSS `<style>` tag.

### FR-7: Settings

**FR-7.1** Phase 1 user-configurable settings (minimal):
- `maxDisplayWidth: number` — Serves as both a **global cap** and the **default width** for images with no size annotation. Default: `600`. Applied as `width: Xpx; height: auto` (standard CSS proportional scaling — no issues). Images with an explicit dimension annotation in alt text use that annotation instead, subject to the cap. Set to `0` to disable the constraint entirely.

**FR-7.2** Settings are loaded via `api.loadSettings()` in `onEnable` and saved via `api.saveSettings()` when changed.

**FR-7.3** No settings UI is required for Phase 1 beyond the standard plugin toggle. Settings can be configured via the plugin panel's detail view if the Architect chooses.

---

## Architecture Decisions (Resolved)

These decisions were confirmed during requirements analysis and must be honored during architecture.

**AD-1: `convertFileSrc` exposure** — `convertFileSrc` is a pure synchronous JS function from `@tauri-apps/api/core`. It requires no Rust round-trip. It is exposed as `window.__MARKABLE_CONVERT_FILE_SRC__` in `main.ts` using the pattern:
```
(window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"] = convertFileSrc;
```
This matches the existing pattern for `__MARKABLE_EDITOR_VIEW__`, `__TAURI_DIALOG__`, and similar globals.

**AD-2: `__MARKABLE_CURRENT_FILE__` timing** — Confirmed updated synchronously on every tab switch via `_applyActiveTab()` in `tab-manager.ts`. No race conditions on tab switch.

**AD-3: Image scanner** — Uses lezer `syntaxTree(state)` via `window.__CM_LANGUAGE__` (Option A). The `__CM_LANGUAGE__` global already exists in `cm-globals.ts`. Regex scanning is not used.

**AD-4: SVG rendering** — SVG files render as `<img src="asset://...">` (raster mode). No inline SVG DOM injection.

**AD-5: `maxDisplayWidth` semantics** — Acts as both a global width cap and the default width for unsized images. Uses `width: Xpx; height: auto` CSS (proportional scaling).

**AD-6: Core fallback preservation** — A minimal image rendering path stays in `live-preview.ts`. Plugin suppresses it via `window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__` flag while active.

---

## Non-Functional Requirements

**NFR-1: Render Performance** — The `StateField` recomputation (full document scan + widget construction) must complete within 30ms for documents with up to 100 image references. Image loading itself is async (browser network/disk) and does not block the StateField update.

**NFR-2: IIFE Bundle Size** — This plugin bundles no large third-party libraries. The IIFE output (`media-preview.js`) is expected to be under 30 KB. Well within the 500 KB cap.

**NFR-3: IIFE Self-Containment** — All IIFE rules apply: no app-internal module imports at runtime, CM6 accessed via window globals only, CSS injected via `<style>` tag.

**NFR-4: Theme Compatibility** — Image widget containers use CSS variables for border, background, padding, and error state color.

**NFR-5: Accessibility** — All rendered `<img>` elements must carry a non-empty `alt` attribute. When the alt text is empty in the Markdown, use an empty-string `alt=""` (which is valid for decorative images) rather than omitting the attribute.

**NFR-6: No Image Caching Required** — The browser/WebView handles image caching. The plugin does not implement its own cache.

**NFR-7: No Heavy Media Libraries** — No third-party image processing libraries (sharp, jimp, etc.). The plugin uses only native browser `<img>`, `<video>`, and `<audio>` elements.

---

## Out of Scope

The following items from FEATURES.md #7 description ("video, embedded `.md`") are explicitly deferred from this implementation:

1. **Video rendering** — `![](video.mp4)` as a `<video>` element. Deferred to a future phase.
2. **Audio rendering** — `![](audio.mp3)` as an `<audio>` element. Deferred.
3. **Embedded Markdown** — `![](other-note.md)` rendering the content of another `.md` file inline. Deferred (this is a complex transclusion feature, closer to Obsidian embeds).
4. **Iframe embeds** — Rendering `<iframe>` or embedded links (YouTube, etc.) inline. Deferred.
5. **Image insertion UI** — The "insert image" action (Cmd-E, toolbar button) is already handled by the markdown-toolbar plugin and is out of scope for media-preview.
6. **Image alignment/float UI** — The image toolbar (resize, align controls) is already handled by `markdown-toolbar.plugin.ts`. Media-preview owns rendering only.
7. **Export rendering** — Images in exported HTML use a separate rendering path (`marked`); this plugin's decorations are CM6-only and do not affect exports.
8. **Image file management** — Copy-paste image embedding, drag-and-drop file import. Out of scope.
9. **Lazy loading / virtualization** — For very large documents with many images, off-screen images may load eagerly. Virtualization is a future optimization.
10. **AVIF / WebP format-specific handling** — All raster formats supported by the macOS WebView are supported automatically; no format-specific code paths are needed.
11. **Reference-style images** — `![alt][ref]` CommonMark reference-style image syntax is not handled. The scanner only processes inline `![alt](url)` syntax. Reference-style images are rendered as raw text.
12. **Interactive SVG** — SVG files are rendered as raster images via `<img>`. No inline `<svg>` DOM injection, no CSS styling of SVG internals, no interactivity.

---

## Acceptance Criteria

**AC-1** An `![alt](relative/path.png)` image reference renders as a visual `<img>` element when the cursor is not on that line.

**AC-2** Clicking the rendered image moves the cursor into the image source, revealing the raw `![alt](url)` Markdown for editing.

**AC-3** A relative path image (e.g., `![](./screenshot.png)`) loads correctly when the file is in the same directory as the open document.

**AC-4** An `https://` remote image URL loads and renders correctly.

**AC-5** A path to a non-existent file displays the broken-image placeholder (not a blank space or browser error icon), with the failed URL visible on hover.

**AC-6** Disabling the plugin in the Plugins panel removes all image widgets; raw `![alt](url)` syntax is visible throughout the document.

**AC-7** Re-enabling the plugin re-renders all images correctly from a clean state.

**AC-8** A GIF image animates in the widget (no special handling needed — native `<img>` supports animated GIFs).

**AC-9** An image with alt-text dimension annotation `![photo|400x300](img.png)` renders at exactly 400x300 px.

**AC-10** An image with a very long URL containing special characters (spaces, parentheses, Unicode) renders correctly (URL is used as-is; encoding is the author's responsibility per CommonMark).

**AC-11** The `maxDisplayWidth` setting caps the displayed size of images exceeding that width, and also sets the default width for unsized images.

**AC-12** No console errors are thrown during normal operation (typing, cursor movement, image load, image load failure).

**AC-13** `![photo.center](img.png)` produces an `<img>` element with CSS class `center` applied in addition to `cm-media-image`.

**AC-14** `![photo{border:2px solid red}](img.png)` produces an `<img>` element with `border: 2px solid red` in its inline `style` attribute.

**AC-15** When the media-preview plugin is disabled, the core `live-preview.ts` fallback resumes rendering images (basic rendering, no CSS annotations or broken-image placeholder).

---

## Edge Case Inventory

**EC-01: Cursor exactly on the opening `!` character** — Cursor is at the `!` of `![alt](url)`. Expected: raw source is shown (cursor is inside the image range). Widget is not rendered.

**EC-02: Cursor exactly on the closing `)` character** — Cursor is at the closing `)` of `![alt](url)`. Expected: raw source is shown.

**EC-03: Empty URL — `![alt]()`** — The URL is empty. Expected: broken-image placeholder shown when cursor away; raw source shown when cursor inside. No attempt to load a blank URL.

**EC-04: Empty alt text — `![](url)`** — Alt text is empty. Expected: image renders normally with `alt=""`. No dimension parsing attempted.

**EC-05: URL contains spaces — `![](my photo.png)`** — CommonMark does not require space-encoding in image URLs. Expected: URL is passed through as-is to `convertFileSrc` / the `<img src>` attribute. If the browser rejects it, the `onerror` handler fires and the broken-image placeholder appears.

**EC-06: URL contains parentheses — `![](path/to/(file).png)`** — CommonMark has specific rules about balanced parens in link destinations. Expected: the scanner (via lezer AST) correctly captures the full URL including the parentheses. The Architect must verify the lezer parser's behavior for this case.

**EC-07: Relative path with no current file path known** — The plugin attempts to resolve a relative URL but `__MARKABLE_CURRENT_FILE__` is null (new unsaved document). Expected: the relative path cannot be resolved. The plugin should attempt to use the path as-is, which will fail to load. The `onerror` handler fires and the broken-image placeholder appears.

**EC-08: Absolute path outside the allowed scope** — Tauri's `asset://` protocol may be restricted to certain directories based on the capability configuration. A path outside the scope (e.g., `/etc/passwd`) would fail. Expected: `onerror` fires, broken-image placeholder shown.

**EC-09: `file://` URL** — `![](file:///Users/foo/img.png)`. Expected: rejected per FR-3.3. `file://` is treated as a broken URL — broken-image placeholder shown.

**EC-10: `data:` URI** — `![](data:image/png;base64,...)`. Expected: rendered directly as `src` without any `convertFileSrc` conversion. Must work correctly even for very large base64 strings (subject to WebView memory, not the plugin's concern).

**EC-11: GIF image** — Animated GIF file referenced via relative path. Expected: renders and animates normally. No special handling needed.

**EC-12: SVG image** — `.svg` file referenced via relative path. Expected: renders as `<img src="asset://...">` (raster mode). No DOM injection of SVG content.

**EC-13: Image syntax inside a fenced code block** — ` ```\n![alt](url)\n``` `. Expected: no image widget. Handled automatically by lezer AST (code block nodes do not contain `Image` nodes).

**EC-14: Image syntax inside an inline code span** — `` `![alt](url)` ``. Expected: no image widget. Handled automatically by lezer AST.

**EC-15: Very large image file (10+ MB)** — A multi-megabyte PNG referenced by path. Expected: the `<img>` element begins loading asynchronously. The StateField does not block on image load. The widget is placed immediately; the image paints when the WebView finishes loading it. No plugin-level timeout or size gate.

**EC-16: Very wide image without dimension annotation** — A 4000px-wide image. Expected: constrained to `maxDisplayWidth` (default 600px) with `height: auto`.

**EC-17: Image with only width annotation — `![photo|400](img.png)`** — Expected: `width: 400px; height: auto` applied.

**EC-18: Image on the first line of the document** — No special handling needed. The scanner is position-agnostic.

**EC-19: Two images on the same line** — `![a](a.png) and ![b](b.png)`. Both should render as separate widgets. Cursor inside the first reveals the first's source; cursor inside the second reveals the second's source. Both rendered when cursor is between them.

**EC-20: Image immediately adjacent to other syntax** — `**bold ![img](url) bold**`. Expected: image widget renders inside the bold region. The live-preview bold decoration and the image replace-decoration coexist independently.

**EC-21: Image reference-style links — `![alt][ref]`** — These are out of scope (see Out of Scope item 11). The scanner only handles inline `![alt](url)` syntax. Reference-style images are shown as raw text.

**EC-22: Image inside a blockquote — `> ![alt](url)`** — Expected: image renders normally. The lezer AST includes `Image` nodes inside blockquote contexts.

**EC-23: Plugin disabled mid-document with images loaded** — User disables the plugin while images are displayed. Expected: `api.removeExtensions()` removes all decorations; raw Markdown syntax is visible throughout. No stale `<img>` elements remain in the DOM. Core `live-preview.ts` fallback resumes.

**EC-24: Plugin re-enabled (toggle off, then on)** — Expected: a fresh `StateField` is created; all images in the current document render correctly from a clean state.

**EC-25: Tab switch while images are displayed** — User switches to a different tab. Expected: the StateField recomputes on the new document; images in the new document render; images from the previous document do not bleed through.

**EC-26: Undo of an image insertion** — User types `![alt](url)`, cursor moves away (image renders), then presses Cmd-Z. Expected: undo restores the pre-insertion text; the StateField recomputes and the image widget disappears. No stale widget remains.

**EC-27: Image `src` URL changes while cursor is away** — User is in another part of the document; they switch tabs, edit the image URL, then switch back. Expected: the StateField's `docChanged` trigger recomputes; the new URL is reflected in the widget.

**EC-28: Image path with special filename characters — spaces, parentheses, Unicode, emoji** — `![](café photo (1).png)`. Expected: the scanner captures the full URL including special characters. `__MARKABLE_CONVERT_FILE_SRC__` is called with the raw path string. If the filesystem path is valid, the image loads. If not, `onerror` fires.

**EC-29: Multiple image widgets + cursor movement performance** — Document with 50 images, cursor moving line by line. Expected: StateField recomputes on each selection change within NFR-1 bounds (30ms). No visible lag.

**EC-30: CSS style tag accumulation across toggles** — `onDisable` removes the plugin `<style>` tag. `onEnable` re-injects it. Expected: idempotent injection (guarded by fixed element id). No duplicate `<style>` tags after multiple toggle cycles.

**EC-31: CSS injection via alt text — XSS / script injection attempt** — A malicious alt text like `![x{background:url(javascript:alert(1))}](img.png)` must not execute scripts. Expected: the `{...}` CSS string is applied only via `element.style.cssText` (DOM property), not via `innerHTML` or `setAttribute("style", rawString)`. Browser CSS engines ignore `javascript:` values in `style.cssText`. No script execution. The Architect must verify that `element.style.cssText = userValue` is used, not `element.setAttribute("style", userValue)`.

**EC-32: Incomplete lezer syntax tree on first render** — On the very first render of a newly opened document, `syntaxTree(state)` may return a partial tree if the lezer parser has not finished its incremental parse pass. Expected: the scanner produces a partial or empty `ImageRange` list. The StateField places no decorations (or decorations only for the parsed region). On the next transaction (`docChanged` or `selectionSet`), the tree is complete and all images render. No crash; graceful degradation.

**EC-33: CSS class shorthand with invalid class name characters** — `![photo.my class!](img.png)` — spaces or special characters in the dot-class token. Expected: the annotation parser strips the dot-class token from alt text but does not apply the invalid class name to the DOM. The Architect must decide whether to sanitize (strip invalid characters) or silently discard invalid class tokens.

**EC-34: Both dimension annotation and CSS annotation present** — `![photo.center|400x300{opacity:0.8}](img.png)`. Expected: all three annotations are parsed independently. The `<img>` has `width: 400px; height: 300px`, class `center`, and `style="opacity:0.8"`. The clean alt text is `photo`.

**EC-35: `__MARKABLE_CONVERT_FILE_SRC__` not yet defined when plugin initializes** — The plugin's `onEnable` runs before `main.ts` has assigned the global (race condition during app startup). Expected: `onEnable` should guard with a check; if the global is undefined, log a warning and fall back to passing URLs through unconverted (which will fail for local paths but not crash). This case should not occur in normal flow since plugins load after `main.ts`, but the guard is defensive.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| Media Preview plugin | `src/plugins/media-preview/media-preview.plugin.ts` (new) | IIFE plugin: StateField, ImageWidget, broken-image placeholder, CSS annotation parsing, CSS injection |
| Plugin build registration | `scripts/build-plugins.mjs` | Add `["media-preview", "src/plugins/media-preview/media-preview.plugin.ts"]` to PLUGINS array |
| `convertFileSrc` global exposure | `src/main.ts` | `window.__MARKABLE_CONVERT_FILE_SRC__ = convertFileSrc` (AD-1) |
| Current file path global | Already exists as `window.__MARKABLE_CURRENT_FILE__` | Confirmed synchronous on tab switch — no changes needed |
| `live-preview.ts` core fallback | `src/editor/live-preview.ts` | Keep minimal image fallback; add `__MARKABLE_MEDIA_PREVIEW_ACTIVE__` check to suppress when plugin active (FR-6.2) |
| Plugin settings | Via `api.loadSettings()` / `api.saveSettings()` | `maxDisplayWidth` setting (dual-purpose: cap and default width) |
| Media preview tests | `tests/plugins/media-preview/media-preview.test.ts` (new) | Unit tests for scanner, URL resolution (mocked), broken-image, dimension parsing, CSS annotation parsing (FR-2.4), EC-31 XSS guard, EC-32 incomplete tree |
| `__CM_LANGUAGE__` global (if not already sufficient) | `src/lib/cm-globals.ts` | Confirm `syntaxTree` is accessible from the existing `__CM_LANGUAGE__` global; extend if needed (AD-3) |
