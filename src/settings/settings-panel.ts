import {
  getCurrentSettings,
  updateSettings,
  applyEditorSettings,
  applyWindowSettings,
  clearRecentFiles,
  DEFAULT_SETTINGS,
} from "../lib/settings";
import type { WindowSizeMode } from "../lib/settings";
import { updateRecentFilesMenu } from "../lib/bridge";
// tabManager is imported so the "Tabs" settings section can call setMode()
// immediately when the user selects a new tab bar style. The import uses the
// singleton from the tabs facade — settings-panel.ts is not a plugin so it is
// permitted to import from the tabs module directly.
import { tabManager } from "../tabs";
import { attachModalKeyboard } from "../lib/modal-keyboard";
import "./settings-panel.css";

let panelElement: HTMLElement | null = null;
let isOpen = false;
let keyboardDetach: (() => void) | null = null;

interface ThemeCallbacks {
  getThemeOrder: () => string[];
  getCurrentTheme: () => string;
  setTheme: (theme: string) => void;
}
let themeCallbacks: ThemeCallbacks | null = null;

export function initAppearanceCallbacks(callbacks: ThemeCallbacks): void {
  themeCallbacks = callbacks;
}

function themeDisplayName(id: string): string {
  if (id === "system") return "System (follows OS)";
  if (id === "default-light") return "Default Light";
  if (id === "default-dark") return "Default Dark";
  if (id.startsWith("custom:")) {
    const stem = id.slice("custom:".length).replace(/\.css$/, "");
    return stem.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return id;
}

export function createSettingsPanel(): void {
  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";
  overlay.className = "settings-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-panel" role="dialog" aria-label="Settings" tabindex="-1">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <button class="settings-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <label class="settings-label">Window &amp; Content</label>

          <div class="settings-maximize-row">
            <label class="settings-checkbox-label">
              <input type="checkbox" id="settings-launch-maximized" />
              <span>Maximize on Launch</span>
            </label>
          </div>

          <div id="settings-size-controls">
            <div class="settings-sub-label">Window Size</div>
            <div class="settings-window-size-row">
              <div class="settings-window-size-field">
                <span class="settings-window-size-label">W</span>
                <select class="settings-select" id="settings-window-w">
                  <option value="50%">50%</option>
                  <option value="65%">65%</option>
                  <option value="80%">80%</option>
                  <option value="100%">100%</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div class="settings-window-size-field">
                <span class="settings-window-size-label">H</span>
                <select class="settings-select" id="settings-window-h">
                  <option value="50%">50%</option>
                  <option value="65%">65%</option>
                  <option value="80%">80%</option>
                  <option value="100%">100%</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
            </div>

            <div class="settings-sub-label" style="margin-top: 12px;">Content-width default</div>
            <div class="settings-content-width-row">
              <input type="text" class="settings-input settings-input-wide" id="settings-content-width-input"
                placeholder="900px" />
              <button class="btn btn-tertiary settings-btn-inline" id="settings-content-width-reset">Reset</button>
            </div>

            <div class="settings-two-col" style="margin-top: 12px;">
              <div class="settings-col">
                <div class="settings-sub-label">Content-width wide</div>
                <div class="settings-slider-row">
                  <input type="range" min="50" max="100" step="5" id="settings-wide-width-slider" />
                  <span class="settings-slider-value" id="settings-wide-width-value">85%</span>
                </div>
              </div>
              <div class="settings-col">
                <div class="settings-sub-label">Content-width full</div>
                <div class="settings-slider-row">
                  <input type="range" min="80" max="100" step="5" id="settings-full-width-slider" />
                  <span class="settings-slider-value" id="settings-full-width-value">100%</span>
                </div>
              </div>
            </div>
          </div>

          <p class="settings-description">Preset sizes apply immediately and center the window. Manual remembers your last size &amp; position. Maximize overrides all.</p>
        </div>

        <div class="settings-section">
          <label class="settings-label">Appearance</label>
          <div class="settings-row">
            <span class="settings-description">Theme</span>
            <select class="settings-select" id="settings-theme-select"></select>
          </div>
        </div>

        <div class="settings-section">
          <label class="settings-label">Editor</label>

          <div class="settings-maximize-row">
            <label class="settings-checkbox-label">
              <input type="checkbox" id="settings-spell-check" />
              <span>Spell check</span>
            </label>
          </div>
          <p class="settings-description">Underline misspelled words using the system dictionary.</p>
        </div>

        <div class="settings-section">
          <label class="settings-label">Recent Files</label>
          <p class="settings-description" id="settings-recent-count"></p>
          <button class="btn btn-tertiary" id="settings-clear-recent">
            Clear Recent Files
          </button>
        </div>

        <div class="settings-section">
          <h3 class="settings-label">Tabs</h3>

          <div class="settings-row">
            <label class="settings-description">Tab bar style</label>
            <div class="settings-segmented" id="tab-mode-control" role="group" aria-label="Tab bar style">
              <button data-mode="minimal">Minimal</button>
              <button data-mode="regular">Regular</button>
              <button data-mode="vertical">Vertical</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <label class="settings-label">List Style</label>
          <select class="settings-select" id="settings-list-style">
            <option value="standard">Standard (1. 2. 3.)</option>
            <option value="alphanumeric">Alphanumeric (I. A. 1. a. i.)</option>
            <option value="decimal">Decimal Outline (1. 1.1.)</option>
            <option value="steps">Steps (1. a. -)</option>
          </select>
          <p class="settings-description">Default style for new lists. Existing lists auto-detect their style from markers, or use a <code>&lt;!-- list: style --&gt;</code> comment override.</p>
        </div>

        <div class="settings-section">
          <label class="settings-label">Quick Capture</label>
          <div class="settings-row">
            <span class="settings-description">Inbox folder (relative to vault root)</span>
            <input type="text" class="settings-input settings-input-wide" id="settings-qc-inbox-folder" placeholder="Inbox" />
          </div>
          <div class="settings-row">
            <span class="settings-description">Path when no vault is open</span>
            <input type="text" class="settings-input settings-input-wide" id="settings-qc-fallback-path" placeholder="~/Documents/Markable Inbox" />
          </div>
          <p class="settings-description">Open with <kbd>⌃C</kbd>. Notes are saved silently to the inbox folder and do not open as tabs.</p>
        </div>
      </div>
      <div class="settings-footer">
        <button class="btn btn-tertiary settings-btn-reset" id="settings-reset-defaults">
          Reset All
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  panelElement = overlay;

  wireEvents();
}

export function toggleSettingsPanel(): void {
  if (isOpen) closeSettingsPanel();
  else openSettingsPanel();
}

export function openSettingsPanel(): void {
  if (!panelElement || isOpen) return;
  syncPanelToSettings();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
  keyboardDetach = attachModalKeyboard({
    modal: panelElement,
    onClose: closeSettingsPanel,
  });
}

export function closeSettingsPanel(): void {
  if (!panelElement || !isOpen) return;
  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
  keyboardDetach?.();
  keyboardDetach = null;
}

export function isSettingsPanelOpen(): boolean {
  return isOpen;
}

/** Parse a content width value like "900px" or "80%" into a CSS string. */
function parseContentWidth(raw: string): string | null {
  const trimmed = raw.trim();
  // Match "900px" or "900"
  const pxMatch = trimmed.match(/^(\d+)\s*(px)?$/);
  if (pxMatch) {
    const val = parseInt(pxMatch[1], 10);
    if (val >= 200 && val <= 4000) return `${val}px`;
    return null;
  }
  // Match "80%"
  const pctMatch = trimmed.match(/^(\d+)\s*%$/);
  if (pctMatch) {
    const val = parseInt(pctMatch[1], 10);
    if (val >= 10 && val <= 100) return `${val}%`;
    return null;
  }
  return null;
}

function applyContentWidth(cssValue: string): void {
  document.documentElement.style.setProperty("--settings-content-max-width", cssValue);
}

function wireEvents(): void {
  if (!panelElement) return;

  panelElement.querySelector(".settings-backdrop")
    ?.addEventListener("click", closeSettingsPanel);
  panelElement.querySelector(".settings-close-btn")
    ?.addEventListener("click", closeSettingsPanel);

  // Theme picker
  const themeSelect = panelElement.querySelector("#settings-theme-select") as HTMLSelectElement;
  themeSelect?.addEventListener("change", () => {
    if (themeCallbacks) themeCallbacks.setTheme(themeSelect.value);
  });

  // Maximize checkbox
  const maxCheck = panelElement.querySelector("#settings-launch-maximized") as HTMLInputElement;
  maxCheck?.addEventListener("change", async () => {
    await updateSettings((s) => ({
      ...s,
      window: { ...s.window, launchMaximized: maxCheck.checked },
    }));
    updateSizeControlsDisabled(maxCheck.checked);
    if (maxCheck.checked) {
      void applyWindowSettings(getCurrentSettings().window);
    }
  });

  // Window size dropdowns — apply immediately
  const wSelect = panelElement.querySelector("#settings-window-w") as HTMLSelectElement;
  const hSelect = panelElement.querySelector("#settings-window-h") as HTMLSelectElement;
  wSelect?.addEventListener("change", async () => {
    await updateSettings((s) => ({
      ...s,
      window: { ...s.window, sizeW: wSelect.value as WindowSizeMode },
    }));
    void applyWindowSettings(getCurrentSettings().window);
  });
  hSelect?.addEventListener("change", async () => {
    await updateSettings((s) => ({
      ...s,
      window: { ...s.window, sizeH: hSelect.value as WindowSizeMode },
    }));
    void applyWindowSettings(getCurrentSettings().window);
  });

  // Content width input — apply on Enter or blur
  const cwInput = panelElement.querySelector("#settings-content-width-input") as HTMLInputElement;
  const applyCW = async () => {
    const parsed = parseContentWidth(cwInput.value);
    if (!parsed) return;
    applyContentWidth(parsed);
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, contentWidth: parsed },
    }));
  };
  cwInput?.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); void applyCW(); }
  });
  cwInput?.addEventListener("blur", () => void applyCW());

  // Content width reset
  panelElement.querySelector("#settings-content-width-reset")
    ?.addEventListener("click", async () => {
      if (cwInput) cwInput.value = "900px";
      applyContentWidth("900px");
      await updateSettings((s) => ({
        ...s,
        editor: { ...s.editor, contentWidth: "900px" },
      }));
    });

  // Wide / Full block width sliders. Each one writes the fraction to a CSS
  // variable immediately on `input` (live preview as the user drags), and
  // persists the integer percentage on `change` (commit on release).
  const wideSlider = panelElement.querySelector("#settings-wide-width-slider") as HTMLInputElement;
  const wideValueEl = panelElement.querySelector("#settings-wide-width-value") as HTMLElement;
  const fullSlider = panelElement.querySelector("#settings-full-width-slider") as HTMLInputElement;
  const fullValueEl = panelElement.querySelector("#settings-full-width-value") as HTMLElement;

  function applyWideFraction(pct: number): void {
    document.documentElement.style.setProperty("--settings-wide-fraction", String(pct / 100));
    if (wideValueEl) wideValueEl.textContent = `${pct}%`;
  }
  function applyFullFraction(pct: number): void {
    document.documentElement.style.setProperty("--settings-full-fraction", String(pct / 100));
    if (fullValueEl) fullValueEl.textContent = `${pct}%`;
  }

  wideSlider?.addEventListener("input", () => applyWideFraction(parseInt(wideSlider.value, 10)));
  wideSlider?.addEventListener("change", async () => {
    const pct = parseInt(wideSlider.value, 10);
    await updateSettings((s) => ({ ...s, editor: { ...s.editor, wideWidthPct: pct } }));
  });
  fullSlider?.addEventListener("input", () => applyFullFraction(parseInt(fullSlider.value, 10)));
  fullSlider?.addEventListener("change", async () => {
    const pct = parseInt(fullSlider.value, 10);
    await updateSettings((s) => ({ ...s, editor: { ...s.editor, fullWidthPct: pct } }));
  });

  // Clear recent files
  panelElement.querySelector("#settings-clear-recent")
    ?.addEventListener("click", async () => {
      await clearRecentFiles();
      await updateRecentFilesMenu([]);
      syncRecentFilesCount();
    });

  // Tab mode segmented control.
  //
  // Each button carries a data-mode attribute (minimal | regular | vertical).
  // A click on the container uses event delegation so no per-button listener
  // is needed. We call tabManager.setMode() which (a) swaps the renderer
  // immediately and (b) persists the new mode via updateSettings internally.
  //
  // EC-18: if TabManager has not yet initialised (renderer is null), setMode()
  // is a no-op on the renderer side — the mode is still persisted and will be
  // applied on the next launch when init() reads it from settings.
  panelElement.querySelector("#tab-mode-control")
    ?.addEventListener("click", (e: Event) => {
      const btn = (e.target as HTMLElement).closest("button[data-mode]") as HTMLButtonElement | null;
      if (!btn) return;

      const mode = btn.dataset.mode as "minimal" | "regular" | "vertical";
      if (!mode) return;

      // Apply the mode immediately through the TabManager singleton
      tabManager.setMode(mode);

      // Sync the active-button visual state in the segmented control
      syncTabModeControl(mode);
    });

  // Spell check checkbox — toggle the CM6 spellCheckCompartment immediately
  // and persist the new value. Follows the same pattern as other boolean
  // settings toggles (e.g. launchMaximized above).
  //
  // The `applyEditorSettings(getCurrentSettings().editor)` call re-reads the
  // freshly updated settings object so the compartment reflects the new value
  // (FR-B.2, AD-07). The Reset-All handler below uses the same mechanism via
  // applyEditorSettings(DEFAULT_SETTINGS.editor) (AD-08).
  const spellCheckInput = panelElement.querySelector(
    "#settings-spell-check"
  ) as HTMLInputElement;
  spellCheckInput?.addEventListener("change", async () => {
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, spellCheck: spellCheckInput.checked },
    }));
    applyEditorSettings(getCurrentSettings().editor);
  });

  // Quick Capture settings
  const qcInboxFolder = panelElement.querySelector("#settings-qc-inbox-folder") as HTMLInputElement;
  const qcFallbackPath = panelElement.querySelector("#settings-qc-fallback-path") as HTMLInputElement;
  qcInboxFolder?.addEventListener("change", async () => {
    const val = qcInboxFolder.value.trim();
    if (!val) return;
    await updateSettings((s) => ({
      ...s,
      quickCapture: { ...s.quickCapture, inboxFolder: val, fallbackPath: s.quickCapture?.fallbackPath ?? "~/Documents/Markable Inbox" },
    }));
  });
  qcFallbackPath?.addEventListener("change", async () => {
    const val = qcFallbackPath.value.trim();
    if (!val) return;
    await updateSettings((s) => ({
      ...s,
      quickCapture: { ...s.quickCapture, inboxFolder: s.quickCapture?.inboxFolder ?? "Inbox", fallbackPath: val },
    }));
  });

  // List style dropdown — persist the selected style immediately so the list
  // engine picks it up on the next Enter/Tab keypress. Follows the same
  // pattern as the window size dropdowns (wSelect/hSelect above).
  const listStyleSelect = panelElement.querySelector("#settings-list-style") as HTMLSelectElement;
  listStyleSelect?.addEventListener("change", async () => {
    await updateSettings((s) => ({
      ...s,
      listStyle: listStyleSelect.value as "standard" | "alphanumeric" | "decimal" | "steps",
    }));
  });

  // Reset to defaults
  panelElement.querySelector("#settings-reset-defaults")
    ?.addEventListener("click", async () => {
      await updateSettings(() => structuredClone(DEFAULT_SETTINGS));
      applyEditorSettings(DEFAULT_SETTINGS.editor);
      applyContentWidth("900px");
      syncPanelToSettings();
    });
}

function updateSizeControlsDisabled(maximized: boolean): void {
  const controls = panelElement?.querySelector("#settings-size-controls") as HTMLElement;
  if (controls) {
    controls.classList.toggle("disabled", maximized);
    controls.querySelectorAll("select, input, button").forEach((el) => {
      (el as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled = maximized;
    });
  }
}

function populateThemeSelect(): void {
  const themeSelect = document.querySelector("#settings-theme-select") as HTMLSelectElement;
  if (!themeSelect || !themeCallbacks) return;
  const current = themeCallbacks.getCurrentTheme();
  const order = themeCallbacks.getThemeOrder();
  themeSelect.innerHTML = "";
  for (const id of order) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = themeDisplayName(id);
    if (id === current) opt.selected = true;
    themeSelect.appendChild(opt);
  }
}

function syncPanelToSettings(): void {
  const settings = getCurrentSettings();

  // Appearance — theme picker
  populateThemeSelect();

  // Maximize
  const maxCheck = document.querySelector("#settings-launch-maximized") as HTMLInputElement;
  if (maxCheck) maxCheck.checked = settings.window.launchMaximized ?? false;
  updateSizeControlsDisabled(settings.window.launchMaximized ?? false);

  // Window size dropdowns
  const wSelect = document.querySelector("#settings-window-w") as HTMLSelectElement;
  const hSelect = document.querySelector("#settings-window-h") as HTMLSelectElement;
  if (wSelect) wSelect.value = settings.window.sizeW ?? "50%";
  if (hSelect) hSelect.value = settings.window.sizeH ?? "50%";

  // Content width — use new contentWidth field, fall back to old contentMaxWidth
  const cwInput = document.querySelector("#settings-content-width-input") as HTMLInputElement;
  if (cwInput) {
    const cw = (settings.editor as any).contentWidth ?? `${settings.editor.contentMaxWidth}px`;
    cwInput.value = cw;
  }

  // Wide / Full block width sliders — sync to current saved fractions.
  const widePct = settings.editor.wideWidthPct ?? 85;
  const fullPct = settings.editor.fullWidthPct ?? 100;
  const wideSliderEl = document.querySelector("#settings-wide-width-slider") as HTMLInputElement | null;
  const wideValueElSync = document.querySelector("#settings-wide-width-value") as HTMLElement | null;
  const fullSliderEl = document.querySelector("#settings-full-width-slider") as HTMLInputElement | null;
  const fullValueElSync = document.querySelector("#settings-full-width-value") as HTMLElement | null;
  if (wideSliderEl) wideSliderEl.value = String(widePct);
  if (wideValueElSync) wideValueElSync.textContent = `${widePct}%`;
  if (fullSliderEl) fullSliderEl.value = String(fullPct);
  if (fullValueElSync) fullValueElSync.textContent = `${fullPct}%`;

  // List style dropdown — defaults to "standard" when the field is absent
  // (EC-13: settings migration from before the Advanced Lists feature).
  const listStyleSelect = document.querySelector("#settings-list-style") as HTMLSelectElement;
  if (listStyleSelect) {
    listStyleSelect.value = settings.listStyle ?? "standard";
  }

  // Tab mode segmented control — reflect the current saved mode
  syncTabModeControl(settings.tabMode ?? "minimal");

  // Spell check checkbox — sync to current settings value.
  // `?? false` guards against old settings files that pre-date this field
  // (EC-B.01, AD-09): missing field → unchecked (off).
  const spellCheckInput = document.querySelector(
    "#settings-spell-check"
  ) as HTMLInputElement;
  if (spellCheckInput) {
    spellCheckInput.checked = settings.editor.spellCheck ?? false;
  }

  syncRecentFilesCount();

  // Quick Capture fields
  const qcInboxFolder = document.querySelector("#settings-qc-inbox-folder") as HTMLInputElement;
  const qcFallbackPath = document.querySelector("#settings-qc-fallback-path") as HTMLInputElement;
  if (qcInboxFolder) qcInboxFolder.value = settings.quickCapture?.inboxFolder ?? "Inbox";
  if (qcFallbackPath) qcFallbackPath.value = settings.quickCapture?.fallbackPath ?? "~/Documents/Markable Inbox";
}

/**
 * Updates which button in the #tab-mode-control segmented control appears
 * active (aria-pressed + a CSS class).
 *
 * Called from syncPanelToSettings() when the panel opens, and from the click
 * handler after the user selects a mode.
 *
 * Using aria-pressed rather than aria-selected because these are independent
 * toggle buttons grouped by role="group", not tabs/options in a listbox.
 *
 * @param mode  The currently active tab mode to highlight.
 */
function syncTabModeControl(mode: "minimal" | "regular" | "vertical"): void {
  const control = document.querySelector("#tab-mode-control");
  if (!control) return;

  control.querySelectorAll("button[data-mode]").forEach((el) => {
    const btn = el as HTMLButtonElement;
    const isActive = btn.dataset.mode === mode;
    // aria-pressed communicates selection state to screen readers for this
    // role="group" pattern (not role="tablist", which uses aria-selected).
    btn.setAttribute("aria-pressed", String(isActive));
    btn.classList.toggle("is-active", isActive);
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
