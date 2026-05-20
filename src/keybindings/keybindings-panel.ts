import "./keybindings-panel.css";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentSettings, updateSettings } from "../lib/settings";
import { attachModalKeyboard } from "../lib/modal-keyboard";

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}

export const COMMANDS: CommandDef[] = [
  // File
  { id: "file-new",               label: "New",                    defaultKey: "Cmd-N",           section: "File" },
  { id: "file-new-from-template", label: "New from Template",      defaultKey: "Cmd-Shift-N",     section: "File" },
  { id: "file-save-as-template",  label: "Save as Template",       defaultKey: "",                section: "File" },
  // Tab commands — added in step_06.
  // "tab-new" and "file-new" intentionally produce the same behaviour (AD-7):
  // handleAction() redirects both to tabManager.openNewTab(). Keeping two
  // separate COMMANDS entries lets users see and remap both shortcuts
  // independently in the Keybindings panel.
  { id: "tab-new",   label: "New Tab",            defaultKey: "Cmd-T",         section: "File" },
  { id: "tab-close", label: "Close Tab",          defaultKey: "Cmd-W",         section: "File" },
  { id: "tab-prev",  label: "Previous Tab",       defaultKey: "Cmd-Alt-ArrowLeft",  section: "File" },
  { id: "tab-next",  label: "Next Tab",           defaultKey: "Cmd-Alt-ArrowRight", section: "File" },
  // Cmd-1..9: switch to tab by position. Cmd-9 always activates the last tab
  // regardless of how many are open (FR-5.3). These do NOT conflict with
  // "format-ordered-list" (Cmd-Shift-1) because the Shift key differs.
  { id: "tab-1",     label: "Switch to Tab 1",    defaultKey: "Cmd-1",   section: "File" },
  { id: "tab-2",     label: "Switch to Tab 2",    defaultKey: "Cmd-2",   section: "File" },
  { id: "tab-3",     label: "Switch to Tab 3",    defaultKey: "Cmd-3",   section: "File" },
  { id: "tab-4",     label: "Switch to Tab 4",    defaultKey: "Cmd-4",   section: "File" },
  { id: "tab-5",     label: "Switch to Tab 5",    defaultKey: "Cmd-5",   section: "File" },
  { id: "tab-6",     label: "Switch to Tab 6",    defaultKey: "Cmd-6",   section: "File" },
  { id: "tab-7",     label: "Switch to Tab 7",    defaultKey: "Cmd-7",   section: "File" },
  { id: "tab-8",     label: "Switch to Tab 8",    defaultKey: "Cmd-8",   section: "File" },
  // Cmd-9 label says "last tab" to communicate the FR-5.3 special behaviour.
  { id: "tab-9",     label: "Switch to Last Tab", defaultKey: "Cmd-9",   section: "File" },
  { id: "quick-capture",   label: "Quick Capture",          defaultKey: "Ctrl-C",          section: "File" },
  { id: "file-open",       label: "Open",                   defaultKey: "Cmd-O",           section: "File" },
  { id: "file-save",       label: "Save",                   defaultKey: "Cmd-S",           section: "File" },
  { id: "file-save-as",    label: "Save As",                defaultKey: "Cmd-Shift-S",     section: "File" },
  { id: "file-export",     label: "Export...",              defaultKey: "Cmd-Alt-E",       section: "File" },
  { id: "file-import",     label: "Import",                 defaultKey: "Cmd-Alt-Shift-I", section: "File" },
  { id: "file-close-all",  label: "Close All",              defaultKey: "Cmd-Shift-W",     section: "File" },
  // Cmd-P is now reserved for "Open Files" (command-bar-open-files).
  // file-print has no default keybinding and is accessible via the menu or
  // the Commands bar (FR-01.5, AD-CB confirmed decision).
  { id: "file-print",      label: "Print",                  defaultKey: "",                section: "File" },
  // Edit
  { id: "edit-find",           label: "Find",                     defaultKey: "Cmd-F",     section: "Edit" },
  { id: "edit-find-replace",   label: "Find & Replace",           defaultKey: "Cmd-Alt-F", section: "Edit" },
  { id: "edit-paste-plain",    label: "Paste Without Formatting", defaultKey: "Cmd-Alt-V", section: "Edit" },
  { id: "edit-paste-link",     label: "Paste Link",               defaultKey: "Cmd-K",     section: "Edit" },
  { id: "edit-copy-plain",     label: "Copy as Plain Text",       defaultKey: "Cmd-Alt-T", section: "Edit" },
  { id: "edit-copy-html",      label: "Copy as HTML",             defaultKey: "Cmd-Alt-C", section: "Edit" },
  { id: "edit-duplicate-line", label: "Duplicate Line",           defaultKey: "Cmd-D",     section: "Edit" },
  { id: "edit-delete-line",    label: "Delete Line",              defaultKey: "Cmd-Alt-Shift-Backspace", section: "Edit" },
  { id: "edit-select-none",    label: "Select None",             defaultKey: "Cmd-Shift-D",               section: "Edit" },
  { id: "edit-goto-line",      label: "Go to Line",              defaultKey: "Ctrl-G",                    section: "Edit" },
  // FC2 #15: Insert Count — Cmd-Opt-3 (Cmd-Shift-3 is reserved by macOS for screenshots).
  { id: "edit-insert-count",  label: "Insert Count",            defaultKey: "Cmd-Alt-3",                 section: "Edit" },
  // View
  { id: "command-bar-open",             label: "Command Bar",              defaultKey: "Cmd-Shift-P",     section: "View" },
  // Modal command bar mode shortcuts (Step 01 — Modal Command Bar).
  // command-bar-open-files replaces file-print's Cmd-P binding.
  // command-bar-open-keybindings uses the new Cmd-Shift-K chord.
  { id: "command-bar-open-files",       label: "Open Files",               defaultKey: "Cmd-P",           section: "View" },
  { id: "command-bar-open-content",     label: "Search File Contents",     defaultKey: "Cmd-Shift-G",     section: "View" },
  { id: "command-bar-open-keybindings", label: "Open Keybindings",         defaultKey: "Cmd-Shift-K",     section: "View" },
  // Vault Meta System — Tag Browser. No global default key: ⌘5 is already
  // bound to "Switch to Tab 5" (tab-5). The ⌘5 shown in the command bar tab
  // strip is a context-scoped display hint (MODE_TAB_SHORTCUTS), active only
  // while the bar is open, and does not go through the global keybinding router.
  { id: "command-bar-open-tags",        label: "Tag Browser",              defaultKey: "",                section: "View" },
  { id: "app-settings",        label: "Settings",             defaultKey: "Cmd-,",           section: "View" },
  { id: "app-keybindings",     label: "Keyboard Shortcuts",   defaultKey: "Cmd-Alt-Shift-K", section: "View" },
  { id: "app-plugins",         label: "Plugins Panel",        defaultKey: "Cmd-Alt-P",       section: "View" },
  { id: "view-toggle-preview", label: "Toggle Preview", defaultKey: "Cmd-E",  section: "View" },
  { id: "view-zoom-in",        label: "Zoom In",        defaultKey: "Cmd-=",  section: "View" },
  { id: "view-zoom-out",       label: "Zoom Out",       defaultKey: "Cmd--",  section: "View" },
  { id: "view-zoom-reset",     label: "Reset Zoom",     defaultKey: "Cmd-0",  section: "View" },
  { id: "view-toggle-statusbar",  label: "Status Bar",      defaultKey: "",       section: "View" },
  { id: "view-toggle-focus",      label: "Focus Mode",      defaultKey: "",       section: "View" },
  { id: "view-toggle-typewriter", label: "Typewriter Mode", defaultKey: "",       section: "View" },
  { id: "view-toggle-diagrams",   label: "Diagrams",        defaultKey: "",       section: "View" },
  { id: "sidebar.toggleLeft",  label: "Toggle Left Sidebar",  defaultKey: "Cmd-Shift-[", section: "View" },
  { id: "sidebar.toggleRight", label: "Toggle Right Sidebar", defaultKey: "Cmd-Shift-]", section: "View" },
  // PKM Step 02a: File Browser panel toggle — no default key yet; remap via Keyboard Shortcuts.
  { id: "file-browser-toggle", label: "File Browser: Toggle Panel", defaultKey: "", section: "View" },
  // vault-ux step_05: Manage Vaults entry point — no default key; user binds via Keyboard Shortcuts.
  { id: "vault-manage", label: "Manage Vaults", defaultKey: "", section: "View" },
  // Layouts — core capability; always available regardless of plugin state.
  { id: "layouts-open-picker", label: "Open with Layout\u2026", defaultKey: "", section: "View" },
  { id: "apply-view",          label: "Apply View",            defaultKey: "", section: "View" },
  { id: "apply-layout",        label: "Apply Layout",          defaultKey: "", section: "View" },
  // Format
  { id: "format-bold",          label: "Bold",             defaultKey: "Cmd-B",        section: "Format" },
  { id: "format-italic",        label: "Italic",           defaultKey: "Cmd-I",        section: "Format" },
  { id: "format-underline",     label: "Underline",        defaultKey: "Cmd-U",        section: "Format" },
  { id: "format-strikethrough", label: "Strikethrough",    defaultKey: "Cmd-Shift-X",  section: "Format" },
  { id: "format-highlight",     label: "Highlight",        defaultKey: "Cmd-Shift-H",  section: "Format" },
  { id: "format-code-fence",    label: "Code Fence",       defaultKey: "Cmd-Shift-C",  section: "Format" },
  { id: "format-quote",         label: "Callout",          defaultKey: "Cmd-Shift-.",  section: "Format" },
  { id: "format-bullet-list",   label: "Bullet List",      defaultKey: "Cmd-Shift--",  section: "Format" },
  { id: "format-ordered-list",  label: "Ordered List",     defaultKey: "Cmd-Shift-1",  section: "Format" },
  { id: "format-task-list",     label: "Task List",        defaultKey: "Cmd-Shift-;",  section: "Format" },
  { id: "format-superscript",   label: "Superscript",      defaultKey: "Cmd-Shift-6",  section: "Format" },
  { id: "format-subscript",     label: "Subscript",        defaultKey: "Cmd-Shift-9",  section: "Format" },
  { id: "format-hr",            label: "Horizontal Rule",  defaultKey: "Cmd-Shift-R",  section: "Format" },
  { id: "format-indent",        label: "Indent",           defaultKey: "Cmd-]",        section: "Format" },
  { id: "format-outdent",       label: "Outdent",          defaultKey: "Cmd-[",        section: "Format" },
  { id: "format-image",         label: "Insert Image",     defaultKey: "Cmd-Shift-I",  section: "Format" },
  { id: "format-table",         label: "Insert Table",     defaultKey: "Cmd-Shift-T",  section: "Format" },
  { id: "format-front-matter",  label: "Insert Front Matter", defaultKey: "Cmd-Shift-Y", section: "Format" },
  { id: "format-math-inline",   label: "Insert Math",      defaultKey: "Cmd-Shift-M",  section: "Format" },
  { id: "format-math-block",    label: "Insert Math Block", defaultKey: "",            section: "Format" },
  { id: "format-list-style-standard",     label: "List Style: Standard",     defaultKey: "",       section: "Format" },
  { id: "format-list-style-alphanumeric", label: "List Style: Alphanumeric", defaultKey: "Ctrl-R", section: "Format" },
  { id: "format-list-style-decimal",      label: "List Style: Decimal",      defaultKey: "Ctrl-N", section: "Format" },
  { id: "format-list-style-steps",        label: "List Style: Steps",        defaultKey: "Ctrl-L", section: "Format" },
  { id: "format-clear",         label: "Clear Formatting", defaultKey: "Cmd-\\",       section: "Format" },
  { id: "format-comment",       label: "Comment",          defaultKey: "Cmd-Shift-\\", section: "Format" },
  // Theme
  { id: "theme-next",   label: "Next Theme",     defaultKey: "Cmd-Alt-.", section: "Theme" },
  { id: "theme-prev",   label: "Previous Theme", defaultKey: "Cmd-Alt-,", section: "Theme" },
  { id: "theme-light",  label: "Light Theme",    defaultKey: "",          section: "Theme" },
  { id: "theme-dark",   label: "Dark Theme",     defaultKey: "",          section: "Theme" },
  { id: "theme-system", label: "System Theme",   defaultKey: "",          section: "Theme" },
  // Help
  { id: "help-quickstart", label: "Quickstart",          defaultKey: "", section: "Help" },
  { id: "help-help",       label: "Help",                defaultKey: "", section: "Help" },
  { id: "help-cheatsheet", label: "Markdown Cheatsheet", defaultKey: "", section: "Help" },
];

const SECTIONS = ["File", "Edit", "View", "Format", "Theme", "Help"];

// ---------------------------------------------------------------------------
// Key formatting / matching helpers
// ---------------------------------------------------------------------------

function formatKeyForDisplay(key: string): string {
  return key.split("-").map((part) => {
    switch (part) {
      case "Cmd":   return "⌘";
      case "Shift": return "⇧";
      case "Alt":   return "⌥";
      case "Ctrl":  return "⌃";
      default:      return part;
    }
  }).join("");
}

function captureKeyFromEvent(e: KeyboardEvent): string | null {
  if (["Meta", "Shift", "Alt", "Control"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey)  parts.push("Cmd");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.ctrlKey)  parts.push("Ctrl");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return parts.join("-");
}

/**
 * Returns true if the KeyboardEvent matches the stored key string
 * (e.g. "Cmd-Shift-O"). Exported for use in main.ts custom dispatch.
 */
/**
 * Resolve which action ID a keyboard event should fire, checking custom
 * bindings first and falling back to each command's defaultKey.
 *
 * Returns the action id string, or null if no command matches.
 * Used by the document keydown handler in main.ts so default bindings fire
 * even when the user has not customized them.
 */
export function resolveAction(
  e: KeyboardEvent,
  custom: Record<string, string>,
): string | null {
  // 1. User-customized binding takes priority.
  for (const [actionId, keyStr] of Object.entries(custom)) {
    if (eventMatchesKey(e, keyStr)) return actionId;
  }
  // 2. Fall back to default binding for any command NOT overridden by the user.
  for (const cmd of COMMANDS) {
    if (cmd.id in custom) continue; // already checked above
    if (eventMatchesKey(e, cmd.defaultKey)) return cmd.id;
  }
  return null;
}

export function eventMatchesKey(e: KeyboardEvent, key: string): boolean {
  const parts = key.split("-");
  const letter = parts[parts.length - 1];
  if (e.metaKey  !== parts.includes("Cmd"))   return false;
  if (e.shiftKey !== parts.includes("Shift")) return false;
  if (e.altKey   !== parts.includes("Alt"))   return false;
  if (e.ctrlKey  !== parts.includes("Ctrl"))  return false;
  const eKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return eKey === letter;
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

interface ConflictRef {
  id: string;
  label: string;
}

function findDuplicates(custom: Record<string, string>): Map<string, string[]> {
  const keyToIds = new Map<string, string[]>();
  for (const cmd of COMMANDS) {
    const activeKey = custom[cmd.id] ?? cmd.defaultKey;
    if (!activeKey) continue; // unbound commands can't conflict
    const ids = keyToIds.get(activeKey) ?? [];
    ids.push(cmd.id);
    keyToIds.set(activeKey, ids);
  }
  const dupes = new Map<string, string[]>();
  for (const [key, ids] of keyToIds) {
    if (ids.length > 1) dupes.set(key, ids);
  }
  return dupes;
}

// ---------------------------------------------------------------------------
// Search / filter state
// ---------------------------------------------------------------------------

let filterMode: "name" | "key" = "name";
let filterQuery = "";
let searchInputEl: HTMLInputElement | null = null;
let clearBtnEl: HTMLButtonElement | null = null;

function matchesFilter(cmd: CommandDef, activeKey: string): boolean {
  if (!filterQuery) return true;
  if (filterMode === "name") {
    return cmd.label.toLowerCase().includes(filterQuery.toLowerCase());
  }
  return activeKey === filterQuery;
}

function updateClearVisibility(): void {
  if (!clearBtnEl) return;
  clearBtnEl.classList.toggle("hidden", filterQuery === "");
}

function setFilter(mode: "name" | "key", query: string): void {
  filterMode = mode;
  filterQuery = query;

  if (searchInputEl) {
    searchInputEl.value = mode === "key" && query ? formatKeyForDisplay(query) : query;
    searchInputEl.placeholder = mode === "key" ? "Press a shortcut…" : "Search commands…";
    searchInputEl.classList.toggle("kb-key-mode", mode === "key");
  }

  panelElement?.querySelectorAll<HTMLElement>(".kb-mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  updateClearVisibility();
  if (bodyElement) renderBody(bodyElement);
}

function setupSearchBar(barEl: HTMLElement): void {
  searchInputEl = barEl.querySelector<HTMLInputElement>(".kb-search-input");
  clearBtnEl = barEl.querySelector<HTMLButtonElement>(".kb-search-clear");

  searchInputEl?.addEventListener("input", () => {
    if (filterMode !== "name") return;
    filterQuery = searchInputEl!.value;
    updateClearVisibility();
    if (bodyElement) renderBody(bodyElement);
  });

  searchInputEl?.addEventListener("keydown", (e) => {
    if (filterMode !== "key") return;
    // Let Escape pass through so the panel closes normally
    if (e.key === "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    const key = captureKeyFromEvent(e);
    if (!key) return;
    filterQuery = key;
    searchInputEl!.value = formatKeyForDisplay(key);
    updateClearVisibility();
    if (bodyElement) renderBody(bodyElement);
  });

  barEl.querySelectorAll<HTMLElement>(".kb-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as "name" | "key";
      setFilter(mode, "");
      searchInputEl?.focus();
    });
  });

  clearBtnEl?.addEventListener("click", () => {
    setFilter("name", "");
    searchInputEl?.focus();
  });
}

// ---------------------------------------------------------------------------
// Panel body + row rendering
// ---------------------------------------------------------------------------

let panelElement: HTMLElement | null = null;
let keyboardDetach: (() => void) | null = null;
let bodyElement: HTMLElement | null = null;
let isOpen = false;
let activeRecording: (() => void) | null = null;

function renderBody(bodyEl: HTMLElement): void {
  bodyEl.innerHTML = "";
  const custom = getCurrentSettings().keybindings ?? {};
  const dupes = findDuplicates(custom);

  for (const section of SECTIONS) {
    const sectionCmds = COMMANDS.filter((c) => c.section === section);
    if (sectionCmds.length === 0) continue;

    // Collect rows that pass the current filter before building DOM
    const matchingRows: HTMLElement[] = [];
    for (const cmd of sectionCmds) {
      const activeKey = custom[cmd.id] ?? cmd.defaultKey;
      if (!matchesFilter(cmd, activeKey)) continue;

      const isCustom = cmd.id in custom;
      const dupIds = dupes.get(activeKey) ?? [];
      const conflicts: ConflictRef[] = dupIds
        .filter((id) => id !== cmd.id)
        .map((id) => ({ id, label: COMMANDS.find((c) => c.id === id)?.label ?? id }));
      matchingRows.push(renderRow(cmd, activeKey, isCustom, conflicts));
    }

    if (matchingRows.length === 0) continue;

    const sectionEl = document.createElement("div");
    sectionEl.className = "kb-section";

    const header = document.createElement("div");
    header.className = "settings-label kb-section-header";
    header.textContent = section;
    sectionEl.appendChild(header);

    for (const row of matchingRows) sectionEl.appendChild(row);
    bodyEl.appendChild(sectionEl);
  }

  // Empty state when filter matches nothing
  if (bodyEl.children.length === 0 && filterQuery) {
    const empty = document.createElement("p");
    empty.className = "settings-description kb-empty";
    empty.textContent = filterMode === "name"
      ? `No commands match "${filterQuery}".`
      : `No commands use this shortcut.`;
    bodyEl.appendChild(empty);
  }
}

function renderRow(
  cmd: CommandDef,
  activeKey: string,
  isCustom: boolean,
  conflicts: ConflictRef[]
): HTMLElement {
  const row = document.createElement("div");
  row.className = "kb-row";
  row.dataset.cmdId = cmd.id;

  const labelEl = document.createElement("span");
  labelEl.className = "kb-label";
  labelEl.textContent = cmd.label;
  row.appendChild(labelEl);

  const right = document.createElement("div");
  right.className = "kb-row-right";

  // ⚠ Conflict indicator — click activates Key filter showing all conflicting rows
  if (conflicts.length > 0) {
    const conflictNames = conflicts.map((c) => c.label).join(", ");
    const warn = document.createElement("button");
    warn.className = "kb-conflict-icon";
    warn.title = `Conflicts with: ${conflictNames}. Click to show all.`;
    warn.textContent = "⚠";
    warn.setAttribute("aria-label", `Conflicts with ${conflictNames}`);
    warn.addEventListener("click", () => {
      setFilter("key", activeKey);
      searchInputEl?.focus();
    });
    right.appendChild(warn);
  }

  // Key badge — clicking it starts recording (same as Edit button)
  const badge = document.createElement("kbd");
  badge.className = "kb-badge";
  badge.textContent = formatKeyForDisplay(activeKey);
  badge.title = activeKey ? "Click to reassign" : "Click to assign a shortcut";
  badge.style.cursor = "pointer";
  badge.addEventListener("click", () => startRecording(row, right, cmd, activeKey));
  right.appendChild(badge);

  // ↺ Reset button — only when a custom binding is active
  if (isCustom) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "settings-btn settings-btn-secondary kb-reset-btn";
    resetBtn.title = `Reset to default (${formatKeyForDisplay(cmd.defaultKey)})`;
    resetBtn.textContent = "↺";
    resetBtn.addEventListener("click", () => void resetBinding(cmd));
    right.appendChild(resetBtn);
  }

  // Edit button
  const editBtn = document.createElement("button");
  editBtn.className = "settings-btn settings-btn-secondary kb-edit-btn";
  editBtn.textContent = "Edit";
  editBtn.addEventListener("click", () => startRecording(row, right, cmd, activeKey));
  right.appendChild(editBtn);

  row.appendChild(right);
  return row;
}

// ---------------------------------------------------------------------------
// Key recording
// ---------------------------------------------------------------------------

function startRecording(
  row: HTMLElement,
  right: HTMLElement,
  cmd: CommandDef,
  previousKey: string
): void {
  if (activeRecording) activeRecording();

  let capturedKey: string | null = null;
  row.classList.add("kb-recording");

  right.innerHTML = "";

  const badge = document.createElement("kbd");
  badge.className = "kb-badge kb-recording-placeholder";
  badge.textContent = "Press shortcut…";
  right.appendChild(badge);

  const saveBtn = document.createElement("button");
  saveBtn.className = "settings-btn kb-save-btn";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "settings-btn settings-btn-secondary kb-cancel-btn";
  cancelBtn.textContent = "Cancel";

  const btnGroup = document.createElement("div");
  btnGroup.className = "kb-btn-group";
  btnGroup.appendChild(saveBtn);
  btnGroup.appendChild(cancelBtn);
  right.appendChild(btnGroup);

  const keyHandler = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const key = captureKeyFromEvent(e);
    if (!key) return;
    capturedKey = key;
    badge.textContent = formatKeyForDisplay(key);
    badge.classList.remove("kb-recording-placeholder");
  };

  document.addEventListener("keydown", keyHandler, true);

  const cleanup = () => {
    document.removeEventListener("keydown", keyHandler, true);
    row.classList.remove("kb-recording");
    activeRecording = null;
  };

  cancelBtn.addEventListener("click", () => {
    cleanup();
    if (bodyElement) renderBody(bodyElement);
  });

  saveBtn.addEventListener("click", () => {
    const keyToSave = capturedKey ?? previousKey;
    cleanup();
    void updateSettings((s) => ({
      ...s,
      keybindings: { ...(s.keybindings ?? {}), [cmd.id]: keyToSave },
    })).then(() => {
      if (bodyElement) renderBody(bodyElement);
    });
  });

  activeRecording = () => {
    cleanup();
    if (bodyElement) renderBody(bodyElement);
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

async function resetBinding(cmd: CommandDef): Promise<void> {
  await updateSettings((s) => {
    const kb = { ...(s.keybindings ?? {}) };
    delete kb[cmd.id];
    return { ...s, keybindings: kb };
  });
  if (bodyElement) renderBody(bodyElement);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const DEFAULT_PRESET = "Default";
let presetSelectEl: HTMLSelectElement | null = null;
let presetDeleteBtn: HTMLButtonElement | null = null;

/** Namespace prefix used for keybinding preset files in plugin settings storage. */
function presetNamespace(name: string): string {
  return `keybinding-presets/${name.toLowerCase().replace(/\s+/g, "-")}`;
}

async function loadPresetOptions(): Promise<void> {
  if (!presetSelectEl) return;
  const current = presetSelectEl.value || DEFAULT_PRESET;

  // Always start with Default
  presetSelectEl.innerHTML = `<option value="${DEFAULT_PRESET}">${DEFAULT_PRESET}</option>`;

  try {
    const files = await invoke<string[]>("list_preset_files");
    for (const file of files) {
      const name = file.replace(/\.json$/i, "");
      if (name.toLowerCase() === "default") continue;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      presetSelectEl.appendChild(opt);
    }
  } catch {
    // list_preset_files unavailable — only Default shown
  }

  // Restore previous selection if it still exists
  const exists = Array.from(presetSelectEl.options).some((o) => o.value === current);
  presetSelectEl.value = exists ? current : DEFAULT_PRESET;
  updatePresetDeleteBtn();
}

function updatePresetDeleteBtn(): void {
  if (!presetDeleteBtn || !presetSelectEl) return;
  presetDeleteBtn.disabled = presetSelectEl.value === DEFAULT_PRESET;
}

async function applyPreset(name: string): Promise<void> {
  if (name === DEFAULT_PRESET) {
    // Reset all custom bindings
    await updateSettings((s) => ({ ...s, keybindings: {} }));
  } else {
    try {
      const raw = await invoke<string | null>("read_plugin_settings", {
        namespace: presetNamespace(name),
      });
      const bindings: Record<string, string> = raw ? JSON.parse(raw) : {};
      await updateSettings((s) => ({ ...s, keybindings: bindings }));
    } catch (e) {
      console.error("[KeybindingsPanel] Failed to apply preset:", e);
      return;
    }
  }
  if (bodyElement) renderBody(bodyElement);
}

async function saveCurrentAsPreset(name: string): Promise<void> {
  const bindings = getCurrentSettings().keybindings ?? {};
  await invoke("write_plugin_settings", {
    namespace: presetNamespace(name),
    data: JSON.stringify(bindings),
  });
  await loadPresetOptions();
  if (presetSelectEl) presetSelectEl.value = name;
  updatePresetDeleteBtn();
}

async function deletePreset(name: string): Promise<void> {
  if (name === DEFAULT_PRESET) return;
  // Tombstone: write empty object so the file is overwritten (no delete command)
  await invoke("write_plugin_settings", {
    namespace: presetNamespace(name),
    data: "{}",
  });
  await loadPresetOptions();
}

function setupPresetBar(barEl: HTMLElement): void {
  presetSelectEl = barEl.querySelector<HTMLSelectElement>(".kb-preset-select");
  presetDeleteBtn = barEl.querySelector<HTMLButtonElement>(".kb-preset-delete-btn");

  presetSelectEl?.addEventListener("change", () => {
    updatePresetDeleteBtn();
    if (presetSelectEl) void applyPreset(presetSelectEl.value);
  });

  barEl.querySelector(".kb-preset-save-btn")?.addEventListener("click", () => {
    const name = prompt("Save current shortcuts as preset:\nEnter a name:")?.trim();
    if (!name || name.toLowerCase() === "default") return;
    void saveCurrentAsPreset(name);
  });

  presetDeleteBtn?.addEventListener("click", () => {
    if (!presetSelectEl) return;
    const name = presetSelectEl.value;
    if (name === DEFAULT_PRESET) return;
    if (!confirm(`Delete preset "${name}"?`)) return;
    void deletePreset(name);
  });
}

// ---------------------------------------------------------------------------
// Panel lifecycle
// ---------------------------------------------------------------------------

export function createKeybindingsPanel(): void {
  const overlay = document.createElement("div");
  overlay.id = "keybindings-overlay";
  overlay.className = "settings-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-panel" role="dialog" aria-label="Keyboard Shortcuts" tabindex="-1">
      <div class="settings-header">
        <h2 class="settings-title">Keyboard Shortcuts</h2>
        <button class="settings-close-btn" aria-label="Close">&times;</button>
        <p class="settings-description">Changes take effect immediately. Menu labels update on next launch.</p>
      </div>
      <div class="kb-search-bar">
        <input class="kb-search-input" type="text" placeholder="Search commands…" autocomplete="off" spellcheck="false" />
        <div class="kb-mode-group">
          <button class="kb-mode-btn active" data-mode="name">Name</button>
          <button class="kb-mode-btn"        data-mode="key">Key</button>
        </div>
        <button class="kb-search-clear hidden" title="Clear filter">×</button>
      </div>
      <div class="kb-preset-bar">
        <span class="kb-preset-label">Preset</span>
        <select class="kb-preset-select">
          <option value="Default">Default</option>
        </select>
        <button class="settings-btn settings-btn-secondary kb-preset-save-btn">Save As…</button>
        <button class="settings-btn settings-btn-danger kb-preset-delete-btn" disabled>Delete</button>
      </div>
      <div class="settings-body kb-body"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  panelElement = overlay;
  bodyElement = overlay.querySelector(".kb-body");

  const searchBar = overlay.querySelector<HTMLElement>(".kb-search-bar")!;
  setupSearchBar(searchBar);

  const presetBar = overlay.querySelector<HTMLElement>(".kb-preset-bar")!;
  setupPresetBar(presetBar);

  overlay.querySelector(".settings-backdrop")!.addEventListener("click", closeKeybindingsPanel);
  overlay.querySelector(".settings-close-btn")?.addEventListener("click", closeKeybindingsPanel);
}

export function openKeybindingsPanel(): void {
  if (!panelElement || isOpen) return;
  // Reset filter to clean state on each open
  setFilter("name", "");
  if (bodyElement) renderBody(bodyElement);
  void loadPresetOptions();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
  keyboardDetach = attachModalKeyboard({
    modal: panelElement,
    onClose: closeKeybindingsPanel,
    initialFocus: () => searchInputEl,
  });
}

export function closeKeybindingsPanel(): void {
  if (!panelElement || !isOpen) return;
  if (activeRecording) activeRecording();
  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
  keyboardDetach?.();
  keyboardDetach = null;
}

export function toggleKeybindingsPanel(): void {
  isOpen ? closeKeybindingsPanel() : openKeybindingsPanel();
}
