import { invoke } from "@tauri-apps/api/core";
import {
  getCurrentSettings,
  updateSettings,
  applyEditorSettings,
  applyWindowSettings,
  clearRecentFiles,
  DEFAULT_SETTINGS,
} from "../lib/settings";
import {
  resolveDataProtection,
  type DataProtectionSettings,
  type RecoveredNote,
} from "../lib/data-protection";
import type { WindowSizeMode } from "../lib/settings";
import { updateRecentFilesMenu } from "../lib/bridge";
// tabManager is imported so the "Tabs" settings section can call setMode()
// immediately when the user selects a new tab bar style. The import uses the
// singleton from the tabs facade — settings-panel.ts is not a plugin so it is
// permitted to import from the tabs module directly.
import { tabManager } from "../tabs";
import { attachModalKeyboard } from "../lib/modal-keyboard";
import { isSectionJumpLocked, scrollSectionIntoPane, sectionNearestPaneTop } from "../lib/section-jump";
import "./settings-panel.css";

let panelElement: HTMLElement | null = null;
let isOpen = false;
let keyboardDetach: (() => void) | null = null;

const SETTINGS_SECTION_IDS = [
  "window",
  "appearance",
  "editor",
  "data-protection",
  "recent",
  "tabs",
  "list-style",
  "quick-capture",
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** Last section jumped to. Kept for this page session across close and reopen. */
let selectedSection: SettingsSectionId = "window";

function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

function markSettingsNav(sectionId: SettingsSectionId): void {
  if (!panelElement) return;
  panelElement.querySelectorAll<HTMLButtonElement>(".settings-nav-btn").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.dataset.section === sectionId ? "true" : "false");
  });
}

/** Highlight a section and scroll it to the top of the pane. Every section stays in the document. */
function selectSettingsSection(sectionId: string): void {
  if (!isSettingsSectionId(sectionId) || !panelElement) return;
  selectedSection = sectionId;
  markSettingsNav(sectionId);
  const pane = panelElement.querySelector(".settings-nav-pane");
  const section = panelElement.querySelector(`.settings-section[data-section="${sectionId}"]`);
  if (pane instanceof HTMLElement && section instanceof HTMLElement) {
    scrollSectionIntoPane(pane, section);
  }
}

function syncSettingsNavToScroll(): void {
  if (!panelElement || isSectionJumpLocked()) return;
  const pane = panelElement.querySelector(".settings-nav-pane");
  if (!(pane instanceof HTMLElement)) return;
  const sections = Array.from(pane.querySelectorAll<HTMLElement>(".settings-section"));
  const nearest = sectionNearestPaneTop(pane, sections);
  const sectionId = nearest?.dataset.section ?? "";
  if (!isSettingsSectionId(sectionId) || sectionId === selectedSection) return;
  selectedSection = sectionId;
  markSettingsNav(sectionId);
}

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
    <div class="settings-panel settings-panel--nav" role="dialog" aria-label="Settings" tabindex="-1">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
        <button class="settings-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="settings-nav-layout">
        <nav class="settings-nav" role="tablist" aria-label="Settings sections">
          <button type="button" class="settings-nav-btn" role="tab" data-section="window" aria-selected="true">Window &amp; Content</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="appearance" aria-selected="false">Appearance</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="editor" aria-selected="false">Editor</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="data-protection" aria-selected="false">Data Protection</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="recent" aria-selected="false">Recent Files</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="tabs" aria-selected="false">Tabs</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="list-style" aria-selected="false">List Style</button>
          <button type="button" class="settings-nav-btn" role="tab" data-section="quick-capture" aria-selected="false">Quick Capture</button>
        </nav>
        <div class="settings-nav-pane" role="tabpanel">
        <div class="settings-section" data-section="window">
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

        <div class="settings-section" data-section="appearance">
          <label class="settings-label">Appearance</label>
          <div class="settings-row">
            <span class="settings-description">Theme</span>
            <select class="settings-select" id="settings-theme-select"></select>
          </div>
        </div>

        <div class="settings-section" data-section="editor">
          <label class="settings-label">Editor</label>

          <div class="settings-maximize-row">
            <label class="settings-checkbox-label">
              <input type="checkbox" id="settings-spell-check" />
              <span>Spell check</span>
            </label>
          </div>
          <p class="settings-description">Underline misspelled words using the system dictionary.</p>
        </div>

        <div class="settings-section" data-section="data-protection">
          <label class="settings-label">Data Protection</label>
          <div class="settings-row">
            <span class="settings-description">Markdown deletes</span>
            <select class="settings-select" id="settings-data-protection-mode">
              <option value="off">Off — no file protection</option>
              <option value="ask">Ask before deleting files</option>
              <option value="trash">Use local trash bin</option>
            </select>
          </div>
          <div id="settings-data-protection-trash" hidden>
            <div class="settings-row">
              <span class="settings-description">Keep backup copies</span>
              <select class="settings-select" id="settings-data-protection-retention">
                <option value="duration">For a period</option>
                <option value="untilQuit">Until the app quits</option>
                <option value="askOnQuit">Ask when the app quits</option>
              </select>
            </div>
            <div class="settings-row" id="settings-data-protection-period">
              <span class="settings-description">Keep for</span>
              <input type="number" class="settings-input" id="settings-data-protection-amount" min="1" max="8760" />
              <select class="settings-select" id="settings-data-protection-unit">
                <option value="days">days</option>
                <option value="hours">hours</option>
              </select>
            </div>
          </div>
          <p class="settings-description">Off removes the note. Ask shows an Are you sure dialog. Local trash keeps a copy you can restore here.</p>
          <div class="settings-maximize-row">
            <label class="settings-checkbox-label">
              <input type="checkbox" id="settings-data-protection-trash-icon" />
              <span>Show trash icon</span>
            </label>
          </div>
          <p class="settings-description">Puts a trash can in the footer. Click opens the copies in Finder. Command-click or Control-click opens these settings. A closed can means the queue is empty. An open can means notes are waiting.</p>
          <div class="settings-sub-label" style="margin-top: 12px;">Recoverable notes</div>
          <ul class="settings-recovery-list" id="settings-recovery-list"></ul>
          <p class="settings-description" id="settings-recovery-status"></p>
        </div>

        <div class="settings-section" data-section="recent">
          <label class="settings-label">Recent Files</label>
          <p class="settings-description" id="settings-recent-count"></p>
          <button class="btn btn-tertiary" id="settings-clear-recent">
            Clear Recent Files
          </button>
        </div>

        <div class="settings-section" data-section="tabs">
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

        <div class="settings-section" data-section="list-style">
          <label class="settings-label">List Style</label>
          <select class="settings-select" id="settings-list-style">
            <option value="standard">Standard (1. 2. 3.)</option>
            <option value="alphanumeric">Alphanumeric (I. A. 1. a. i.)</option>
            <option value="decimal">Decimal Outline (1. 1.1.)</option>
            <option value="steps">Steps (1. a. -)</option>
          </select>
          <p class="settings-description">Default style for new lists. Existing lists auto-detect their style from markers, or use a <code>&lt;!-- list: style --&gt;</code> comment override.</p>
        </div>

        <div class="settings-section" data-section="quick-capture">
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
  selectSettingsSection(selectedSection);
}

export function toggleSettingsPanel(): void {
  if (isOpen) closeSettingsPanel();
  else openSettingsPanel();
}

export function openSettingsPanel(sectionId?: string): void {
  if (!panelElement) return;
  const target = sectionId ?? selectedSection;
  if (!isOpen) {
    syncPanelToSettings();
    panelElement.classList.remove("hidden");
    panelElement.setAttribute("aria-hidden", "false");
    isOpen = true;
    keyboardDetach = attachModalKeyboard({
      modal: panelElement,
      onClose: closeSettingsPanel,
    });
  }
  selectSettingsSection(target);
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

  panelElement.querySelector(".settings-nav-pane")
    ?.addEventListener("scroll", syncSettingsNavToScroll);

  panelElement.querySelector(".settings-nav")
    ?.addEventListener("click", (event: Event) => {
      const btn = (event.target as HTMLElement).closest(".settings-nav-btn") as HTMLButtonElement | null;
      if (!btn?.dataset.section) return;
      selectSettingsSection(btn.dataset.section);
    });

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

  wireDataProtection();

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

  syncDataProtection(resolveDataProtection(settings.dataProtection));
  void refreshRecoveryList();
  window.dispatchEvent(new CustomEvent("markable-data-protection"));
}

function dataProtectionFromPanel(): DataProtectionSettings {
  const mode = (document.querySelector("#settings-data-protection-mode") as HTMLSelectElement | null)?.value;
  const retention = (document.querySelector("#settings-data-protection-retention") as HTMLSelectElement | null)?.value;
  const unit = (document.querySelector("#settings-data-protection-unit") as HTMLSelectElement | null)?.value;
  const amountRaw = (document.querySelector("#settings-data-protection-amount") as HTMLInputElement | null)?.value;
  const showTrashIcon = (document.querySelector("#settings-data-protection-trash-icon") as HTMLInputElement | null)?.checked === true;
  return resolveDataProtection({
    mode: mode as DataProtectionSettings["mode"],
    retention: retention as DataProtectionSettings["retention"],
    retentionUnit: unit as DataProtectionSettings["retentionUnit"],
    retentionAmount: Number(amountRaw),
    showTrashIcon,
  });
}

function syncDataProtection(protection: DataProtectionSettings): void {
  const mode = document.querySelector("#settings-data-protection-mode") as HTMLSelectElement | null;
  const retention = document.querySelector("#settings-data-protection-retention") as HTMLSelectElement | null;
  const amount = document.querySelector("#settings-data-protection-amount") as HTMLInputElement | null;
  const unit = document.querySelector("#settings-data-protection-unit") as HTMLSelectElement | null;
  const trash = document.querySelector("#settings-data-protection-trash") as HTMLElement | null;
  const period = document.querySelector("#settings-data-protection-period") as HTMLElement | null;
  if (mode) mode.value = protection.mode;
  if (retention) retention.value = protection.retention;
  if (amount) amount.value = String(protection.retentionAmount);
  if (unit) unit.value = protection.retentionUnit;
  if (trash) trash.hidden = protection.mode !== "trash";
  if (period) period.hidden = protection.retention !== "duration";
  const showIcon = document.querySelector("#settings-data-protection-trash-icon") as HTMLInputElement | null;
  if (showIcon) showIcon.checked = protection.showTrashIcon;
}

async function persistDataProtection(): Promise<void> {
  const protection = dataProtectionFromPanel();
  syncDataProtection(protection);
  await updateSettings((s) => ({ ...s, dataProtection: protection }));
  window.dispatchEvent(new CustomEvent("markable-data-protection"));
}

function wireDataProtection(): void {
  for (const id of [
    "settings-data-protection-mode",
    "settings-data-protection-retention",
    "settings-data-protection-unit",
    "settings-data-protection-trash-icon",
  ]) {
    document.querySelector(`#${id}`)?.addEventListener("change", () => {
      void persistDataProtection();
    });
  }
  const amount = document.querySelector("#settings-data-protection-amount") as HTMLInputElement | null;
  amount?.addEventListener("change", () => {
    void persistDataProtection();
  });
  document.querySelector("#settings-recovery-list")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button[data-recovery-id]") as HTMLButtonElement | null;
    if (!button?.dataset.recoveryId) return;
    void restoreRecoveredNote(button.dataset.recoveryId);
  });
}

function recoveryWhen(note: RecoveredNote): string {
  if (note.sessionOnly) return "Kept until the app quits";
  if (note.expiresAtMs) return `Kept until ${new Date(note.expiresAtMs).toLocaleString()}`;
  return "Kept until you restore it";
}

async function refreshRecoveryList(): Promise<void> {
  const list = document.querySelector("#settings-recovery-list");
  const status = document.querySelector("#settings-recovery-status");
  if (!list) return;
  let notes: RecoveredNote[] = [];
  try {
    const value = await invoke<RecoveredNote[]>("list_recovered_notes");
    if (Array.isArray(value)) notes = value;
  } catch {
    notes = [];
  }
  list.replaceChildren();
  if (notes.length === 0) {
    if (status) status.textContent = "No Markdown copies to restore.";
    return;
  }
  if (status) status.textContent = "";
  for (const note of notes) {
    const row = document.createElement("li");
    row.className = "settings-recovery-row";
    const name = document.createElement("span");
    name.className = "settings-recovery-name";
    name.textContent = note.name;
    name.title = note.originalPath;
    const meta = document.createElement("span");
    meta.className = "settings-recovery-meta";
    meta.textContent = recoveryWhen(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-tertiary";
    button.dataset.recoveryId = note.id;
    button.textContent = "Restore";
    row.append(name, meta, button);
    list.append(row);
  }
}

async function restoreRecoveredNote(id: string): Promise<void> {
  const status = document.querySelector("#settings-recovery-status");
  try {
    const restored = await invoke<string>("restore_recovered_note", { id });
    await refreshRecoveryList();
    if (status) status.textContent = `Restored ${restored}`;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : String(error);
  }
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
