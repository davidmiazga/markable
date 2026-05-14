/**
 * template-picker.ts — Generic template-selection modal with SVG previews.
 *
 * Exports openTemplatePicker<T>() — a two-panel modal (list left, preview right)
 * that lets the user browse and select from a set of named templates before
 * triggering an action. Used by folder-view creation and layout application.
 *
 * CSS is injected once on first open via a <style id="__tp-styles__"> tag so
 * it is available in the Tauri WebView without a separate CSS file.
 *
 * @module file-browser/template-picker
 */

const OVERLAY_ID  = "__template-picker-overlay__";
const STYLE_ID    = "__tp-styles__";

const PICKER_CSS = `
.tp-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tp-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,.45);
}
.tp-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 760px;
  max-width: 95vw;
  max-height: 85vh;
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-color, rgba(255,255,255,.1));
  border-radius: 10px;
  box-shadow: 0 24px 64px rgba(0,0,0,.5);
  overflow: hidden;
}
.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
  flex-shrink: 0;
}
.tp-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #e0e0e0);
  margin: 0;
}
.tp-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary, #888);
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}
.tp-close:hover { background: var(--bg-hover, rgba(255,255,255,.07)); }
.tp-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.tp-list {
  width: 240px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 8px 0;
  border-right: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.tp-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 9px 14px;
  border-radius: 0;
  color: var(--text-primary, #e0e0e0);
}
.tp-item:hover { background: var(--bg-hover, rgba(255,255,255,.05)); }
.tp-item.tp-item--active {
  background: var(--accent-subtle, rgba(74,158,255,.15));
}
.tp-item-name {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 2px;
}
.tp-item-desc {
  font-size: 11px;
  color: var(--text-secondary, #888);
  line-height: 1.4;
}
.tp-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--bg-secondary, #161616);
  overflow: hidden;
}
.tp-preview-svg {
  max-width: 100%;
  max-height: 280px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,.3);
}
.tp-preview-label {
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-secondary, #888);
}
.tp-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-color, rgba(255,255,255,.08));
  flex-shrink: 0;
}
.tp-btn {
  padding: 6px 18px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.tp-btn--cancel {
  background: var(--bg-hover, rgba(255,255,255,.07));
  color: var(--text-primary, #e0e0e0);
}
.tp-btn--cancel:hover { background: var(--bg-hover, rgba(255,255,255,.12)); }
.tp-btn--create {
  background: var(--accent-color, #4a9eff);
  color: #fff;
}
.tp-btn--create:hover { opacity: .9; }
`;

export interface TemplateDefinition<T = string> {
  id: string;
  name: string;
  description: string;
  previewSvg: string;
  data: T;
}

export interface TemplatePickerOptions<T = string> {
  title: string;
  createLabel?: string;
  templates: TemplateDefinition<T>[];
  onSelect: (template: TemplateDefinition<T>) => void;
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = PICKER_CSS;
  document.head.appendChild(style);
}

function close(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Open the template picker modal.
 *
 * Shows a two-panel dialog: a scrollable list of templates on the left and an
 * SVG preview of the selected template on the right. Calls options.onSelect
 * with the chosen template when the user confirms.
 *
 * Double-open guarded: a second call while the picker is open is a no-op.
 */
export function openTemplatePicker<T>(options: TemplatePickerOptions<T>): void {
  if (document.getElementById(OVERLAY_ID)) return;
  if (!options.templates.length) return;

  injectStyles();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "tp-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "tp-backdrop";
  backdrop.addEventListener("click", close);
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "tp-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", options.title);
  overlay.appendChild(panel);

  // Header
  const header = document.createElement("div");
  header.className = "tp-header";
  const titleEl = document.createElement("h2");
  titleEl.className = "tp-title";
  titleEl.textContent = options.title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement("button");
  closeBtn.className = "tp-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Body: list + preview
  const body = document.createElement("div");
  body.className = "tp-body";
  panel.appendChild(body);

  const list = document.createElement("div");
  list.className = "tp-list";
  body.appendChild(list);

  const previewArea = document.createElement("div");
  previewArea.className = "tp-preview";
  body.appendChild(previewArea);

  // Track selected index
  let selectedIdx = 0;

  function renderPreview(tpl: TemplateDefinition<T>): void {
    previewArea.innerHTML = "";
    const svgWrap = document.createElement("div");
    svgWrap.className = "tp-preview-svg";
    svgWrap.innerHTML = tpl.previewSvg;
    previewArea.appendChild(svgWrap);
    const label = document.createElement("div");
    label.className = "tp-preview-label";
    label.textContent = tpl.name;
    previewArea.appendChild(label);
  }

  function selectItem(idx: number): void {
    selectedIdx = idx;
    list.querySelectorAll<HTMLElement>(".tp-item").forEach((el, i) => {
      el.classList.toggle("tp-item--active", i === idx);
    });
    renderPreview(options.templates[idx]);
  }

  // Build list items
  options.templates.forEach((tpl, i) => {
    const btn = document.createElement("button");
    btn.className = "tp-item";
    const nameEl = document.createElement("div");
    nameEl.className = "tp-item-name";
    nameEl.textContent = tpl.name;
    const descEl = document.createElement("div");
    descEl.className = "tp-item-desc";
    descEl.textContent = tpl.description;
    btn.appendChild(nameEl);
    btn.appendChild(descEl);
    btn.addEventListener("click", () => selectItem(i));
    btn.addEventListener("dblclick", () => { selectItem(i); confirm(); });
    list.appendChild(btn);
  });

  // Footer
  const footer = document.createElement("div");
  footer.className = "tp-footer";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "tp-btn tp-btn--cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", close);
  const createBtn = document.createElement("button");
  createBtn.className = "tp-btn tp-btn--create";
  createBtn.textContent = options.createLabel ?? "Create";
  footer.appendChild(cancelBtn);
  footer.appendChild(createBtn);
  panel.appendChild(footer);

  function confirm(): void {
    const chosen = options.templates[selectedIdx];
    if (!chosen) return;
    close();
    options.onSelect(chosen);
  }

  createBtn.addEventListener("click", confirm);

  // Keyboard navigation
  panel.setAttribute("tabindex", "-1");
  panel.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "Enter") { confirm(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectItem(Math.min(selectedIdx + 1, options.templates.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectItem(Math.max(selectedIdx - 1, 0));
    }
  });

  // Initial state
  selectItem(0);
  document.body.appendChild(overlay);
  // Focus panel for keyboard nav
  requestAnimationFrame(() => panel.focus());
}
