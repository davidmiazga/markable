---
title: "Command Bar — Step 04: Overlay DOM + CSS"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 04 — Overlay DOM + CSS

## Goal

Build the Command Bar overlay DOM structure and inject the CSS that styles it. The
overlay is created once in `onEnable`, attached to `document.body`, and hidden/shown
by toggling a CSS class. No DOM is recreated on every open — the DOM is rebuilt once
at enable time.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | `buildOverlayDOM()`, `injectCSS()`, `removeCSS()`, `renderResults()` |

---

## DOM Structure

```
#markable-command-bar-overlay              (backdrop div, covers full viewport)
  .cb-panel                                (the floating palette card)
    .cb-input-row
      input.cb-input[type=text]            (search field)
    .cb-results                            (scrollable list container)
      .cb-section-header[data-cat=commands]    "Commands"
      .cb-result[data-id=...][data-cat=commands][aria-selected=false]
        .cb-result-label                   (highlighted label text)
        .cb-result-key                     (keybinding badge, optional)
      .cb-section-header[data-cat=headings]    "Headings"
      .cb-result[data-id=...][data-cat=headings]
        .cb-result-level                   (H1/H2/H3... badge)
        .cb-result-label
      .cb-section-header[data-cat=recent]      "Recent Files"
      .cb-result[data-id=...][data-cat=recent]
        .cb-result-label
        .cb-result-sublabel
      .cb-empty                            (shown only when zero results)
```

All class names are prefixed with `cb-` to avoid collisions with app-level CSS.

---

## ARIA attributes

On the input element:
- `role="combobox"`
- `aria-expanded="true"` (set on open)
- `aria-autocomplete="list"`
- `aria-controls="cb-results-list"` (points to results container)
- `aria-activedescendant=""` (updated on selection change, per NFR-05 / EC-27)

On the results container:
- `id="cb-results-list"`
- `role="listbox"`

On each `.cb-result` element:
- `role="option"`
- `aria-selected="false"` (set to `"true"` for the currently selected item)
- `id="cb-result-{index}"` (so aria-activedescendant can reference it)

The backdrop (`#markable-command-bar-overlay`) does NOT receive focus (NFR-05).

---

## `buildOverlayDOM(): HTMLElement`

```typescript
function buildOverlayDOM(): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "markable-command-bar-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const panel = document.createElement("div");
  panel.className = "cb-panel";

  const inputRow = document.createElement("div");
  inputRow.className = "cb-input-row";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "cb-input";
  input.placeholder = "Type a command or search…";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "cb-results-list");
  input.setAttribute("aria-activedescendant", "");
  inputRow.appendChild(input);

  const resultsList = document.createElement("div");
  resultsList.className = "cb-results";
  resultsList.id = "cb-results-list";
  resultsList.setAttribute("role", "listbox");

  panel.appendChild(inputRow);
  panel.appendChild(resultsList);
  overlay.appendChild(panel);

  return overlay;
}
```

---

## `renderResults(container, results, query, selectedId)`

Clears the results container and rebuilds it from the provided results array. Called:
1. On open (full unfiltered results, no query).
2. On each keypress (filtered + ranked results with query).
3. Implicitly after `selectedId` changes (arrow key navigation calls this).

For performance, the renderer does not diff — it clears and rebuilds on every call.
At ≤300 results this is fast enough (NFR-02: <50ms).

```typescript
function renderResults(
  container: HTMLElement,
  results: CommandBarResult[],
  query: string,
  selectedId: string | null,
): void {
  container.innerHTML = "";

  if (results.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cb-empty";
    empty.textContent = "No results";
    container.appendChild(empty);
    return;
  }

  let lastCategory: ResultCategory | null = null;
  let resultIndex = 0;

  for (const result of results) {
    // Section header (AD-06: only rendered when the category has results)
    if (result.category !== lastCategory) {
      lastCategory = result.category;
      const header = document.createElement("div");
      header.className = "cb-section-header";
      header.setAttribute("data-cat", result.category);
      header.textContent = CATEGORY_LABELS[result.category];
      container.appendChild(header);
    }

    const row = document.createElement("div");
    row.className = "cb-result";
    if (result.dimmed)   row.classList.add("cb-result--dimmed");
    if (result.id === selectedId) {
      row.classList.add("cb-result--selected");
      row.setAttribute("aria-selected", "true");
    } else {
      row.setAttribute("aria-selected", "false");
    }
    row.setAttribute("role", "option");
    row.setAttribute("data-id", result.id);
    row.setAttribute("data-cat", result.category);
    row.id = `cb-result-${resultIndex}`;

    // Label (with highlight if query non-empty)
    const labelEl = document.createElement("div");
    labelEl.className = "cb-result-label";
    if (query && result._matchPositions) {
      labelEl.appendChild(renderHighlightedLabel(result.label, result._matchPositions));
    } else {
      labelEl.textContent = result.label;
    }

    // Heading level badge (Category B)
    if (result.headingLevel !== undefined) {
      const levelBadge = document.createElement("span");
      levelBadge.className = "cb-result-level";
      levelBadge.textContent = `H${result.headingLevel}`;
      row.appendChild(levelBadge);
    }

    row.appendChild(labelEl);

    // Sublabel (Category C)
    if (result.sublabel) {
      const sublabel = document.createElement("div");
      sublabel.className = "cb-result-sublabel";
      sublabel.textContent = result.sublabel;
      row.appendChild(sublabel);
    }

    // Keybinding badge (Category A, EC-25: only if key exists)
    if (result.keybinding) {
      const badge = document.createElement("kbd");
      badge.className = "cb-result-key";
      badge.textContent = result.keybinding;
      row.appendChild(badge);
    }

    // EC-07/EC-08: full label in title attribute for hover tooltip
    row.title = result.label + (result.sublabel ? ` — ${result.sublabel}` : "");

    container.appendChild(row);
    resultIndex++;
  }
}
```

Note: `result._matchPositions` is a transient property set by the filter/rank step
(step_05) before `renderResults` is called. It is not part of the base
`CommandBarResult` type — it is added by the rendering pipeline. Add to the interface:

```typescript
interface CommandBarResult {
  // ... existing fields ...
  _matchPositions?: number[];  // set by filterAndRank(); consumed by renderResults()
}
```

---

## Category label constants

```typescript
const CATEGORY_LABELS: Record<ResultCategory, string> = {
  commands: "Commands",
  headings: "Headings",
  recent: "Recent Files",
};
```

---

## CSS

Injected as a `<style id="__markable_command_bar_css__">` tag. Uses only CSS
variables from `:root` (NFR-04). No hardcoded hex colors or font names.

```css
/* ── Command Bar overlay ─────────────────────────────── */

#markable-command-bar-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);   /* semi-transparent scrim (FR-08.3) */
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}

#markable-command-bar-overlay.cb-hidden {
  display: none;
}

.cb-panel {
  background: var(--settings-panel-bg, var(--bg-color, #1e1e1e));
  border: 1px solid var(--settings-border-color, rgba(255,255,255,0.12));
  border-radius: 10px;
  width: 560px;
  max-width: calc(100vw - 48px);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Input row */
.cb-input-row {
  padding: 12px 14px;
  border-bottom: 1px solid var(--settings-border-color, rgba(255,255,255,0.10));
}

.cb-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  font-family: var(--ui-font);
  font-size: 15px;
  color: var(--text-color, #d4d4d4);
  caret-color: var(--accent-color, #4a9eff);
  padding: 0;
}

.cb-input::placeholder {
  color: var(--text-muted, rgba(255,255,255,0.35));
}

/* Results list */
.cb-results {
  overflow-y: auto;
  max-height: 380px;     /* caps at ~10 result rows (FR-08.2) */
  padding: 4px 0;
}

/* Section header */
.cb-section-header {
  padding: 5px 14px 3px;
  font-family: var(--ui-font);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted, rgba(255,255,255,0.40));
  user-select: none;
}

/* Result row */
.cb-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  font-family: var(--ui-font);
  font-size: 13.5px;
  color: var(--text-color, #d4d4d4);
  border-radius: 6px;
  margin: 0 4px;
  min-height: 34px;
  overflow: hidden;
}

.cb-result:hover:not(.cb-result--dimmed) {
  background: var(--hover-bg, rgba(255,255,255,0.07));
}

.cb-result--selected {
  background: var(--accent-color, #4a9eff) !important;
  color: #fff;
}

.cb-result--dimmed {
  opacity: 0.38;
  cursor: default;
  pointer-events: none;  /* mouse click is a no-op (EC-02) */
}

.cb-result-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-result-sublabel {
  font-size: 11.5px;
  color: var(--text-muted, rgba(255,255,255,0.40));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.cb-result--selected .cb-result-sublabel {
  color: rgba(255,255,255,0.70);
}

/* Keybinding badge */
.cb-result-key {
  font-family: var(--key-font);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.10);
  color: var(--text-muted, rgba(255,255,255,0.55));
  white-space: nowrap;
  flex-shrink: 0;
}

.cb-result--selected .cb-result-key {
  background: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.85);
}

/* Heading level badge */
.cb-result-level {
  font-family: var(--mono-font);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255,255,255,0.08);
  color: var(--text-muted, rgba(255,255,255,0.45));
  flex-shrink: 0;
}

.cb-result--selected .cb-result-level {
  background: rgba(255,255,255,0.18);
  color: rgba(255,255,255,0.80);
}

/* Match highlight */
mark.cb-match {
  background: transparent;
  color: var(--accent-color, #4a9eff);
  font-weight: 600;
}

.cb-result--selected mark.cb-match {
  color: #fff;
  text-decoration: underline;
}

/* Empty state */
.cb-empty {
  padding: 18px 14px;
  text-align: center;
  font-family: var(--ui-font);
  font-size: 13px;
  color: var(--text-muted, rgba(255,255,255,0.38));
  user-select: none;
}
```

---

## CSS injection/removal

```typescript
const STYLE_ID = "__markable_command_bar_css__";

function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS_TEXT; // the CSS string above
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}
```

---

## `openCommandBar()` / `closeCommandBar()` (DOM operations only)

```typescript
function openCommandBar(overlay: HTMLElement, input: HTMLInputElement): void {
  overlay.classList.remove("cb-hidden");
  overlay.setAttribute("aria-hidden", "false");
  input.setAttribute("aria-expanded", "true");
  input.value = "";
  (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__ = true;
}

function closeCommandBar(overlay: HTMLElement, input: HTMLInputElement): void {
  overlay.classList.add("cb-hidden");
  overlay.setAttribute("aria-hidden", "true");
  input.setAttribute("aria-expanded", "false");
  (window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__ = false;
  // Return focus to editor (NFR-05, FR-01.2)
  const view = (window as any).__CM_VIEW__;
  if (view) view.focus();
}
```

---

## Test Cases

These are DOM tests run via Vitest with jsdom:

```typescript
// DOM structure tests
const overlay = buildOverlayDOM();
expect(overlay.id).toBe("markable-command-bar-overlay");
expect(overlay.querySelector(".cb-input")).toBeTruthy();
expect(overlay.querySelector(".cb-results")).toBeTruthy();
expect(overlay.querySelector(".cb-input")?.getAttribute("role")).toBe("combobox");
expect(overlay.querySelector(".cb-results")?.getAttribute("role")).toBe("listbox");

// renderResults: empty state (EC-04)
const container = document.createElement("div");
renderResults(container, [], "", null);
expect(container.querySelector(".cb-empty")).toBeTruthy();
expect(container.querySelector(".cb-empty")?.textContent).toBe("No results");

// renderResults: section headers only when category has results (AD-06, FR-03.B.6)
const results: CommandBarResult[] = [
  { id: "c1", category: "commands", label: "Save", dimmed: false, action: () => {} },
  { id: "h1", category: "headings", label: "Intro", headingLevel: 1, dimmed: false, action: () => {} },
];
renderResults(container, results, "", null);
const headers = container.querySelectorAll(".cb-section-header");
expect(headers.length).toBe(2);
expect(headers[0].textContent).toBe("Commands");
expect(headers[1].textContent).toBe("Headings");
// "Recent Files" header absent because no recent results
expect(Array.from(headers).some(h => h.textContent === "Recent Files")).toBe(false);

// renderResults: dimmed result has correct classes
const dimmedResults: CommandBarResult[] = [
  { id: "f1", category: "commands", label: "Bold", dimmed: true, action: () => {} },
];
renderResults(container, dimmedResults, "", null);
expect(container.querySelector(".cb-result--dimmed")).toBeTruthy();

// renderResults: selected result (EC-27 aria-selected)
renderResults(container, dimmedResults.concat({ id: "f2", category: "commands", label: "Italic", dimmed: false, action: () => {} }), "", "f2");
const selected = container.querySelector(".cb-result--selected");
expect(selected?.getAttribute("aria-selected")).toBe("true");
expect(selected?.getAttribute("data-id")).toBe("f2");

// renderResults: keybinding badge absent when keybinding is undefined (EC-25)
const noKeyResult: CommandBarResult[] = [
  { id: "s1", category: "commands", label: "Status Bar", dimmed: false, action: () => {} },
];
renderResults(container, noKeyResult, "", null);
expect(container.querySelector(".cb-result-key")).toBeNull();
```

---

## Acceptance Criteria

- [ ] Overlay DOM is created with correct structure, all ARIA attributes set.
- [ ] Results container has `role="listbox"`, input has `role="combobox"`.
- [ ] Selected result has `aria-selected="true"`, all others `aria-selected="false"`.
- [ ] `aria-activedescendant` on input references the id of the selected `.cb-result` element (EC-27).
- [ ] Section headers are rendered only for categories with results (AD-06).
- [ ] "No results" placeholder shown when `results.length === 0` (EC-04).
- [ ] Dimmed results have `pointer-events: none` (EC-02 mouse no-op).
- [ ] Keybinding badge is absent when `keybinding` is undefined (EC-25).
- [ ] Labels with HTML-special characters are safe (EC-10 — `textContent` used, not `innerHTML`).
- [ ] All CSS values use CSS variables, no hardcoded hex or font names (NFR-04).
- [ ] `--key-font` is used for keybinding badges (FR-08.7).
- [ ] EC-07/EC-08: long labels are truncated with ellipsis; `title` attribute shows full text.
- [ ] All DOM tests pass via `npm test`.
