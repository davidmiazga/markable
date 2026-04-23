/**
 * settings-fields.ts — Shared settings UI builder functions.
 *
 * Returns DOM elements styled with the global settings-panel.css classes
 * (.settings-row, .settings-field-label, .settings-toggle, .settings-input,
 * .settings-select, .settings-btn, etc.).
 *
 * Import this module into any plugin — Rollup bundles it into the IIFE at
 * build time. No window globals are accessed here; all functions are pure
 * DOM builders.
 */

// ── Toggle row ────────────────────────────────────────────────────────────────

export interface ToggleRowOptions {
  /** Primary label text shown on the left. */
  label: string;
  /** Optional muted description shown below the label. */
  description?: string;
  /** Initial checked state. */
  checked: boolean;
  /** Called whenever the toggle changes. */
  onChange: (checked: boolean) => void;
  /** Optional id applied to the hidden <input> (useful for tests). */
  id?: string;
}

/**
 * Build a settings row with a label (+ optional description) on the left and
 * a pill toggle switch on the right.
 *
 * Uses .settings-row, .settings-field-label, .settings-description,
 * .settings-toggle, .settings-toggle-track, .settings-toggle-thumb —
 * all defined in settings-panel.css.
 */
export function buildToggleRow(opts: ToggleRowOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const labelWrap = document.createElement("div");

  const labelEl = document.createElement("span");
  labelEl.className = "settings-field-label";
  labelEl.textContent = opts.label;
  labelWrap.appendChild(labelEl);

  if (opts.description) {
    const desc = document.createElement("p");
    desc.className = "settings-description";
    desc.textContent = opts.description;
    labelWrap.appendChild(desc);
  }

  const toggle = document.createElement("label");
  toggle.className = "settings-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = opts.checked;
  if (opts.id) input.id = opts.id;
  input.addEventListener("change", () => opts.onChange(input.checked));

  const track = document.createElement("span");
  track.className = "settings-toggle-track";

  const thumb = document.createElement("span");
  thumb.className = "settings-toggle-thumb";

  toggle.appendChild(input);
  toggle.appendChild(track);
  toggle.appendChild(thumb);

  row.appendChild(labelWrap);
  row.appendChild(toggle);
  return row;
}

// ── Select row ────────────────────────────────────────────────────────────────

/**
 * Build a settings row with a label on the left and a themed <select> on the
 * right. Uses .settings-row, .settings-field-label, .settings-select.
 *
 * @param label    Muted label text.
 * @param value    Currently selected value.
 * @param options  Array of [value, display text] pairs.
 * @param onChange Called with the new value on change.
 */
export function buildSelectRow(
  label: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const labelEl = document.createElement("span");
  labelEl.className = "settings-field-label";
  labelEl.textContent = label;

  const select = document.createElement("select");
  select.className = "settings-select";

  for (const [val, text] of options) {
    const opt = document.createElement("option");
    opt.value = val;
    opt.textContent = text;
    opt.selected = value === val;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => onChange(select.value));

  row.appendChild(labelEl);
  row.appendChild(select);
  return row;
}

// ── Text input row ────────────────────────────────────────────────────────────

/**
 * Build a settings row with a label on the left and a text input on the right.
 * Uses .settings-row, .settings-field-label, .settings-input,
 * .settings-input-wide.
 *
 * @param label        Muted label text.
 * @param value        Initial input value.
 * @param placeholder  Placeholder string.
 * @param onBlur       Called with the trimmed value when the input loses focus.
 */
export function buildTextRow(
  label: string,
  value: string,
  placeholder: string,
  onBlur: (value: string) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const labelEl = document.createElement("span");
  labelEl.className = "settings-field-label";
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input settings-input-wide";
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener("blur", () => onBlur(input.value.trim()));

  row.appendChild(labelEl);
  row.appendChild(input);
  return row;
}

// ── Button ────────────────────────────────────────────────────────────────────

/**
 * Build a themed button element.
 *
 * Variants:
 *   "primary"   — filled with --link-color background, white text.
 *   "secondary" — transparent background, --link-color border + text (outline).
 *
 * Both variants have hover, active, focus-visible, and disabled states defined
 * in settings-panel.css via .btn, .btn-primary, .btn-secondary.
 *
 * @param label    Button label text.
 * @param variant  "primary" | "secondary"
 * @param onClick  Click handler.
 */
export function buildButton(
  label: string,
  variant: "primary" | "secondary",
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn btn-${variant}`;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

// ── Number input row ──────────────────────────────────────────────────────────

export interface NumberRowOptions {
  min?: number;
  max?: number;
  step?: number;
  width?: string;
  unit?: string;
}

/**
 * Build a settings row with a label, a number input, and an optional unit
 * suffix. Uses .settings-row, .settings-field-label, .settings-input.
 *
 * @param label    Muted label text.
 * @param value    Initial numeric value.
 * @param opts     min / max / step / width / unit options.
 * @param onCommit Called with the committed (possibly clamped) value on change.
 */
export function buildNumberRow(
  label: string,
  value: number,
  opts: NumberRowOptions,
  onCommit: (value: number) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const labelEl = document.createElement("span");
  labelEl.className = "settings-field-label";
  labelEl.textContent = label;

  const right = document.createElement("div");
  right.style.cssText = "display:flex;align-items:center;gap:6px;";

  const input = document.createElement("input");
  input.type = "number";
  input.className = "settings-input";
  input.value = String(value);
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  if (opts.step !== undefined) input.step = String(opts.step);
  if (opts.width) input.style.width = opts.width;

  input.addEventListener("change", () => onCommit(Number(input.value)));

  right.appendChild(input);

  if (opts.unit) {
    const unit = document.createElement("span");
    unit.className = "settings-field-label";
    unit.textContent = opts.unit;
    right.appendChild(unit);
  }

  row.appendChild(labelEl);
  row.appendChild(right);
  return row;
}
