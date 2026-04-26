# Step 01: Window Config & Title Bar HTML/CSS

**Phase:** 2A -- Chromeless Window
**Covers:** R1 (Remove Native Title Bar), R2 (Custom Draggable Title Bar), R4 (Traffic Light Inset), R5 (No Flash on Launch), NF1, NF2, NF3
**Depends on:** Phase 1 complete

---

## Overview

This step makes four changes:
1. Update `tauri.conf.json` to configure the overlay title bar, hidden window, and background color
2. Update `capabilities/default.json` to add window show/hide permissions
3. Add a draggable title bar div to `index.html`
4. Add title bar CSS, layout restructuring, and flash prevention to `styles.css`

After this step, the window will have no native title bar, traffic lights will be in the correct position, the window will be draggable, and there will be no white flash on launch. The window will NOT yet show itself (it starts hidden) -- that is wired up in Step 02.

---

## Change 1: tauri.conf.json

**File:** `src-tauri/tauri.conf.json`

Replace the current `app.windows` array entry with:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Markable",
  "version": "0.1.0",
  "identifier": "com.markable.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "main",
        "title": "Markable",
        "width": 800,
        "height": 600,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "visible": false,
        "backgroundColor": [30, 30, 30, 255],
        "trafficLightPosition": {
          "x": 20,
          "y": 18
        }
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**What changed in `app.windows[0]`:**

| Field | Value | Rationale |
|---|---|---|
| `titleBarStyle` | `"Overlay"` | Removes native title bar, keeps traffic lights overlaid on content |
| `hiddenTitle` | `true` | Hides the native "Markable" title text (we render our own in HTML) |
| `visible` | `false` | Window starts hidden; frontend calls `show()` after rendering (no flash) |
| `backgroundColor` | `[30, 30, 30, 255]` | Dark background (#1e1e1e) prevents white flash during load. This is the dark mode background. On light mode, the CSS renders white immediately, and since the window is hidden until ready, users never see this native background. |
| `trafficLightPosition` | `{"x": 20, "y": 18}` | Positions traffic lights with standard macOS spacing (20px from left edge, vertically centered in 38px title bar region) |

**Why `backgroundColor` is dark:** The native window background is only visible for the brief moment before CSS loads. Since `visible: false` means the window is hidden until the frontend calls `show()`, this background is actually never seen. We set it to dark as a safety net -- if the show-on-ready logic fails, users see a dark window rather than a white flash. The CSS immediately overrides this with the correct theme-appropriate color.

---

## Change 2: capabilities/default.json

**File:** `src-tauri/capabilities/default.json`

Replace with:

```json
{
  "version": 1,
  "identifier": "default",
  "description": "Capability set for Markable file operations and window management",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save"
  ]
}
```

**Added permissions:**
- `core:window:allow-show` -- Required for `getCurrentWebviewWindow().show()` in the show-on-ready pattern
- `core:window:allow-hide` -- Required for `window.hide()` in the Rust hide-on-close handler
- `core:window:allow-set-focus` -- Required for refocusing the window when re-shown from dock

---

## Change 3: index.html

**File:** `index.html`

Replace the entire file with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Markable</title>
    <link rel="stylesheet" href="/src/styles.css" />
    <script type="module" src="/src/main.ts" defer></script>
  </head>

  <body>
    <!-- Custom title bar: drag region with document title -->
    <div id="titlebar" data-tauri-drag-region>
      <span id="titlebar-title" data-tauri-drag-region>Untitled</span>
    </div>

    <!-- Toolbar with file operations -->
    <div class="toolbar">
      <button id="btn-open" class="btn" title="Open file (Cmd+O)">
        Open
      </button>
      <button id="btn-save" class="btn" title="Save file (Cmd+S)">
        Save
      </button>
      <span id="file-name" class="file-name"></span>
    </div>

    <!-- Main application container -->
    <div id="app">
      <!-- Editor container: CodeMirror will mount here -->
      <div
        id="editor"
        role="textbox"
        aria-label="Markdown editor for Markable"
      ></div>
    </div>
  </body>
</html>
```

**What changed:**
1. Added `<div id="titlebar" data-tauri-drag-region>` above the toolbar. This is the custom drag region that replaces the native title bar.
2. Inside the title bar: `<span id="titlebar-title" data-tauri-drag-region>Untitled</span>` displays the document name. The `data-tauri-drag-region` attribute is also on the span so dragging works on the text itself (Tauri v2 only applies drag behavior to the element with the attribute, not its children).
3. Removed emoji from buttons (cleaner look for chromeless design).

**Important:** The `data-tauri-drag-region` attribute must be on both the `#titlebar` div AND the `#titlebar-title` span. In Tauri v2, this attribute only applies to the element it is directly placed on, not to children. Without it on the span, clicking on the title text would not drag the window.

**Important:** Do NOT put `data-tauri-drag-region` on the toolbar buttons -- they must remain clickable.

---

## Change 4: styles.css

**File:** `src/styles.css`

Replace the entire file with:

```css
/* ============================================================
   Markable 2.0 -- Global Styles
   ============================================================ */

/* --- Design Tokens --- */
:root {
  /* Typography */
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  font-size: 14px;
  line-height: 1.5;

  /* Light mode colors (default) */
  --bg-primary: #ffffff;
  --bg-titlebar: #f6f6f6;
  --bg-toolbar: #f9f9f9;
  --text-primary: #1f1f1f;
  --text-titlebar: #666666;
  --border-color: #e0e0e0;
  --btn-bg: #ffffff;
  --btn-border: #d0d0d0;
  --btn-text: #333333;
  --btn-hover-bg: #f0f0f0;
  --btn-hover-border: #b0b0b0;
  --btn-active-bg: #e0e0e0;
  --gutter-bg: #f5f5f5;
  --gutter-active-bg: #f0f0f0;
  --cursor-color: #1f1f1f;

  /* Layout constants */
  --titlebar-height: 38px;
  --traffic-light-offset: 80px;

  color: var(--text-primary);
  background-color: var(--bg-primary);

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

/* --- Flash Prevention ---
   Set background immediately on html and body so there is
   never a frame of white/wrong color before CSS variables load. */
html {
  background-color: #ffffff;
}

/* --- Full-Viewport Layout --- */
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/* ============================================================
   Custom Title Bar
   ============================================================ */
#titlebar {
  height: var(--titlebar-height);
  min-height: var(--titlebar-height);
  max-height: var(--titlebar-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-titlebar);
  border-bottom: 1px solid var(--border-color);
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
  position: relative;
}

#titlebar-title {
  font-size: 13px;
  color: var(--text-titlebar);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  max-width: calc(100% - var(--traffic-light-offset) - var(--traffic-light-offset));
  text-align: center;
  pointer-events: auto;
}

/* ============================================================
   Toolbar
   ============================================================ */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border-color);
  height: auto;
  flex-shrink: 0;
}

.btn {
  padding: 6px 12px;
  background: var(--btn-bg);
  border: 1px solid var(--btn-border);
  border-radius: 4px;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: var(--btn-text);
  transition: all 0.2s ease;
}

.btn:hover {
  background: var(--btn-hover-bg);
  border-color: var(--btn-hover-border);
}

.btn:active {
  background: var(--btn-active-bg);
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-toolbar);
}

.file-name {
  margin-left: auto;
  font-size: 13px;
  color: var(--text-titlebar);
  font-family: "Menlo", monospace;
}

/* ============================================================
   Main Application Container
   ============================================================ */
#app {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

#editor {
  flex: 1;
  overflow: hidden;
  width: 100%;
}

/* ============================================================
   CodeMirror Theme
   ============================================================ */
.cm-editor {
  height: 100% !important;
}

.cm-gutters {
  background-color: var(--gutter-bg);
  border-right: 1px solid var(--border-color);
}

.cm-activeLineGutter {
  background-color: var(--gutter-active-bg);
}

.cm-cursor {
  border-left-color: var(--cursor-color);
}

/* Markdown syntax highlighting */
.cm-strong {
  font-weight: bold;
}

.cm-em {
  font-style: italic;
}

.cm-heading1,
.cm-heading2,
.cm-heading3,
.cm-heading4,
.cm-heading5,
.cm-heading6 {
  color: #d63384;
  font-weight: bold;
}

.cm-link {
  color: #0066cc;
  text-decoration: underline;
}

.cm-quote {
  color: #6a737d;
  font-style: italic;
}

.cm-atom,
.cm-number {
  color: #005cc5;
}

.cm-string {
  color: #24292e;
}

/* ============================================================
   Dark Mode
   ============================================================ */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1e1e1e;
    --bg-titlebar: #252526;
    --bg-toolbar: #2d2d30;
    --text-primary: #e0e0e0;
    --text-titlebar: #999999;
    --border-color: #3e3e42;
    --btn-bg: #3c3c3c;
    --btn-border: #555555;
    --btn-text: #cccccc;
    --btn-hover-bg: #4a4a4a;
    --btn-hover-border: #666666;
    --btn-active-bg: #555555;
    --gutter-bg: #252526;
    --gutter-active-bg: #2d2d30;
    --cursor-color: #e0e0e0;
  }

  html {
    background-color: #1e1e1e;
  }

  .cm-heading1,
  .cm-heading2,
  .cm-heading3,
  .cm-heading4,
  .cm-heading5,
  .cm-heading6 {
    color: #c586c0;
  }

  .cm-link {
    color: #569cd6;
  }

  .cm-quote {
    color: #858585;
  }

  .cm-atom,
  .cm-number {
    color: #4ec9b0;
  }

  .cm-string {
    color: #ce9178;
  }

  .cm-editor {
    background-color: #1e1e1e;
    color: #e0e0e0;
  }

  .cm-content {
    color: #e0e0e0;
  }

  .cm-line {
    color: #e0e0e0;
  }
}
```

**What changed from Phase 1 styles.css:**

1. **CSS custom properties (variables):** All colors are now CSS variables defined in `:root`. This makes dark mode a simple variable override and prepares for theming in Phase 2F.

2. **Flash prevention:** `html { background-color: #ffffff; }` (and `#1e1e1e` in dark media query) is set as a raw property outside variables so it applies before JS loads. This is a CSS-only guarantee -- no JavaScript required.

3. **Title bar styles:** `#titlebar` is a 38px-tall flex container with `justify-content: center` for the title text. The `--traffic-light-offset` variable (80px) ensures the title text does not overlap with the traffic light buttons.

4. **Body is now the flex container:** Previously `#app` was `height: 100vh`. Now `body` is the flex column container (`body { display: flex; flex-direction: column; height: 100vh; }`), and the layout is: titlebar (38px fixed) -> toolbar (auto) -> #app (flex: 1) -> #editor (flex: 1). This ensures stable layout from the first frame.

5. **Title text truncation:** `#titlebar-title` has `text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: calc(100% - 80px - 80px);` to handle long filenames (EC-9).

6. **Toolbar padding reduced:** Changed from `12px 16px` to `8px 16px` since the title bar now provides visual spacing above.

---

## Acceptance Criteria

| # | Criterion | How to Verify |
|---|---|---|
| AC-1 | No native title bar visible | Run `npm run tauri dev` -- window shows no "Markable" text in native chrome |
| AC-2 | Traffic lights visible and functional | Red/yellow/green buttons appear in top-left; close minimizes, yellow minimizes, green fullscreens |
| AC-3 | Window draggable via title bar | Click and hold on the title bar region; window moves |
| AC-4 | Double-click title bar zooms | Double-click the title bar; window maximizes/restores |
| AC-5 | Title bar shows "Untitled" | The centered text in the title bar reads "Untitled" |
| AC-6 | No white flash on launch (dark mode) | Set system to dark mode; launch app; no white frame visible |
| AC-7 | No white flash on launch (light mode) | Set system to light mode; launch app; no white frame visible |
| AC-8 | Toolbar visible below title bar | Open/Save buttons are fully visible and not overlapping with traffic lights |
| AC-9 | Editor fills remaining space | CodeMirror editor takes all vertical space below toolbar |
| AC-10 | Dark mode title bar matches | In dark mode, title bar background matches editor background theme |

**Note:** The window will start hidden and not show itself until Step 02 wires up the `show()` call. During Step 01 development, temporarily set `"visible": true` in tauri.conf.json for visual verification, then set it back to `false` before completing the step.

---

## Test Requirements

This step is primarily visual/config. No new unit tests are required. Verification is manual:

1. `npm run tauri dev` launches without errors
2. `cargo build` in src-tauri succeeds without warnings
3. `tsc --noEmit` passes
4. Visual verification of all acceptance criteria above

---

## Developer Notes

- **Temporary visible override:** During development of this step, set `"visible": true` in tauri.conf.json to see the window. Remember to set it back to `false` before marking this step complete. Step 02 will add the `show()` call that makes the show-on-ready pattern work.
- **Traffic light position:** The values `x: 20, y: 18` position the traffic lights at standard macOS spacing. If they appear off after testing, adjust `y` to vertically center within the 38px title bar. The formula is: `y = (titlebar_height - traffic_light_height) / 2`. Traffic light buttons are approximately 12px tall, so `y = (38 - 12) / 2 = 13`. However, Tauri's `trafficLightPosition` measures from the top of the button, and standard macOS apps use ~18px from window top, so 18 is the correct value.
- **data-tauri-drag-region caveat:** In Tauri v2, this attribute only works on the element it is applied to, NOT on child elements. This is why both the `#titlebar` div AND the `#titlebar-title` span have the attribute. Without it on both, clicking the title text would not drag the window.
