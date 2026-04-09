import {
  getCurrentSettings,
  updateSettings,
  updateSettingsInMemory,
  applyEditorSettings,
  clearRecentFiles,
  EDITOR_CONSTRAINTS,
  DEFAULT_SETTINGS,
} from "../lib/settings";
import "./settings-panel.css";

let panelElement: HTMLElement | null = null;
let isOpen = false;
let onSetTheme: ((name: string) => void) | null = null;

export function createSettingsPanel(setThemeFn: (name: string) => void): void {
  onSetTheme = setThemeFn;

  const overlay = document.createElement("div");
  overlay.id = "settings-overlay";
  overlay.className = "settings-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  const c = EDITOR_CONSTRAINTS;

  overlay.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-panel" role="dialog" aria-label="Settings" tabindex="-1">
      <div class="settings-header">
        <h2 class="settings-title">Settings</h2>
      </div>
      <div class="settings-body">
        <div class="settings-section">
          <label class="settings-label">Theme</label>
          <div class="settings-theme-options" id="settings-theme-group">
            <button class="settings-theme-btn" data-theme="default-light">Light</button>
            <button class="settings-theme-btn" data-theme="default-dark">Dark</button>
            <button class="settings-theme-btn" data-theme="system">System</button>
          </div>
        </div>
        <div class="settings-section">
          <label class="settings-label">Content Width</label>
          <div class="settings-slider-row">
            <input type="range" class="settings-slider" id="settings-content-width"
              min="${c.contentMaxWidth.min}" max="${c.contentMaxWidth.max}" step="${c.contentMaxWidth.step}" />
            <span class="settings-value" id="settings-content-width-value"></span>
          </div>
        </div>
        <div class="settings-section">
          <label class="settings-label">Font Size</label>
          <div class="settings-slider-row">
            <input type="range" class="settings-slider" id="settings-font-size"
              min="${c.baseFontSize.min}" max="${c.baseFontSize.max}" step="${c.baseFontSize.step}" />
            <span class="settings-value" id="settings-font-size-value"></span>
          </div>
        </div>
        <div class="settings-section">
          <label class="settings-label">Recent Files</label>
          <p class="settings-description" id="settings-recent-count"></p>
          <button class="settings-btn settings-btn-secondary" id="settings-clear-recent">
            Clear Recent Files
          </button>
        </div>
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

  wireEvents();
}

export function toggleSettingsPanel(): void {
  if (isOpen) {
    closeSettingsPanel();
  } else {
    openSettingsPanel();
  }
}

export function openSettingsPanel(): void {
  if (!panelElement || isOpen) return;
  syncPanelToSettings();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
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

function wireEvents(): void {
  if (!panelElement) return;

  panelElement.querySelector(".settings-backdrop")
    ?.addEventListener("click", closeSettingsPanel);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      closeSettingsPanel();
    }
  });

  // Theme buttons
  panelElement.querySelector("#settings-theme-group")
    ?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-theme]");
      if (!btn) return;
      const themeName = btn.getAttribute("data-theme");
      if (themeName && onSetTheme) {
        onSetTheme(themeName);
        syncThemeButtons(themeName);
      }
    });

  // Content width slider — live update on input
  const widthSlider = panelElement.querySelector("#settings-content-width") as HTMLInputElement;
  widthSlider?.addEventListener("input", (e) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    const display = panelElement?.querySelector("#settings-content-width-value");
    if (display) display.textContent = `${value}px`;
    updateSettingsInMemory((s) => ({
      ...s,
      editor: { ...s.editor, contentMaxWidth: value },
    }));
    applyEditorSettings(getCurrentSettings().editor);
  });

  // Content width — persist on release
  widthSlider?.addEventListener("change", async () => {
    const value = parseInt(widthSlider.value, 10);
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, contentMaxWidth: value },
    }));
  });

  // Font size slider — live update on input
  const fontSlider = panelElement.querySelector("#settings-font-size") as HTMLInputElement;
  fontSlider?.addEventListener("input", (e) => {
    const value = parseInt((e.target as HTMLInputElement).value, 10);
    const display = panelElement?.querySelector("#settings-font-size-value");
    if (display) display.textContent = `${value}px`;
    updateSettingsInMemory((s) => ({
      ...s,
      editor: { ...s.editor, baseFontSize: value },
    }));
    applyEditorSettings(getCurrentSettings().editor);
  });

  // Font size — persist on release
  fontSlider?.addEventListener("change", async () => {
    const value = parseInt(fontSlider.value, 10);
    await updateSettings((s) => ({
      ...s,
      editor: { ...s.editor, baseFontSize: value },
    }));
  });

  // Clear recent files
  panelElement.querySelector("#settings-clear-recent")
    ?.addEventListener("click", async () => {
      await clearRecentFiles();
      syncRecentFilesCount();
    });

  // Reset to defaults
  panelElement.querySelector("#settings-reset-defaults")
    ?.addEventListener("click", async () => {
      await updateSettings(() => structuredClone(DEFAULT_SETTINGS));
      applyEditorSettings(DEFAULT_SETTINGS.editor);
      if (onSetTheme) onSetTheme(DEFAULT_SETTINGS.theme.active);
      syncPanelToSettings();
    });
}

function syncPanelToSettings(): void {
  const settings = getCurrentSettings();

  syncThemeButtons(settings.theme.active);

  const widthSlider = document.querySelector("#settings-content-width") as HTMLInputElement;
  if (widthSlider) widthSlider.value = String(settings.editor.contentMaxWidth);
  const widthValue = document.querySelector("#settings-content-width-value");
  if (widthValue) widthValue.textContent = `${settings.editor.contentMaxWidth}px`;

  const fontSlider = document.querySelector("#settings-font-size") as HTMLInputElement;
  if (fontSlider) fontSlider.value = String(settings.editor.baseFontSize);
  const fontValue = document.querySelector("#settings-font-size-value");
  if (fontValue) fontValue.textContent = `${settings.editor.baseFontSize}px`;

  syncRecentFilesCount();
}

function syncThemeButtons(activeTheme: string): void {
  const buttons = document.querySelectorAll("#settings-theme-group .settings-theme-btn");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-theme") === activeTheme);
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
