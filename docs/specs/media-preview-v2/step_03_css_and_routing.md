---
title: "Step 03 — Media Viewer CSS and File Browser Routing"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 03 — Media Viewer CSS and File Browser Routing

## Goal

1. Append media-viewer CSS rules to `src/tabs/tabs.css`.
2. Replace the non-md stub in `file-browser.plugin.ts` with the real
   `openMediaInTab` call.
3. Rebuild and sync the file-browser IIFE plugin so the runtime binary is updated.

After this step, clicking a non-md file in the file browser opens a media tab
in the content area.

---

## Files Changed

| File | Action |
|---|---|
| `src/tabs/tabs.css` | Append media-viewer rules |
| `src/plugins/file-browser/file-browser.plugin.ts` | Replace no-op stub with `openMediaInTab` call |

---

## CSS Changes: `src/tabs/tabs.css`

Append the following block at the end of `tabs.css`:

```css
/* ── Media viewer — VSCode-style content-area preview ─────────────────────── */
/*
 * #media-viewer is a sibling of .cm-editor inside #editor.
 * Default state: hidden. Shown by adding has-media-tab to #editor.
 * The CM6 editor is hidden by the same class toggle.
 *
 * No hardcoded colors — all values use CSS variables from the active theme.
 */

#media-viewer {
  display: none;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: auto;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
  padding: var(--content-padding, 24px);
  box-sizing: border-box;
}

#editor.has-media-tab .cm-editor {
  display: none;
}

#editor.has-media-tab #media-viewer {
  display: flex;
}

#media-viewer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

#media-viewer embed {
  width: 100%;
  height: 100%;
  display: block;
}

.mv-unsupported,
.mv-load-error {
  font-size: 14px;
  color: var(--text-muted);
  font-family: var(--ui-font);
  text-align: center;
}
```

### CSS Design Rationale

- `#media-viewer { display: none; }` is the default — no active class needed on
  initial render, no flicker.
- The `has-media-tab` class on `#editor` acts as a single toggle point. Adding
  and removing the class on `#editor` (not on individual children) ensures the
  two panels are always in sync.
- `flex: 1` on `#media-viewer` means it fills `#editor` identically to `.cm-editor`,
  which also has `flex: 1` from existing CM6 styles.
- `overflow: auto` lets PDFs and large images scroll within the content area.
- `align-items: center; justify-content: center` centers images naturally within
  the available space.
- `padding: var(--content-padding, 24px)` provides breathing room with a sensible
  fallback.

---

## File Browser Routing: `file-browser.plugin.ts`

### Prerequisite

Step_01 left a stub in `buildActivateHandler`:
```typescript
        // Non-md file: will be wired to openMediaInTab in step_03.
        void path;
```

Replace that stub with:
```typescript
        void (window as any).__MARKABLE_TAB_MANAGER__?.openMediaInTab?.(path);
```

### Why optional chaining is correct here

The file browser is an IIFE that loads at plugin enable time. `openMediaInTab`
is added to `TabManager` in step_02, and `main.ts` already assigns
`window.__MARKABLE_TAB_MANAGER__ = tabManager` (line 854). In production the
method is always present. The optional chain (`?.openMediaInTab?.()`) is a
defensive guard for test environments where the global may not be registered
with the new method — it prevents a hard TypeError from blocking other click
handling code.

---

## Plugin Build

After saving `file-browser.plugin.ts`, rebuild and sync:

```bash
npm run build:plugins && npm run sync:plugins
```

This recompiles the IIFE and copies the output to `src-tauri/plugins/core/`.
The TypeScript build of the main app picks up `tabs.css` automatically via the
Vite import in the tab renderer files — no separate CSS build step is needed.

---

## Manual Smoke Test

Start the dev server and open a vault with at least one image file:

```bash
npm run tauri dev
```

1. Click an `.md` file in the file browser → editor tab opens (unchanged behaviour).
2. Click a `.png` or `.jpg` file → a new tab appears in the tab strip; the content
   area shows the image.
3. Click the same image file again → tab activates (does not create a second tab).
4. Click a different image file → a second media tab opens; switching between them
   shows each image without stale content.
5. Click a `.pdf` file → PDF embed renders.
6. Click a file with an unrecognised extension (e.g. `.txt`) → "Cannot preview
   this file type." message shown.
7. Close a media tab → editor tab (or empty state) resumes correctly.
8. Verify the file browser sidebar does NOT show any inline preview panel
   (old `file-browser-media-preview` element must be absent from the DOM).

---

## Checklist

- [ ] `tabs.css`: media-viewer rules appended (all colors use CSS variables)
- [ ] `file-browser.plugin.ts`: stub replaced with `openMediaInTab` call
- [ ] Plugin build runs without errors (`npm run build:plugins && npm run sync:plugins`)
- [ ] Dev server smoke test passes all 8 points above
- [ ] No `fbmp-` or `file-browser-media-preview` elements visible in DevTools DOM
