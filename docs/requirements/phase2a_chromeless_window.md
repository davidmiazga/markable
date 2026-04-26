# Phase 2A: Chromeless Window & Custom Title Bar

**Status:** Requirements Validated
**Date:** 2026-04-07
**Depends on:** Phase 1 Infrastructure (complete)
**Feature Checkpoint:** 1 — Base Features (item 1: Editing Experience, item 2: Performance)

---

## Executive Summary

Phase 2A transforms the default Tauri window into a chromeless, Typora-style editing environment. The native title bar is removed and replaced with a custom drag region that preserves macOS traffic light buttons (close/minimize/fullscreen). This is the visual foundation for Markable — every subsequent phase builds on this window chrome.

This phase also addresses the "no flash" performance requirement: the window must appear fully styled from the first frame, with no white flash or layout shift.

---

## Functional Requirements

### R1: Remove Native Title Bar

**What must be built:**
- Set `titleBarStyle: "overlay"` in `tauri.conf.json` window config. This removes the native title bar but keeps the macOS traffic light buttons (close/minimize/fullscreen) integrated into the window.
- Do NOT use `decorations: false` — that removes traffic lights entirely and requires reimplementing them manually.

**Acceptance Criteria:**
- Native title bar text ("Markable") is no longer visible.
- macOS traffic light buttons (red/yellow/green) appear in the top-left corner of the window.
- Traffic lights are functional: close, minimize, and fullscreen all work correctly.

---

### R2: Custom Draggable Title Bar Region

**What must be built:**
- Add a `<div>` at the top of the page that acts as a window drag handle.
- Use the CSS property `user-select: none` and Tauri's `data-tauri-drag-region` attribute to make it draggable.
- The drag region should span the full width of the window.
- Height should be ~38px (standard macOS title bar height) to align with traffic light positioning.
- The drag region must be visually minimal — no heavy borders or backgrounds. It should blend with the editor aesthetic.

**Acceptance Criteria:**
- The window can be dragged by clicking and holding anywhere on the title bar region.
- Double-clicking the title bar region triggers macOS zoom (maximize/restore) behavior.
- The drag region does not interfere with clicks on the traffic light buttons.
- The drag region does not interfere with any buttons or interactive elements placed within it.

---

### R3: Document Title Display

**What must be built:**
- Display the current document name (or "Untitled") centered in the title bar region.
- When a file is open, show just the filename (e.g., "notes.md"), not the full path.
- The title should be styled subtly — smaller font, muted color — so it doesn't dominate the interface.
- The title's opacity/visibility should be controllable (prep for future theming where title might be hidden until hover).

**Acceptance Criteria:**
- "Untitled" is shown when no file is open.
- The filename updates when a file is opened or saved-as.
- The title is visually centered in the drag region, accounting for traffic light offset on the left.
- The title does not interfere with drag behavior.

---

### R4: Traffic Light Inset & Content Offset

**What must be built:**
- The traffic light buttons need adequate padding from the window edge. Tauri v2 allows configuring this via `trafficLightPosition` or CSS padding.
- All content below the title bar region must be offset so nothing is hidden behind the traffic lights or title bar.
- The toolbar (Open/Save buttons) moves below the title bar region.

**Acceptance Criteria:**
- Traffic light buttons have standard macOS spacing (~20px from left, ~18px from top).
- No content overlaps with or is hidden behind the traffic light area.
- The toolbar is fully visible and functional below the title bar.
- The editor area fills the remaining vertical space.

---

### R5: No Flash on Launch

**What must be built:**
- The window must not show a white/unstyled frame before content renders.
- Set the window background color in `tauri.conf.json` to match the app's default background.
- Consider using Tauri's `visible: false` + show-after-ready pattern: window starts hidden, becomes visible only after the frontend has rendered.
- The CSS must set `background-color` on `html` and `body` immediately (no waiting for JS).

**Acceptance Criteria:**
- Launching the app shows no white flash or layout shift.
- The window appears fully styled from the first visible frame.
- Works in both light and dark system appearance modes.

---

### R6: Hide-on-Close (macOS Convention)

**What must be built:**
- When the user clicks the red close button, the window should hide (not quit the app).
- The app remains in the dock and can be re-shown by clicking the dock icon.
- This is standard macOS behavior and is configured via Tauri's `closeBehavior` or window event handling.

**Acceptance Criteria:**
- Clicking the red close button hides the window.
- The app remains running (dock icon stays).
- Clicking the dock icon re-shows the window.
- Cmd-Q still fully quits the app.

---

## Non-Functional Requirements

### NF1: Layout Stability
- The title bar region height must be fixed (no layout shift as content loads).
- The flex layout (title bar -> toolbar -> editor) must be stable from the first frame.

### NF2: macOS Native Feel
- Traffic lights must behave identically to native macOS apps (hover states, spacing, fullscreen transition).
- Double-click-to-zoom on title bar must work.

### NF3: Dark Mode Compatibility
- The title bar region and its text must respect `prefers-color-scheme: dark`.
- No jarring color mismatch between the title bar and the editor area in either mode.

---

## Edge Case Inventory

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Double-click title bar | Triggers macOS zoom (maximize/restore). |
| EC-2 | Enter fullscreen via traffic light | Window enters fullscreen; title bar region remains functional. |
| EC-3 | Exit fullscreen | Window returns to windowed mode; traffic lights and drag region work normally. |
| EC-4 | Click traffic light close button | Window hides (does not quit app). |
| EC-5 | Click on button inside title bar region | Button receives the click (drag region does not swallow it). |
| EC-6 | Window launched in dark mode | Title bar and content background match; no white flash. |
| EC-7 | Window launched in light mode | Title bar and content background match; no white flash. |
| EC-8 | System appearance changes while app is running | Title bar adapts to new color scheme. |
| EC-9 | Very long filename open | Title truncates gracefully (ellipsis), does not overflow drag region. |
| EC-10 | Window resized to minimum width | Traffic lights, title, and toolbar remain usable; no overlapping. |

---

## Technical Constraints

### TC-1: Tauri v2 titleBarStyle
- Use `titleBarStyle: "overlay"` (not `decorations: false`). Overlay keeps native traffic lights.

### TC-2: data-tauri-drag-region
- Tauri v2 uses `data-tauri-drag-region` attribute on HTML elements to enable window dragging.

### TC-3: No Rust Changes Expected
- This phase is primarily frontend (HTML/CSS/config). No new Rust commands needed.
- Exception: if hide-on-close requires Rust-side event handling.

---

## Files to Modify

| File | Change |
|---|---|
| `src-tauri/tauri.conf.json` | Add `titleBarStyle`, `hiddenTitle`, background color, visible/show-on-ready |
| `index.html` | Add title bar `<div>` with `data-tauri-drag-region` above toolbar |
| `src/styles.css` | Title bar styles, content offset, flash prevention, dark mode |
| `src/main.ts` | Update title display logic, possibly show-window-on-ready |
| `src-tauri/capabilities/default.json` | May need window permissions for hide-on-close |

---

## Out of Scope

- Theming the title bar (Phase 2F)
- Tabs in the title bar area (Phase 2C)
- Custom traffic light styling or repositioning beyond standard insets
- Settings UI (Phase 2E)

---

## Visual Verification Checklist (for user sign-off)

- [ ] Window has no native title bar — only traffic lights visible
- [ ] Window is draggable via the title bar region
- [ ] Double-click title bar zooms the window
- [ ] Document title ("Untitled" or filename) is visible and centered
- [ ] Traffic light buttons (close/minimize/fullscreen) all work
- [ ] Close button hides window (app stays in dock)
- [ ] No white flash on app launch (light mode)
- [ ] No white flash on app launch (dark mode)
- [ ] Toolbar (Open/Save) is visible and functional below title bar
- [ ] Editor fills remaining space correctly

---

**Next step:** Activate software-architect to produce step files for this phase.
