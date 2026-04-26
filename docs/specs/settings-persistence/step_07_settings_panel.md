# Step 07: Settings Panel UI

**Covers:** R7, NF3
**Edge Cases:** EC-26, EC-27, EC-28
**Depends on:** Steps 02-06 (all settings functionality must work before building the UI)
**Files Created:** `src/settings/settings-panel.ts`, `src/settings/settings-panel.css`
**Files Modified:** `src/main.ts`, `src-tauri/src/lib.rs`, `index.html`

---

## Objective

Build a minimal, clean settings panel (inspired by Whispr Flow). The panel is a modal overlay in the DOM, toggled via `Cmd-,`. It exposes controls for content width, base font size, theme selection, and recent files management. All changes apply immediately.

---

## 1. Panel Design

The settings panel is a **modal overlay** that slides in from the right side of the window, covering approximately 40% of the width (360-420px fixed). It has a semi-transparent backdrop that dismisses the panel when clicked.

**Why not a centered dialog?** A side panel lets the user see the editor behind it, providing live feedback as they adjust content width and font size. This is consistent with the Whispr Flow reference design.

### Layout Structure

```
+-------------------------------------------+
| [Backdrop (semi-transparent)]  | Settings |
|                                | -------- |
|   Editor visible here          | Theme    |
|   (live updates as user        | [v] Dark |
|    adjusts sliders)            |          |
|                                | Content  |
|                                | [===--]  |
|                                | 900px    |
|                                |          |
|                                | Font Size|
|                                | [===--]  |
|                                | 16px     |
|                                |          |
|                                | Recent   |
|                                | [Clear]  |
|                                |          |
|                                | -------- |
|                                | [Reset]  |
+-------------------------------------------+
```

---

## 2. DOM Structure

Add to `index.html` (or inject via JavaScript):

```html
<!-- Settings panel overlay (hidden by default) -->
<div id="settings-overlay" class="settings-overlay hidden" aria-hidden="true">
  <div class="settings-backdrop"></div>
  <div class="settings-panel" role="dialog" aria-label="Settings">
    <div class="settings-header">
      <h2 class="settings-title">Settings</h2>
    </div>
    <div class="settings-body">
      <!-- Sections are injected by settings-panel.ts -->
    </div>
    <div class="settings-footer">
      <button class="settings-btn settings-btn-reset" id="settings-reset-defaults">
        Reset to Defaults
      </button>
    </div>
  </div>
</div>
```

**Recommendation:** Inject the DOM via JavaScript in `settings-panel.ts` to keep `index.html` clean. The `createSettingsPanel()` function builds and appends the overlay to `document.body`.

---

## 3. Settings Panel Component (`src/settings/settings-panel.ts`)

```typescript
import {
  getCurrentSettings,
  updateSettings,
  applyEditorSettings,
  clearRecentFiles,
  EDITOR_CONSTRAINTS,
  DEFAULT_SETTINGS,
} from "../lib/settings";
import "./settings-panel.css";

let panelElement: HTMLElement | null = null;
let isOpen = false;

/**
 * Create and mount the settings panel DOM.
 * Called once during initApp().
 */
export function createSettingsPanel(): void {
  // Build the overlay
  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";
  overlay.className = "settings-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-panel" role="dialog" aria-label="Settings">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
      </div>
      <div class="settings-body">
        ${buildThemeSection()}
        ${buildContentWidthSection()}
        ${buildFontSizeSection()}
        ${buildRecentFilesSection()}
      </div>
      <div class="settings-footer">
        <button class="settings-btn settings-btn-reset" id="settings-reset-defaults">
          Reset to Defaults
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  panelElement = overlay;

  // Wire event listeners
  wireSettingsPanelEvents();
}

/**
 * Toggle the settings panel open/closed.
 * EC-28: If already open, close it. Never stack multiple panels.
 */
export function toggleSettingsPanel(): void {
  if (isOpen) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
}

export function openSettingsPanel(): void {
  if (!panelElement || isOpen) return;

  // Update panel controls to reflect current settings
  syncPanelToSettings();

  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;

  // Focus the panel for keyboard accessibility
  const panel = panelElement.querySelector(".settings-panel") as HTMLElement;
  panel?.focus();
}

export function closeSettingsPanel(): void {
  if (!panelElement || !isOpen) return;

  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
}

export function isSettingsPanelOpen(): boolean {
  return isOpen;
}
```

---

## 4. Section Builders

```typescript
function buildThemeSection(): string {
  return `
    <div class="settings-section">
      <label class="settings-label">Theme</label>
      <div class="settings-theme-options" id="settings-theme-group">
        <button class="settings-theme-btn" data-theme="default-light">Light</button>
        <button class="settings-theme-btn" data-theme="default-dark">Dark</button>
        <button class="settings-theme-btn" data-theme="system">System</button>
      </div>
    </div>
  `;
}

function buildContentWidthSection(): string {
  const c = EDITOR_CONSTRAINTS.contentMaxWidth;
  return `
    <div class="settings-section">
      <label class="settings-label">Content Width</label>
      <div class="settings-slider-row">
        <input type="range" class="settings-slider" id="settings-content-width"
          min="${c.min}" max="${c.max}" step="${c.step}" />
        <span class="settings-value" id="settings-content-width-value"></span>
      </div>
    </div>
  `;
}

function buildFontSizeSection(): string {
  const c = EDITOR_CONSTRAINTS.baseFontSize;
  return `
    <div class="settings-section">
      <label class="settings-label">Font Size</label>
      <div class="settings-slider-row">
        <input type="range" class="settings-slider" id="settings-font-size"
          min="${c.min}" max="${c.max}" step="${c.step}" />
        <span class="settings-value" id="settings-font-size-value"></span>
      </div>
    </div>
  `;
}

function buildRecentFilesSection(): string {
  return `
    <div class="settings-section">
      <label class="settings-label">Recent Files</label>
      <p class="settings-description" id="settings-recent-count"></p>
      <button class="settings-btn settings-btn-secondary" id="settings-clear-recent">
        Clear Recent Files
      </button>
    </div>
  `;
}
```

---

## 5. Event Wiring

```typescript
function wireSettingsPanelEvents(): void {
  if (!panelElement) return;

  // Backdrop click to dismiss (AC-7.7)
  const backdrop = panelElement.querySelector(".settings-backdrop");
  backdrop?.addEventListener("click", closeSettingsPanel);

  // Escape key to dismiss (AC-7.7)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closeSettingsPanel();
    }
  });

  // Theme buttons (AC-7.4)
  const themeGroup = panelElement.querySelector("#settings-theme-group");
  themeGroup?.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest("[data-theme]");
    if (!btn) return;
    const themeName = btn.getAttribute("data-theme");
    if (themeName) {
      // setTheme is imported from main.ts or exposed globally
      await setTheme(themeName);
      syncThemeButtons(themeName);
    }
  });

  // Content width slider (AC-7.2: live update)
  const widthSlider = panelElement.querySelector("#settings-content-width") as HTMLInputElement;
  widthSlider?.addEventListener("input", (e) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    const valueDisplay = panelElement?.querySelector("#settings-content-width-value");
    if (valueDisplay) valueDisplay.textContent = `${value}px`;

    // Live update: change CSS variable immediately
    updateSettingsInMemory((s) => ({
      ...s,
      editor: { ...s.editor, contentMaxWidth: value },
    }));
    applyEditorSettings(getCurrentSettings().editor);
  });

  // Content width: persist on change (mouseup / touchend)
  widthSlider?.addEventListener("change", async () => {
    const value = parseInt(widthSlider.value, 10);
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, contentMaxWidth: value },
    }));
  });

  // Font size slider (AC-7.3: live update)
  const fontSlider = panelElement.querySelector("#settings-font-size") as HTMLInputElement;
  fontSlider?.addEventListener("input", (e) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    const valueDisplay = panelElement?.querySelector("#settings-font-size-value");
    if (valueDisplay) valueDisplay.textContent = `${value}px`;

    // Live update
    updateSettingsInMemory((s) => ({
      ...s,
      editor: { ...s.editor, baseFontSize: value },
    }));
    applyEditorSettings(getCurrentSettings().editor);
  });

  // Font size: persist on change
  fontSlider?.addEventListener("change", async () => {
    const value = parseInt(fontSlider.value, 10);
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, baseFontSize: value },
    }));
  });

  // Clear recent files (AC-7.5)
  const clearBtn = panelElement.querySelector("#settings-clear-recent");
  clearBtn?.addEventListener("click", async () => {
    await clearRecentFiles();
    syncRecentFilesCount();
  });

  // Reset to Defaults (AC-7.6)
  const resetBtn = panelElement.querySelector("#settings-reset-defaults");
  resetBtn?.addEventListener("click", async () => {
    await updateSettings(() => structuredClone(DEFAULT_SETTINGS));
    applyEditorSettings(DEFAULT_SETTINGS.editor);
    await setTheme(DEFAULT_SETTINGS.theme.active);
    syncPanelToSettings();
  });
}
```

---

## 6. Sync Panel State

```typescript
/**
 * Synchronize all panel controls to reflect current settings.
 * Called when the panel opens.
 */
function syncPanelToSettings(): void {
  const settings = getCurrentSettings();

  // Theme buttons
  syncThemeButtons(settings.theme.active);

  // Content width slider
  const widthSlider = document.querySelector("#settings-content-width") as HTMLInputElement;
  if (widthSlider) widthSlider.value = String(settings.editor.contentMaxWidth);
  const widthValue = document.querySelector("#settings-content-width-value");
  if (widthValue) widthValue.textContent = `${settings.editor.contentMaxWidth}px`;

  // Font size slider
  const fontSlider = document.querySelector("#settings-font-size") as HTMLInputElement;
  if (fontSlider) fontSlider.value = String(settings.editor.baseFontSize);
  const fontSize = document.querySelector("#settings-font-size-value");
  if (fontSize) fontSize.textContent = `${settings.editor.baseFontSize}px`;

  // Recent files count
  syncRecentFilesCount();
}

function syncThemeButtons(activeTheme: string): void {
  const buttons = document.querySelectorAll("#settings-theme-group .settings-theme-btn");
  buttons.forEach((btn) => {
    const isActive = btn.getAttribute("data-theme") === activeTheme;
    btn.classList.toggle("active", isActive);
  });
}

function syncRecentFilesCount(): void {
  const count = getCurrentSettings().recentFiles.length;
  const el = document.querySelector("#settings-recent-count");
  if (el) {
    el.textContent = count > 0
      ? `${count} file${count !== 1 ? "s" : ""} in history`
      : "No recent files";
  }
}
```

---

## 7. Cmd-, Integration

In `src/main.ts`:

### Option A: Via Menu Event

The `app-settings` menu item already exists in `menu.rs` with `Cmd-,` accelerator. Wire it:

```rust
// In lib.rs on_menu_event handler, add "app-settings" to the forwarded events:
"app-settings" => {
    let _ = app_handle.emit("menu-event", json!({ "action": "app-settings" }));
}
```

In `main.ts` menu event handler:
```typescript
case "app-settings":
  toggleSettingsPanel();
  break;
```

**Note:** The `app-settings` menu item in `menu.rs` currently has `enabled: false`. Change it to `true`:
```rust
&MenuItem::with_id(handle, "app-settings", "Settings", true, Some("CmdOrCtrl+Comma"))?,
```

---

## 8. CSS Styles (`src/settings/settings-panel.css`)

```css
/* ============================================================
   Settings Panel -- Overlay + Slide-in Panel
   ============================================================ */

.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  transition: opacity 0.2s ease;
}

.settings-overlay.hidden {
  display: none;
}

.settings-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
}

.settings-panel {
  position: relative;
  width: 380px;
  max-width: 90vw;
  height: 100%;
  background: var(--bg-primary);
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
}

/* Header */
.settings-header {
  padding: 24px 24px 0;
  margin-top: var(--titlebar-height); /* Offset for custom title bar */
}

.settings-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary);
}

/* Body */
.settings-body {
  flex: 1;
  padding: 16px 24px;
  overflow-y: auto;
}

/* Section */
.settings-section {
  margin-bottom: 24px;
}

.settings-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.settings-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 8px 0;
}

/* Theme Buttons */
.settings-theme-options {
  display: flex;
  gap: 8px;
}

.settings-theme-btn {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.settings-theme-btn:hover {
  background: var(--code-bg);
}

.settings-theme-btn.active {
  border-color: var(--link-color);
  color: var(--link-color);
  background: rgba(0, 120, 215, 0.08);
}

/* Slider Row */
.settings-slider-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-slider {
  flex: 1;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--border-color);
  outline: none;
}

.settings-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--link-color);
  cursor: pointer;
}

.settings-value {
  min-width: 48px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  font-size: 12px;
}

/* Buttons */
.settings-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.settings-btn:hover {
  background: var(--code-bg);
}

.settings-btn-secondary {
  font-size: 12px;
  padding: 6px 12px;
}

.settings-btn-reset {
  width: 100%;
  color: var(--text-secondary);
}

/* Footer */
.settings-footer {
  padding: 16px 24px 24px;
  border-top: 1px solid var(--border-color);
}
```

---

## 9. Edge Case Coverage

| Edge Case | How Handled |
|-----------|-------------|
| EC-26: Settings panel opened with no file open | All controls work normally. "Recent Files" section shows "No recent files" count. |
| EC-27: User manually edits settings.json while app running | App does not watch the file. Changes take effect on next launch. No special handling needed. |
| EC-28: Cmd-, pressed while panel is already open | `toggleSettingsPanel()` closes it. No stacking. |

---

## 10. Integration in initApp()

```typescript
import { createSettingsPanel, toggleSettingsPanel } from "./settings/settings-panel";

async function initApp() {
  // ... load settings, apply window, apply theme, create editor ...

  // Create settings panel (DOM injection)
  createSettingsPanel();

  // Wire Cmd-, via menu event
  // (handled in menu-event listener: case "app-settings")

  // ... show window ...
}
```

---

## Done Criteria

- [ ] Settings panel opens via `Cmd-,` (AC-7.1)
- [ ] Panel is a slide-in overlay from the right
- [ ] Content width slider adjusts editor layout in real time (AC-7.2)
- [ ] Font size slider adjusts all text in real time (AC-7.3)
- [ ] Theme can be selected from the three options (AC-7.4)
- [ ] "Clear Recent Files" button works (AC-7.5)
- [ ] "Reset to Defaults" restores all settings and updates UI (AC-7.6)
- [ ] Escape key closes the panel (AC-7.7)
- [ ] Clicking backdrop closes the panel (AC-7.7)
- [ ] Panel respects current theme (dark/light) via CSS variables (AC-7.8)
- [ ] `app-settings` menu item enabled in `menu.rs`
- [ ] `app-settings` event forwarded in `lib.rs`
- [ ] Panel syncs controls to current settings when opened
- [ ] No stacking of multiple panels (EC-28)
- [ ] `tsc --noEmit` passes
