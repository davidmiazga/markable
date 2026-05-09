---
title: Step 05 — Inline filter editor (Mac Finder row pattern)
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 05 — Inline filter editor (Mac Finder row pattern)

## Goal

Implement the inline expandable form (FR-23) anchored to the Smart
Folder row (or vault root for create mode). The editor must contain:

- Name input (focused on open).
- Vertical stack of rule rows: `[Type ▾] [Operator ▾] [Value control] [-] [+]`.
- Save / Cancel action bar.
- Click-outside = Cancel.

This step builds the UI and wires Save/Cancel to commit/abort the
draft. The actual settings persistence and re-evaluation triggers are
landed in step_06 (which calls `openFilterEditor` from menu items) and
step_07 (which kicks evaluation after Save).

---

## Files to create

1. `src/plugins/file-browser/smart-folders/editor-ui.ts` — DOM builder
   for the inline filter editor.

## Files to modify

1. `src/plugins/file-browser/smart-folders/index.ts` — add
   `openFilterEditor`, `closeFilterEditor`, `commitDraft` to the
   public surface.
2. `file-browser.plugin.ts` — minor: provide a way for the editor to
   read the current `vaultIndex` and `vault` (used for the
   `extension` and `tag` value-control populations).
3. CSS — editor styles.

---

## 1. Public surface (in `smart-folders/index.ts`)

```typescript
export interface OpenFilterEditorOptions {
  mode: "create" | "edit";
  /** For create: vault root path. For edit: the smart-folder synthetic path. */
  anchorPath: string;
  /** Edit mode only — existing def to seed the form. */
  def?: SmartFolderDef;
}

/** Open the inline editor anchored to the row identified by anchorPath. */
export function openFilterEditor(opts: OpenFilterEditorOptions): void;

/** Close the editor without saving (idempotent). */
export function closeFilterEditor(): void;
```

Module-level state for the open editor:

```typescript
let _openEditor: { container: HTMLElement; cleanup: () => void; mode: "create" | "edit"; defId?: string } | null = null;
```

Only one editor open at a time. Opening another closes the first.

---

## 2. `editor-ui.ts` — DOM builder

### Required exports

```typescript
import type { SmartFolderDef, SmartFolderRule, SmartFolderRuleType } from "./types";

export interface EditorContext {
  /** All distinct extensions in current vault — populates extension dropdown. */
  distinctExtensions: string[];
  /** All known tags + field:value pairs — populates tag picker. */
  knownTags: string[];
  /** Save callback — receives the validated draft. */
  onSave: (draft: SmartFolderDef) => void;
  /** Cancel callback — discard draft. */
  onCancel: () => void;
}

/** Build the inline editor DOM element. */
export function buildEditorElement(
  initial: SmartFolderDef,         // for create mode, caller passes a seeded blank
  ctx: EditorContext,
): HTMLElement;
```

### Editor DOM structure

```html
<div class="smart-folder-editor" data-sf-editor="">
  <input class="smart-folder-name" type="text" placeholder="Name" />

  <ul class="smart-folder-rules">
    <li class="smart-folder-rule-row">
      <select class="sf-type">
        <option value="tag">Tag</option>
        <option value="path">Path</option>
        <option value="extension">Extension</option>
        <option value="modified">Modified</option>
        <option value="links">Links</option>
        <option value="title">Title</option>
      </select>
      <select class="sf-operator">…populated by current type…</select>
      <span class="sf-value">…populated by current type+operator…</span>
      <button class="sf-row-remove" aria-label="Remove rule">−</button>
      <button class="sf-row-add"    aria-label="Add rule">+</button>
    </li>
    <!-- … more rows … -->
  </ul>

  <div class="smart-folder-action-bar">
    <button class="sf-cancel">Cancel</button>
    <button class="sf-save">Save</button>
  </div>
</div>
```

### Rule-row construction (`buildRuleRow`)

Internal helper. Each row owns its own draft state (a single
`SmartFolderRule` reference) and emits a change event up to the
editor when any of its three controls change.

```typescript
function buildRuleRow(
  rule: SmartFolderRule,
  ctx: EditorContext,
  onRowChange: (next: SmartFolderRule) => void,
  onRowRemove: () => void,
  onRowAdd: () => void,
  canRemove: boolean,
): HTMLElement;
```

Rules:

1. **Type change**: reset operator to first valid for new type. Reset
   value to a sensible default (empty string / 0 / today). Re-render
   the operator and value sub-DOM.
2. **Operator change**: re-render value sub-DOM (e.g. "outbound = 0"
   has no value control; "outbound ≥ N" has a number input).
3. **Value change**: validate inline and emit `onRowChange`.
4. **Remove button**: hidden when `canRemove === false` (last
   remaining row — FR-23).
5. **Add button**: appears in **every** row; click prepends a fresh
   default rule directly below this row.

### Operator-list-by-type table

```typescript
const OPERATORS_BY_TYPE: Record<SmartFolderRuleType, string[]> = {
  tag:       ["is", "is not"],
  path:      ["contains", "does not contain", "starts with", "does not start with"],
  extension: ["is", "is not"],
  modified:  ["in last N days", "not in last N days", "before", "after"],
  links:     ["outbound = 0", "outbound >= 1", "outbound >= N",
              "inbound = 0",  "inbound >= 1",  "inbound >= N"],
  title:     ["contains", "does not contain"],
};
```

### Value control by (type, operator)

| Type | Operator | Value control |
|---|---|---|
| tag | any | searchable picker — text input with `<datalist>` populated from `ctx.knownTags` |
| path | any | text input |
| extension | any | `<select>` populated from `ctx.distinctExtensions` (lowercase, with leading dot) |
| modified | "in last N days" / "not in last N days" | number input (min=1) + fixed " days" label |
| modified | "before" / "after" | `<input type="date">` |
| links | parameterless ("= 0", "≥ 1") | none (no value span content) |
| links | "outbound ≥ N" / "inbound ≥ N" | number input (min=1) |
| title | any | text input |

### Save validation (FR-26 / EC-16)

```text
const name = nameInput.value.trim()
const valid =
  name.length > 0 &&
  draft.rules.length > 0 &&
  draft.rules.every(ruleHasValidValue)

if (!valid):
  show inline message in action bar: "Enter a name and at least one rule"
  keep editor open
  return

ctx.onSave({ id, name, rules: draft.rules })
```

`ruleHasValidValue` re-uses the same whitelists as
`sanitizeDef` from step_01 — extract a shared helper into
`smart-folders/validation.ts` if needed (≤ 30 lines), or inline.

### Save button enabled state

The Save button's `disabled` attribute is bound to a single
`updateSaveEnabled()` function called on every input/select change. The
button starts disabled in create mode (empty name + zero rules).

### Click-outside handling (FR-23)

When the editor mounts, register a `mousedown` listener on `document`:

```typescript
function onDocMouseDown(e: MouseEvent) {
  if (!editorEl.contains(e.target as Node)) {
    ctx.onCancel();
  }
}
document.addEventListener("mousedown", onDocMouseDown);
```

Removed by `closeFilterEditor`. Note: the same `mousedown` event is
used by `showContextMenu` for its outside-click dismiss; both can
coexist because they target different DOM trees.

### Escape key

Editor-scoped `keydown` listener: `Escape` triggers `onCancel`.

### Tab focus order

`name input → row 1 type → row 1 operator → row 1 value → row 1 - → row 1 + → row 2 ... → Cancel → Save`.
Default tab order is correct because the DOM order matches the visual
order.

---

## 3. `openFilterEditor` implementation (in `index.ts`)

```text
closeFilterEditor()                                  // close any prior

const anchorLi = document.querySelector(`[data-path="${cssEscape(anchorPath)}"]`)
if (!anchorLi) return                                // anchor missing — abort

const initial: SmartFolderDef = opts.def ?? {
  id: generateSmartFolderId(),
  name: "",
  rules: [defaultRule()],                            // one blank tag rule by default
}

const ctx: EditorContext = {
  distinctExtensions: getDistinctExtensions(),       // from current evaluator state
  knownTags:          getKnownTags(),                // from cached tag scan
  onSave: (draft) => {
    closeFilterEditor()
    commitDraft(opts.mode, draft)                    // persists + triggers re-eval
  },
  onCancel: () => {
    closeFilterEditor()
  },
}

const editorEl = buildEditorElement(initial, ctx)
anchorLi.insertAdjacentElement("afterend", editorEl)

// Focus the name field
editorEl.querySelector<HTMLInputElement>(".smart-folder-name")?.focus()

const cleanup = () => editorEl.remove()
_openEditor = { container: editorEl, cleanup, mode: opts.mode, defId: initial.id }
```

`getDistinctExtensions()` and `getKnownTags()` read from the evaluator's
last inverse-maps cache and the tag-scan cache, respectively. If the
caches are empty (first open before any evaluation pass),
synchronously kick a full evaluation pass and `await` it before
opening — guarantees the dropdowns are populated.

`commitDraft(mode, draft)`:

```text
const vaultId = activeVaultId()
const next = mode === "create"
  ? [..._smartFolders, draft]
  : _smartFolders.map(d => d.id === draft.id ? draft : d)

_smartFolders = next
await saveSmartFolders(_api, vaultId, next)          // step_01
await evaluateAllSmartFolders(next, vaultIndex, vault)  // step_02
renderPanel()                                        // existing
```

The `commitDraft` function is added to `index.ts`; it owns the bridge
between the editor and the rest of the plugin.

---

## 4. CSS additions

```css
.smart-folder-editor {
  background: var(--input-bg, rgba(0,0,0,.04));
  border: 1px solid var(--border-color, rgba(128,128,128,.2));
  border-radius: 6px;
  margin: 4px 8px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.smart-folder-name {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 8px;
  font-size: 13px;
}
.smart-folder-rules {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 6px;
}
.smart-folder-rule-row {
  display: grid;
  grid-template-columns: minmax(80px, auto) minmax(80px, auto) 1fr auto auto;
  gap: 6px;
  align-items: center;
}
.smart-folder-rule-row select,
.smart-folder-rule-row input { font-size: 12px; padding: 2px 4px; }
.sf-row-remove, .sf-row-add {
  width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-color, rgba(128,128,128,.25));
  background: transparent;
  border-radius: 3px;
  cursor: pointer;
}
.smart-folder-action-bar {
  display: flex; justify-content: flex-end; gap: 8px;
}
.smart-folder-action-bar .sf-save[disabled] { opacity: .5; cursor: not-allowed; }
.smart-folder-validation-msg { color: var(--error-color, #c44); font-size: 11px; }
```

---

## Tests to pass after this step

Create `tests/plugins/file-browser/smart-folders.editor.test.ts`:

| Test name | Asserts |
|---|---|
| `editor renders with name input focused on open` | EC-23 / FR-22 |
| `editor seeds rules with one blank rule in create mode` | usability |
| `type change resets operator to first valid for new type` | FR-23 |
| `operator change re-renders value control` | FR-23 |
| `extension dropdown populated from distinctExtensions` | FR-23 |
| `tag picker uses datalist with knownTags` | FR-23 |
| `links operators '= 0' and '>= 1' have no value control` | FR-23 |
| `links operator '>= N' shows number input` | FR-23 |
| `Save disabled when name empty` | FR-26 |
| `Save disabled when rules.length === 0` | FR-26 (only via remove → blocked, but check defense in depth) |
| `Save calls onSave with built def` | round-trip |
| `Cancel calls onCancel and closes` | FR-23 |
| `click-outside calls onCancel` | FR-23 |
| `Escape calls onCancel` | usability |
| `last-remaining row hides remove button` | FR-23 |
| `add button inserts new row directly below` | FR-23 |

These are DOM tests using `@testing-library/dom` style or jsdom raw —
the file-browser test suite already has examples to mirror.

---

## Done when

- [ ] Editor unit tests pass.
- [ ] Editor opens, accepts input, validates, and persists via the
      step_01 settings layer.
- [ ] After Save, `evaluateAllSmartFolders` runs and the smart folder
      appears in the tree (assuming step_07's wiring is in place; if
      this step is implemented before step_07, manual `renderPanel`
      call is acceptable for verification).
- [ ] No regressions in `npm run test:run`.

---

## Constraints

- Pure DOM — no framework, no template engine.
- Each function ≤ 30 lines, file ≤ 30 functions.
- Editor lives **outside** the tree `<ul>`'s DOM — it is inserted as
  a sibling `<div>` of the anchor `<li>` so it doesn't break tree
  semantics.
- The editor must not trap focus globally — `Tab` should still escape
  the editor at the end of the action bar (browser default order).
