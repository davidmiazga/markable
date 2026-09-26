/**
 * Sync — first-slice quicknote pack placeholder.
 *
 * Records the name of a user-provided sync service. Does not transfer files.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

const PLUGIN_ID = "sync";
const PANEL_ID = "sync-placeholder";
const CSS_ID = "markable-sync-styles";

interface SyncSettings {
  serviceName: string;
}

const DEFAULT_SETTINGS: SyncSettings = {
  serviceName: "",
};

let _api: MarkablePluginAPI | null = null;
let _settings: SyncSettings = { ...DEFAULT_SETTINGS };
let _container: HTMLElement | null = null;

function parseSettings(raw: Record<string, unknown> | null): SyncSettings {
  if (raw === null || typeof raw.serviceName !== "string") {
    return { ...DEFAULT_SETTINGS };
  }
  return { serviceName: raw.serviceName };
}

function persist(): void {
  void _api?.saveSettings({ serviceName: _settings.serviceName }).catch(() => undefined);
}

function setServiceName(name: string): void {
  _settings = { serviceName: name.trim() };
  persist();
  renderPanel();
}

function injectCSS(): void {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .sync-root {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px;
      font-family: var(--ui-font, system-ui, sans-serif);
      font-size: 12px;
      color: var(--text-color, inherit);
    }
    .sync-status {
      padding: 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 6px;
      background: var(--bg-secondary, #f7f7f7);
    }
    .sync-status-label {
      font-weight: 600;
      margin-bottom: 4px;
    }
    .sync-note {
      color: var(--text-secondary, #666);
      font-style: italic;
    }
    .sync-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sync-form label {
      font-weight: 600;
    }
    .sync-form input {
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: var(--bg-primary, #fff);
      color: inherit;
      font: inherit;
    }
    .sync-form button {
      align-self: flex-start;
      height: 26px;
      padding: 0 10px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: var(--bg-secondary, #f4f4f4);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function renderPanel(): void {
  if (_container === null) return;
  _container.innerHTML = "";

  const named = _settings.serviceName !== "";
  const root = document.createElement("div");
  root.className = "sync-root";

  const status = document.createElement("div");
  status.className = "sync-status";

  const label = document.createElement("div");
  label.className = "sync-status-label";
  label.textContent = named
    ? `Named service: ${_settings.serviceName}`
    : "No sync service named yet";

  const note = document.createElement("div");
  note.className = "sync-note";
  note.textContent =
    "Placeholder only. Markable does not sync files. Name the service you will use (iCloud, Dropbox, a local folder, or your own).";

  status.append(label, note);

  const form = document.createElement("form");
  form.className = "sync-form";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setServiceName(input.value);
  });

  const fieldLabel = document.createElement("label");
  fieldLabel.htmlFor = "sync-service-name";
  fieldLabel.textContent = "Sync service name";

  const input = document.createElement("input");
  input.id = "sync-service-name";
  input.type = "text";
  input.placeholder = "e.g. iCloud, Dropbox";
  input.value = _settings.serviceName;
  input.setAttribute("aria-label", "Sync service name");

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Save";

  form.append(fieldLabel, input, submit);
  root.append(status, form);
  _container.appendChild(root);
}

function renderDetailExtra(container: HTMLElement): void {
  const note = document.createElement("p");
  note.className = "sync-note";
  note.textContent = _settings.serviceName
    ? `Named service: ${_settings.serviceName}. This plugin does not sync yet.`
    : "Open the Sync sidebar panel to name a user-provided sync service. This plugin does not sync yet.";
  container.appendChild(note);
}

export default {
  id: PLUGIN_ID,
  name: "Sync",
  version: "0.1.0",
  description: "Name the sync service you will use",
  detail:
    "QuickNote placeholder: records the name of a user-provided sync service. No files are transferred yet.",
  sidebarPanelId: PANEL_ID,
  renderDetailExtra,

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _api = api;
    injectCSS();
    const stored = await api.loadSettings().catch(() => null);
    _settings = parseSettings(stored);

    api.registerSidebarPanel({
      id: PANEL_ID,
      title: "Sync",
      side: "right",
      defaultWidth: 280,
      render(container: HTMLElement): void {
        _container = container;
        renderPanel();
      },
      destroy(container: HTMLElement): void {
        _container = null;
        container.innerHTML = "";
      },
    });
    api.focusSidebarPanel(PANEL_ID);
  },

  onDisable(api: MarkablePluginAPI): void {
    api.unregisterSidebarPanel(PANEL_ID);
    _api = null;
    _container = null;
    _settings = { ...DEFAULT_SETTINGS };
  },
};
