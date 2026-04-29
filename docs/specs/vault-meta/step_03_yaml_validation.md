---
title: step_03 — YAML Pane Chip Validation Warnings
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Step 03 — YAML Pane Chip Validation Warnings

## Goal

When the active document's YAML front matter contains array-valued fields whose field name has a corresponding meta vocabulary in `window.__MARKABLE_META__`, any chip value that is NOT in the vocabulary is rendered with a `.yaml-pane-chip--warning` CSS modifier (amber border) and a tooltip explaining the mismatch.

This check is synchronous, reads no external state beyond `window.__MARKABLE_META__`, and applies to the `tags` field (FR-9) as well as any other field covered by `window.__MARKABLE_META__.fields[fieldKey]` (FR-10). Warnings are suppressed when the vocabulary is empty (FR-11).

This step touches only one file: `src/plugins/yaml-pane/yaml-pane.plugin.ts`.

Prerequisites: `window.__MARKABLE_META__` is set by `main.ts` (step_01 must be complete).

---

## Files to Change

| File | Change type |
|------|-------------|
| `src/plugins/yaml-pane/yaml-pane.plugin.ts` | **MODIFY** |

---

## 1. Add `getVocabularyForField()` Helper

Add this private helper near the top of the plugin's function definitions (after the settings/schema helpers but before the chip helpers at line ~1707). The IIFE cannot import from `meta-manager.ts`, so this is a self-contained copy of the same logic:

```typescript
/**
 * Return the meta vocabulary for `fieldKey` from window.__MARKABLE_META__,
 * or null when no vocabulary is defined or the vocabulary is empty.
 *
 * Null return value means "no vocabulary configured for this field" —
 * suppresses warning chips (FR-11).
 *
 * Reads window.__MARKABLE_META__ synchronously; no I/O (NFR-7).
 *
 * @param fieldKey - YAML field name (e.g. "tags", "author").
 * @returns Vocabulary string array or null.
 */
function getVocabularyForField(fieldKey: string): string[] | null {
  const meta: any = (window as any).__MARKABLE_META__;
  if (!meta) return null;

  if (fieldKey === "tags") {
    return meta.tags && meta.tags.length > 0 ? meta.tags : null;
  }

  const vocab = meta.fields?.[fieldKey];
  return vocab && vocab.length > 0 ? vocab : null;
}
```

---

## 2. Modify `buildChipElement()` to Accept Vocabulary Check

Current signature (line ~1718):
```typescript
function buildChipElement(val: string, currentValues: string[], fieldKey: string): HTMLElement
```

The signature does not change. The change is in the body: after setting `chip.className = "yaml-pane-chip"`, add the vocabulary warning check:

### Full modified `buildChipElement` body

```typescript
function buildChipElement(val: string, currentValues: string[], fieldKey: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "yaml-pane-chip";

  // FR-9/FR-10: check meta vocabulary for this field.
  // getVocabularyForField returns null when no vocabulary is defined (FR-11 suppression).
  const vocab = getVocabularyForField(fieldKey);
  if (vocab !== null && !vocab.includes(val)) {
    chip.classList.add("yaml-pane-chip--warning");
    chip.title = `"${val}" is not in the ${fieldKey} vocabulary`;
  }

  const chipText = document.createElement("span");
  chipText.textContent = val;
  chip.appendChild(chipText);

  const removeBtn = document.createElement("button");
  removeBtn.className = "yaml-pane-chip-remove";
  removeBtn.textContent = "×";
  removeBtn.title = `Remove "${val}"`;
  removeBtn.addEventListener("click", () => {
    const newArray = currentValues.filter(v => v !== val);
    commitArrayEdit(fieldKey, newArray);
  });

  chip.appendChild(removeBtn);
  return chip;
}
```

Key constraints:
- `chip.title` on the outer `<span>` provides the tooltip text (FR-9). Native browser tooltip via `title` attribute is sufficient for v1.
- The `vocab.includes(val)` comparison is a strict equality check — case-sensitive, no coercion (EC-8, EC-9, Out of scope note in requirements).
- The `removeBtn.title` remains on the button, not the outer chip, to avoid tooltip collision. When the outer chip has a warning title, it shows on the chip body area; the remove button retains its own "Remove" title.

---

## 3. Add `.yaml-pane-chip--warning` CSS

Locate the existing `.yaml-pane-chip` CSS definition (around line 1075). Immediately after the closing brace, add:

```css
.yaml-pane-chip--warning {
  border-color: var(--accent-color);
  background: transparent;
  color: var(--text-primary);
  /* Subtle amber tint using the accent colour at low opacity.
     Uses a standard CSS technique compatible with all CSS variable themes. */
  outline: 1px solid var(--accent-color);
}
```

Note: the requirements reference "amber border" but mandate CSS variables only (NFR-3). `var(--accent-color)` is used for the warning indicator because it is the most visible variable available. If the project adds a `--warning-color` variable in the future, this selector should be updated to use it.

Verify that the existing `.yaml-pane-chip` rule does not already set `outline` (it must not, to avoid conflict). The new rule adds only `outline` on the modifier class, leaving the base chip appearance intact.

---

## 4. Confirm That `rebuildPanelDOM()` Calls `buildChipElement()` via `renderChipWidget()`

The call chain already exists and requires no change:

```
rebuildPanelDOM()
  → renderFieldControl(field, container)
    → renderChipWidget(field, container)      [when type === "array" or "multiselect"]
      → buildChipElement(val, currentValues, field.key)   [for each val in field.value]
```

Because `rebuildPanelDOM()` is called on every CodeMirror `updateListener` event and `getVocabularyForField()` is synchronous, warnings are always up-to-date without any additional wiring (NFR-7).

---

## 5. Verify `schemaPath` Validation Is Not Affected

The existing `schemaPath`-based `SchemaFieldDef` validation (structural type-checking) is completely separate from the meta vocabulary warning. The two systems do not interact:

- `schemaPath` validation controls which `type` is used for rendering (`"select"`, `"multiselect"`, `"array"`, etc.) and provides a `values` list for datalist autocomplete.
- Meta vocabulary warning is a secondary indicator that fires only on chip values absent from `window.__MARKABLE_META__`.

A chip can have both a schema autocomplete list AND a meta vocabulary warning. They are independent.

---

## Acceptance Criteria

- [ ] `getVocabularyForField("tags")` returns `null` when `window.__MARKABLE_META__` is undefined.
- [ ] `getVocabularyForField("tags")` returns `null` when `window.__MARKABLE_META__.tags` is `[]` (FR-11).
- [ ] `getVocabularyForField("tags")` returns the tags array when non-empty.
- [ ] `getVocabularyForField("author")` returns `null` when `fields.author` is absent.
- [ ] `getVocabularyForField("author")` returns the vocabulary when `fields.author` is non-empty.
- [ ] Chip value IN the vocabulary: `chip.className` does NOT include `yaml-pane-chip--warning`.
- [ ] Chip value NOT in non-empty vocabulary: `chip.className` includes `yaml-pane-chip--warning`.
- [ ] Chip value NOT in non-empty vocabulary: `chip.title` is `'"value" is not in the tags vocabulary'`.
- [ ] Chip value check is case-sensitive: `"Productivity"` is not a match for vocabulary entry `"productivity"` (EC-8).
- [ ] EC-9: value `"yes"` parsed as string by js-yaml compares correctly against vocabulary entry `"yes"`.
- [ ] EC-12: field with no meta vocabulary shows no warnings (even if the field has chips).
- [ ] EC-13: after vault switch, next `rebuildPanelDOM()` uses the updated `window.__MARKABLE_META__` (no stale warnings).
- [ ] EC-3: empty vocabulary → no warnings on any chip (FR-11).
- [ ] NFR-7: no async operation inside `buildChipElement()` or `getVocabularyForField()`.
- [ ] NFR-3: `.yaml-pane-chip--warning` uses only `var(--*)` CSS variables.
- [ ] Existing `.yaml-pane-chip-error` class is not modified.
- [ ] `schemaPath` datalist autocomplete continues to work for fields that also have meta vocabulary.

---

## Test Requirements

See `step_04_tests.md` for full test spec. Tests specific to this step:

- `tests/plugins/yaml-pane/chip-warning.test.ts` — unit tests for `getVocabularyForField()` and `buildChipElement()` warning logic.
- Test matrix: vocabulary empty → no warning; vocabulary non-empty, value in vocab → no warning; vocabulary non-empty, value not in vocab → warning class + title.
