# Markable 2.0 -- Phase 2A: Chromeless Window & Custom Title Bar -- Master Blueprint

**Date:** 2026-04-07
**Status:** Architecture Complete -- Ready for Lead Developer
**Based on:** `docs/requirements/phase2a_chromeless_window.md`
**Depends on:** Phase 1 Infrastructure (complete)

---

## Executive Summary

Phase 2A transforms the default Tauri window into a chromeless, Typora-style editing environment. The native title bar is removed and replaced with a custom HTML drag region that preserves macOS traffic light buttons (close/minimize/fullscreen). The window starts hidden and is shown only after the frontend renders, eliminating white flash on launch. The close button hides the window (standard macOS behavior) rather than quitting the app.

This phase modifies 5 files and adds no new files. It is purely configuration + HTML/CSS + minor TypeScript/Rust changes.

---

## Stack Decision

No new dependencies are introduced in this phase. All work uses existing Tauri v2 APIs and CSS.

| Technology | Usage in Phase 2A |
|---|---|
| **Tauri v2 window config** | `titleBarStyle: "Overlay"`, `hiddenTitle: true`, `visible: false`, `backgroundColor` |
| **data-tauri-drag-region** | HTML attribute on drag region div for native window dragging |
| **@tauri-apps/api/webviewWindow** | `getCurrentWebviewWindow().show()` for show-on-ready pattern |
| **Tauri Rust on_window_event** | `WindowEvent::CloseRequested` + `api.prevent_close()` + `window.hide()` |

---

## High-Level Architecture

### Data Flow

```
App Launch
  |
  v
tauri.conf.json: window starts hidden (visible: false)
  |
  v
Frontend loads: index.html + styles.css render with matching background color
  |
  v
main.ts: initApp() runs, editor mounts, then calls getCurrentWebviewWindow().show()
  |
  v
Window becomes visible -- no flash, fully styled from first frame
  |
  v
User clicks red close button
  |
  v
Rust on_window_event: CloseRequested -> api.prevent_close() + window.hide()
  |
  v
Window hidden, app stays in dock
  |
  v
User clicks dock icon -> macOS sends reactivate -> Rust checks if window hidden -> window.show()
```

### Component Map (Files Modified in Phase 2A)

```
markable-2.0/
  src-tauri/
    tauri.conf.json               [MODIFY] titleBarStyle, hiddenTitle, visible, backgroundColor
    capabilities/default.json     [MODIFY] Add core:window:allow-show, core:window:allow-hide
    src/lib.rs                    [MODIFY] Add on_window_event for hide-on-close + dock reactivation
  index.html                      [MODIFY] Add title bar drag region div
  src/styles.css                  [MODIFY] Title bar styles, content offset, flash prevention, dark mode
  src/main.ts                     [MODIFY] Title display logic, show-on-ready
```

No new files are created in this phase.

---

## API Contracts

### Tauri Window Config (tauri.conf.json)

The `app.windows[0]` object gains these fields:

```json
{
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "visible": false,
  "backgroundColor": [30, 30, 30, 255],
  "trafficLightPosition": { "x": 20, "y": 18 }
}
```

**Field reference (verified against Tauri v2 JSON schema at schema.tauri.app/config/2):**
- `titleBarStyle`: `"Visible"` | `"Transparent"` | `"Overlay"` -- Overlay keeps native traffic lights but removes the title bar chrome
- `hiddenTitle`: boolean -- hides the native window title text on macOS
- `visible`: boolean -- whether window is visible on creation (false = show-on-ready pattern)
- `backgroundColor`: RGBA array `[r, g, b, a]` (0-255) -- prevents white flash by setting native window background
- `trafficLightPosition`: `{ "x": number, "y": number }` -- logical position of traffic light buttons (requires titleBarStyle Overlay + decorations true)

### Frontend Window API

```typescript
// Import
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// Show window after frontend renders
const appWindow = getCurrentWebviewWindow();
await appWindow.show();
```

### Rust Event Handling

```rust
// In lib.rs -- Builder chain
.on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        window.hide().unwrap();
    }
})
```

### Capability Permissions Required

```json
{
  "permissions": [
    "core:window:allow-show",
    "core:window:allow-hide"
  ]
}
```

---

## Edge Case Coverage Matrix

| EC # | Edge Case | Step | Coverage Strategy |
|---|---|---|---|
| EC-1 | Double-click title bar | Step 01 | data-tauri-drag-region handles this natively (macOS zoom) |
| EC-2 | Enter fullscreen via traffic light | Step 01 | titleBarStyle Overlay preserves native traffic light behavior |
| EC-3 | Exit fullscreen | Step 01 | Native behavior preserved by Overlay mode |
| EC-4 | Click traffic light close button | Step 02 | on_window_event intercepts CloseRequested, hides window |
| EC-5 | Click on button inside title bar | Step 01 | Buttons are NOT marked with data-tauri-drag-region; only the container div is |
| EC-6 | Window launched in dark mode | Step 01 | backgroundColor matches dark theme; CSS prefers-color-scheme sets html/body |
| EC-7 | Window launched in light mode | Step 01 | CSS sets light background; visible: false prevents flash |
| EC-8 | System appearance changes while running | Step 01 | CSS media query adapts title bar colors |
| EC-9 | Very long filename | Step 02 | Title text uses text-overflow: ellipsis with max-width |
| EC-10 | Window resized to minimum width | Step 01 | Title bar uses flex layout; traffic lights have fixed offset |

---

## Non-Functional Requirements Traceability

| NFR | Description | Step | Success Criteria |
|---|---|---|---|
| NF1 | Layout Stability | Step 01 | Title bar height fixed at 38px; flex layout stable from first frame |
| NF2 | macOS Native Feel | Step 01, 02 | Traffic lights behave identically to native; double-click zoom works |
| NF3 | Dark Mode Compatibility | Step 01 | prefers-color-scheme media query adapts title bar + body colors |

---

## Implementation Checklist

### Step 01: Window Config and Title Bar HTML/CSS
- [x] Modify `tauri.conf.json`: add titleBarStyle, hiddenTitle, visible, backgroundColor, trafficLightPosition
- [x] Modify `capabilities/default.json`: add core:window:allow-show, core:window:allow-hide
- [x] Modify `index.html`: add title bar drag region div with data-tauri-drag-region above toolbar
- [x] Modify `src/styles.css`: title bar styles, body layout restructure, flash prevention, dark mode
- [ ] Verify: window has no native title bar, traffic lights visible and functional
- [ ] Verify: window is draggable via title bar region
- [ ] Verify: double-click title bar zooms window
- [ ] Verify: no white flash on launch (both light and dark mode)
- [ ] Verify: toolbar and editor are properly offset below title bar

### Step 02: Title Display and Hide-on-Close
- [x] Modify `src/main.ts`: update title display in custom title bar, show-on-ready logic
- [x] Modify `src-tauri/src/lib.rs`: add on_window_event for hide-on-close + dock reactivation
- [ ] Verify: "Untitled" shown when no file open
- [ ] Verify: filename updates when file opened or saved-as
- [ ] Verify: title is centered accounting for traffic light offset
- [ ] Verify: long filenames truncate with ellipsis
- [ ] Verify: close button hides window (app stays in dock)
- [ ] Verify: clicking dock icon re-shows window
- [ ] Verify: Cmd-Q still fully quits the app

### Code Quality
- [ ] No TODO comments in source files
- [ ] All Rust code compiles with `cargo build` (no warnings)
- [ ] All TypeScript code passes `tsc --noEmit` (strict mode)
- [ ] `npm run tauri dev` launches correctly with all changes

---

## Handoff Summary

**Requirements source:** `docs/requirements/phase2a_chromeless_window.md`

**Architecture blueprint:** This file (`docs/specs/phase2a-chromeless-window/00_index.md`)

**Step files created:**
- `docs/specs/phase2a-chromeless-window/step_01_window_config_titlebar.md` -- Tauri config, HTML drag region, CSS styles
- `docs/specs/phase2a-chromeless-window/step_02_title_display_hide_on_close.md` -- Title text logic, show-on-ready, hide-on-close Rust handler

**Next Step:** Activate `@lead-developer`. Start with this `00_index.md` as orientation, then implement `step_01` followed by `step_02`. Verify acceptance criteria at each step before proceeding.

---

**Architecture Complete -- Ready for Implementation**
