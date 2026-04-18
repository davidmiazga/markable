---
title: "YAML Pane — Front Matter Sidebar Panel (FC3 #2)"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# YAML Pane — Front Matter Sidebar Panel (FC3 #2) Requirements Spec

## Summary

As a user, I want a sidebar panel that reads my document's YAML front matter and presents it as a structured, editable form — so that I can view and update fields like `title`, `date`, `tags`, and `categories` without ever touching raw YAML syntax.

---

## Background and Motivation

Markable is evolving into a PKM (Personal Knowledge Management) tool alongside being a Markdown editor. Structured front matter — `date`, `title`, `tags`, `categories`, `status` — is the backbone of that PKM layer. The YAML Pane makes that metadata first-class: visible at a glance, editable with proper UI controls, and auto-populated for new documents.

This feature is listed as FC3 #2 ("YAML Pane — auto-tagging, categories, displayed in a right-side panel"). It must also support term restriction to eliminate similar/duplicate terms (Notion-style controlled vocabulary via schema-driven dropdowns/autocomplete).

This is a **standalone sidebar panel feature**, not part of the Templates plugin. It is independently toggle-able and can coexist with any other sidebar panels.

### Relationship to Templates Plugin

The Templates plugin (FC2 #4) copies YAML front matter verbatim from template files into new documents. The YAML Pane then reads that front matter and exposes it for editing. The two features compose but do not couple — the YAML Pane works on any document with front matter, whether or not it came from a template.

### Existing Infrastructure Leveraged

| Component | File | Relevance |
|---|---|---|
| Sidebar panel system | `src/sidebar/sidebar-manager.ts` | `register()` / `unregister()` with `SidebarPanelDescriptor` |
| Plugin API | `src/plugins/markable-plugin-api.ts` | `api.registerSidebarPanel()`, `api.loadSettings()`, `api.saveSettings()`, `api.addExtensions()` |
| Plugin settings persistence | `src-tauri/src/commands/plugins.rs` | `read_plugin_settings` / `write_plugin_settings` Tauri commands |
| CM6 globals (IIFE) | `src/lib/cm-globals.ts` | `window.__CM_VIEW__`, `window.__CM_STATE__` |
| App globals | `src/main.ts` | `window.__MARKABLE_CURRENT_FILE__`, `window.__MARKABLE_EDITOR_VIEW__` |
| Tab switch detection | CM6 `updateListener` | Same polling pattern as Backlinks (compare `__MARKABLE_CURRENT_FILE__` across transactions) |
| Bridge layer | `src/lib/bridge.ts` | `readFile()`, `writeFile()` for schema file I/O |
| Existing panels (reference) | `src/plugins/backlinks/backlinks.plugin.ts`, `src/plugins/auto-toc/auto-toc.plugin.ts` | Sidebar panel registration and update patterns |

---

## Functional Requirements

### FR-1: YAML Front Matter Detection

**FR-1.1** The YAML Pane detects whether the current document begins with a YAML front matter block. A valid front matter block is defined as: the document starts with `---` on line 1 (no leading whitespace, no trailing content on that line), followed by zero or more content lines, closed by a line containing only `---` or `...`.

**FR-1.2** If no valid front matter block is detected, the panel displays an empty-state UI with an "Add Front Matter" button (FR-3.4).

**FR-1.3** Front matter is parsed as YAML. If the YAML content within the delimiters is syntactically invalid, the panel displays a parse-error state (see EC-2).

**FR-1.4** Front matter detection and parsing run on every CM6 document update (transaction), debounced at 150ms, so the panel stays in sync as the user types in the editor.

**FR-1.5** The front matter block is defined as character positions `[0, closingDelimiterEnd]` in the CM6 document. All edit operations target this exact range.

### FR-2: Field Display

**FR-2.1** The panel renders each top-level YAML key-value pair as a labeled row. The label is the YAML key; the value is an editable control (determined by FR-4).

**FR-2.2** Field rows are presented in the order they appear in the YAML source. Order is preserved on write-back.

**FR-2.3** Nested YAML objects (values that are themselves maps) are displayed as a collapsible sub-section, indented under the parent key. Nested editing is supported for one level of nesting only. Deeper nesting (2+ levels) is displayed as a read-only raw YAML string (see EC-6).

**FR-2.4** YAML sequences (arrays) are displayed as a tag/chip widget: each array element is a removable chip, and a text input appends new items. This applies to fields like `tags` and `categories`.

**FR-2.5** Scalar values (strings, numbers, booleans) are displayed as single-line text inputs, except where schema overrides apply (FR-5).

**FR-2.6** Multi-line string values (YAML block scalars: `|` and `>`) are displayed as multi-line textarea controls.

**FR-2.7** Each row has a delete button (visible on hover) that removes the entire key-value pair from the front matter.

### FR-3: Field Editing and Write-back

**FR-3.1** When the user commits a field edit (blur, Enter for single-line fields, chip add/remove), the plugin computes the updated YAML string and dispatches a CM6 transaction that replaces the front matter block in the document.

**FR-3.2** The write-back operation replaces only the front matter block (`[0, closingDelimiterEnd]`), not the entire document. Non-front-matter document content is never touched.

**FR-3.3** The replacement YAML is serialized from the in-memory field model, preserving: field order, YAML block scalar syntax (`|` / `>`), and comments. NOTE: because standard YAML serializers strip comments, comment preservation is handled by a line-diffing strategy — only the modified key's line(s) are rewritten; unmodified lines are forwarded verbatim from the original YAML source (see AD-2 for architecture decision).

**FR-3.4** "Add Front Matter" button (shown when no front matter exists): inserts a minimal front matter block at position 0 with auto-populated fields (FR-6). After insertion, the panel switches to its normal display mode.

**FR-3.5** "Add Field" button at the bottom of the panel: opens an inline input row where the user types a key name and initial value. On confirm, the new key-value pair is appended to the end of the front matter block.

**FR-3.6** Field edits do not trigger the document's debounced save (they do not count as "typing in the editor"). Front matter edits dispatch a CM6 transaction that sets the `dirty` flag, requiring the user to save via the normal Cmd-S flow.

**FR-3.7** While the user is editing a field in the panel, the CM6 document update listener (FR-1.4) is suppressed for the field being edited, to prevent the panel re-rendering and losing focus mid-edit. Other fields may still update if an external change occurs.

### FR-4: Field Type Inference

In the absence of a schema entry (FR-5), the panel infers the control type from the YAML value:

**FR-4.1** `boolean` values (`true`/`false`) — rendered as a toggle/checkbox.

**FR-4.2** `number` values (integer or float) — rendered as a number input.

**FR-4.3** `string` values — rendered as a single-line text input, unless the raw YAML source uses block scalar syntax (`|` or `>`), in which case a textarea is used (FR-2.6).

**FR-4.4** `array` (sequence) values — rendered as a chip/tag widget (FR-2.4).

**FR-4.5** `null` / empty values — rendered as a single-line text input (the field exists but has no value; the user can type to fill it).

**FR-4.6** `date` string values matching ISO 8601 (`YYYY-MM-DD`) — rendered as a date input (`<input type="date">`), unless a schema override specifies otherwise.

### FR-5: Schema-Based Field Validation and Controlled Vocabularies

**FR-5.1** The schema file is a JSON file at a user-configured absolute path (stored in plugin settings). When no schema path is configured, all fields fall back to FR-4 type inference and no controlled vocabulary enforcement occurs.

**FR-5.2** The schema file format defines per-field rules. Minimum required structure:

```json
{
  "fields": {
    "<fieldName>": {
      "type": "string" | "number" | "boolean" | "date" | "array" | "select" | "multiselect",
      "values": ["allowed-value-1", "allowed-value-2"],
      "required": true | false,
      "description": "Human-readable hint shown under the field label"
    }
  }
}
```

`values` is only meaningful for `select`, `multiselect`, and `array` types. When present, the field's edit control becomes a dropdown (single select) or an autocomplete chip widget (multiselect/array) restricted to the listed values.

**FR-5.3** A field with `"type": "select"` is rendered as a `<select>` dropdown (or a styled equivalent). Only values listed in `values[]` are valid; free-text input is not permitted.

**FR-5.4** A field with `"type": "multiselect"` or `"type": "array"` with a `values` list is rendered as a chip widget where adding a new chip shows an autocomplete dropdown filtered to `values[]`. Free-text input that does not match any entry in `values[]` is rejected with an inline validation message (see EC-9).

**FR-5.5** A field marked `"required": true` that is absent from the document's front matter is highlighted in the panel with a visual indicator (e.g., yellow background or asterisk on the label). The missing field row is shown as an "add this field" prompt. The YAML Pane does not block saving — it only indicates the violation visually.

**FR-5.6** The `description` string, if present, is displayed as a tooltip or sub-label under the field row.

**FR-5.7** Schema is loaded once at plugin enable time and when the schema path setting changes. It is not re-read on every document open. A "Reload Schema" button is available in the plugin's settings panel.

**FR-5.8** Schema loading failures (file not found, invalid JSON, malformed structure) result in a non-fatal warning displayed in the panel header: "Schema could not be loaded. Using type inference." All fields fall back to FR-4 behavior.

### FR-6: Auto-Population of Standard Fields

**FR-6.1** When the "Add Front Matter" button is clicked (FR-3.4) and the document has no front matter, the plugin auto-populates the following standard fields if they are not already present:

- `date` — today's date in ISO 8601 format (`YYYY-MM-DD`), derived from the system clock at click time.
- `title` — derived as follows, in priority order:
  1. The first `# Heading 1` found in the document body (text only, Markdown syntax stripped).
  2. The filename without extension (from `window.__MARKABLE_CURRENT_FILE__`), with hyphens and underscores replaced by spaces.
  3. The string `"Untitled"` if neither of the above is available.

**FR-6.2** Auto-population only fires on "Add Front Matter". It does NOT fire automatically when the user opens an existing document that lacks front matter. The user must explicitly opt in via the button.

**FR-6.3** Auto-populated fields can be freely edited or deleted after insertion.

**FR-6.4** Schema-defined `required` fields that are absent are flagged visually (FR-5.5) but are not auto-inserted. Only `date` and `title` are auto-inserted on "Add Front Matter".

### FR-7: Panel Lifecycle and Tab Switching

**FR-7.1** The panel re-parses and re-renders its content when the active tab changes (detected via comparison of `window.__MARKABLE_CURRENT_FILE__` across CM6 `updateListener` calls, matching the Backlinks polling pattern).

**FR-7.2** When the active tab is an untitled (unsaved) document, the panel shows the empty-state UI with the "Add Front Matter" button — the title auto-population falls back to `"Untitled"` per FR-6.1.3.

**FR-7.3** The panel is destroyed (via `descriptor.destroy()`) and re-created when the plugin is disabled and re-enabled.

**FR-7.4** The default panel side is `right`. The user can move it to the left sidebar via the standard sidebar move button.

**FR-7.5** The panel id is `"yaml-pane"`. The panel title displayed in the sidebar header is `"Properties"` (matching Obsidian convention, which users of this feature will recognise).

### FR-8: Plugin Lifecycle

**FR-8.1** The plugin is registered as a core plugin with:
- `id`: `"yaml-pane"`
- `name`: `"YAML Pane"`
- `version`: `"1.0.0"`
- `description`: `"Display and edit document front matter as structured fields"`

**FR-8.2** `onEnable` sequence:
1. Inject CSS for the panel UI.
2. Load plugin settings (schema path, any persisted UI state).
3. Load the schema file if a path is configured (FR-5.1).
4. Register the sidebar panel via `api.registerSidebarPanel()`.
5. Register the CM6 `updateListener` extension via `api.addExtensions()` for document change detection.

**FR-8.3** `onDisable` sequence:
1. Unregister the sidebar panel via `api.unregisterSidebarPanel()` (calls `destroy()` on the container).
2. Remove CM6 extensions via `api.removeExtensions()`.
3. Remove injected CSS.
4. Clear all in-memory state (parsed field model, schema cache, debounce timers).

**FR-8.4** The plugin is added to the `PLUGINS` array in `scripts/build-plugins.mjs` for IIFE bundling.

### FR-9: Settings

**FR-9.1** Plugin settings schema:

```json
{
  "schemaPath": "",
  "defaultSide": "right"
}
```

**FR-9.2** `schemaPath` — absolute path to the JSON schema file. Empty string means no schema configured. Editable via the plugin detail view in the Plugins Panel.

**FR-9.3** `defaultSide` — the initial sidebar side (`"left"` or `"right"`). Overridden by the sidebar system's `panelSides` map once the user moves the panel.

**FR-9.4** Settings are persisted via `api.saveSettings()` / `api.loadSettings()`, stored at `~/Library/Application Support/com.markable.app/plugins/yaml-pane/settings.json`.

---

## Non-Functional Requirements

**NFR-1: Parse Performance** — Front matter parsing must complete in under 20ms for documents up to 10,000 lines. The front matter block itself rarely exceeds 50 lines; parsing is not a bottleneck.

**NFR-2: Write-back Atomicity** — A field edit must dispatch a single CM6 transaction that atomically replaces the front matter block. No intermediate states should be visible in the editor's undo history for a single logical edit.

**NFR-3: Undo/Redo Compatibility** — Front matter edits dispatched via CM6 `view.dispatch()` must be undoable via Cmd-Z in the editor. Each committed field edit (blur or Enter) creates one undo step.

**NFR-4: CSS Theme Compatibility** — All panel UI uses CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--border-color`, `--accent-color`, `--selection-bg`). The panel automatically adopts the active theme.

**NFR-5: IIFE Self-Containment** — The plugin follows all IIFE self-containment rules: no app-internal module imports at runtime, CSS injected via `<style>` tag, CM6 accessed exclusively via `window.__CM_VIEW__` and `window.__CM_STATE__` globals.

**NFR-6: No External YAML Library Bundled** — The YAML parsing and serialization is implemented using a lightweight in-bundle parser sufficient for the front matter use case (no complex YAML features: anchors, aliases, multi-document streams). A small, MIT-licensed YAML parser may be bundled into the IIFE (e.g., `js-yaml` or a subset). This is an open question for architecture (see Open Questions OQ-1).

**NFR-7: Schema File Size** — The schema loader must handle schema files up to 500 fields without perceptible delay. Schema loading is a one-time operation at enable time.

---

## Architectural Decisions (Proposed — for Architect to confirm)

**AD-1: YAML Parser Strategy** — A small YAML parser is bundled into the plugin IIFE. The parser must handle: scalars, sequences, mappings, block scalars (`|`, `>`), and quoted strings. It does not need to handle anchors, aliases, or multi-document streams. Candidate: `js-yaml` (minified subset). The Architect must evaluate whether `js-yaml` can be bundled cleanly as an IIFE and whether a smaller alternative exists.

**AD-2: Comment Preservation via Line-Diffing** — Standard YAML serializers discard comments. To preserve them, the write-back strategy is: parse the original YAML source into a line-indexed map; when a field value changes, find the line(s) corresponding to that key using the parser's source-position output; rewrite only those lines; leave all other lines (including comment lines) verbatim. This avoids a full-round-trip serialization. The Architect must validate that the chosen parser provides source positions.

**AD-3: CM6 Transaction Strategy** — Front matter write-back uses a single `view.dispatch({ changes: { from: 0, to: closingDelimiterEnd, insert: newFrontMatterString } })`. No StateField is used — the YAML Pane does not need to decorate the document. The panel is pure DOM driven by the plugin's own state, not a CM6 decoration.

**AD-4: Schema File Format** — JSON (not YAML) for the schema file. Rationale: the schema file must be parseable without the YAML parser (bootstrapping problem). JSON is simpler to validate and author. YAML schema files are out of scope.

---

## Open Questions (for Architecture Phase)

**OQ-1: YAML Parser Library** — Which YAML parser should be bundled? Options: (a) `js-yaml` (~40KB minified), (b) a custom minimal parser written for this use case, (c) `yaml` (the `npm:yaml` package). The Architect must research current options, check IIFE bundle compatibility, and confirm comment-with-source-position support before committing.

**OQ-2: YAML Serializer Strategy** — Confirm whether the line-diffing approach (AD-2) is sufficient for all field types, or whether certain edits (e.g., converting a scalar to an array) require a full re-serialization. If full re-serialization is needed, define the comment-loss policy.

**OQ-3: New Tauri Command Needed?** — The schema file is read via `readFile()` from `src/lib/bridge.ts`. No new Tauri command is needed unless the schema file can be outside the app sandbox. Confirm whether `readFile()` can read arbitrary absolute paths on macOS (it can via `tauri-plugin-fs` with appropriate scope config) or whether a new `read_arbitrary_file` command is needed.

**OQ-4: Tag Deduplication UX** — The FEATURES.md spec says the YAML Pane must support "term restriction to eliminate similar/duplicate terms (Notion-style)." This implies fuzzy matching or case-insensitive deduplication on `tags`/`categories`. Define the exact behavior: (a) block exact duplicates only, (b) warn on case-insensitive duplicates, (c) fuzzy match within the schema `values[]` list. The user must clarify before architecture.

**OQ-5: Field Add UX — Key Name Input** — When the user clicks "Add Field" (FR-3.5), should the key name be: (a) a free-text input (any valid YAML key), (b) restricted to a predefined list from the schema, or (c) a hybrid (schema suggestions + free-text allowed)? This affects the complexity of the "Add Field" widget.

---

## Out of Scope

1. **Nested YAML beyond one level** — Second-level nesting is read-only (raw YAML string display). Full nested editing is not in scope.
2. **YAML anchors and aliases** — Not supported. If detected, the block scalar containing them is displayed as a read-only raw text area.
3. **YAML schema file authoring UI** — The schema file is authored manually in a text editor. No schema builder UI is provided.
4. **Automatic front matter insertion on document open** — Auto-population only triggers via the explicit "Add Front Matter" button. Not on document open.
5. **Front matter validation blocking save** — Required-field violations are flagged visually only. The user can save a document with missing required fields.
6. **YAML Pane in the editor itself (inline)** — The YAML Pane is a sidebar panel only. No inline front matter editing widget is provided.
7. **Front matter syncing to Templates** — The Templates plugin's content is verbatim. There is no mechanism to "push" YAML Pane field edits back to a template file.
8. **Multi-document YAML streams** — Documents beginning with multiple `---`-delimited sections are out of scope. Only the first front matter block (lines 1 through the first closing `---`) is processed.
9. **YAML comments in the middle of values** — Inline comments (e.g., `title: My Doc # comment`) are preserved by the line-diff strategy, but only for unmodified lines. If a user edits the `title` field, the inline comment on that line will be lost.

---

## Edge Case Inventory

**EC-1: Document has no front matter** — `window.__CM_VIEW__` document text does not begin with `---`. Expected: panel shows empty-state message "No front matter" with an "Add Front Matter" button. No parse attempt is made.

**EC-2: Front matter block contains invalid YAML** — The content between `---` delimiters is not valid YAML (e.g., tab indentation, mismatched quotes, duplicate keys). Expected: panel displays a parse-error state with the message "Front matter contains invalid YAML. Edit the raw text to fix it." No fields are rendered. No auto-edit is attempted.

**EC-3: Front matter opening delimiter is present but closing delimiter is missing** — The document starts with `---` but there is no matching closing `---` or `...`. Expected: treated as "no valid front matter" (same as EC-1). The "Add Front Matter" button is shown. The unclosed `---` remains untouched.

**EC-4: Front matter is valid YAML but has no keys (empty block)** — Content between `---` delimiters is empty or only whitespace/comments. Expected: panel shows "No fields" with the "Add Field" button and the auto-populate prompt. The block is valid and will be written back correctly.

**EC-5: Front matter contains only a YAML comment** — E.g., `---\n# comment only\n---`. Expected: parsed as an empty mapping (YAML comments are not key-value pairs). Same behavior as EC-4.

**EC-6: Front matter contains deeply nested YAML (2+ levels)** — E.g., `meta:\n  author:\n    name: Alice\n    email: a@b.com`. Expected: the `meta` key is displayed with a collapsible sub-section showing one level of nesting. The `author` sub-object is displayed as a raw YAML string textarea (read-only). Editing the raw string is not supported in v1 (future enhancement).

**EC-7: Front matter value is a multi-line block scalar** — E.g., `description: |\n  Line one.\n  Line two.`. Expected: rendered as a multi-line textarea. Write-back preserves the `|` block scalar syntax.

**EC-8: Front matter `date` field already exists when "Add Front Matter" is clicked** — Should never happen (the button only appears when no front matter exists). Defensive check: if for any reason a `date` field already exists, do not overwrite it.

**EC-9: User attempts to add a tag not in the schema's `values[]` list** — E.g., types "fiction" into a `tags` field whose schema restricts values to `["tech", "design", "business"]`. Expected: the chip is not added; an inline validation message appears: "\"fiction\" is not in the allowed values list." The input field retains the typed text for correction.

**EC-10: Schema file path is set but the file does not exist** — Expected: non-fatal warning in the panel header per FR-5.8. All fields fall back to type inference. A "Reload Schema" button is shown.

**EC-11: Schema file exists but contains invalid JSON** — Expected: same as EC-10. The JSON.parse error message is included in the warning.

**EC-12: Schema file is valid JSON but uses an unrecognised field `type`** — E.g., `"type": "color"`. Expected: the unrecognised type is treated as `"string"` (graceful degradation). A console warning is logged.

**EC-13: User edits a field while the CM6 document is being modified by another source (e.g., undo)** — Expected: the debounced `updateListener` fires after the undo, re-parses the front matter, and re-renders the panel with the post-undo state. If the user was mid-edit, their in-progress change is discarded (the panel re-renders from the document source of truth). This is acceptable behavior for v1.

**EC-14: User deletes the last field in the front matter** — Expected: the front matter block becomes empty (`---\n---\n`). The panel switches to the "No fields" state (EC-4). The empty block remains in the document — it is not auto-removed.

**EC-15: User deletes the front matter block manually in the editor while the YAML Pane is open** — The document update listener detects that the document no longer starts with `---`. Expected: panel transitions to empty-state (EC-1) without error.

**EC-16: Front matter block is very large (50+ fields)** — Expected: the panel renders all fields. Scroll within the panel content area is handled by CSS `overflow-y: auto` on the content container.

**EC-17: Active tab is switched to a document with different front matter while a field edit is in progress** — Expected: the in-progress edit is discarded (not committed to the old document). The panel re-renders with the new document's front matter. No partial writes occur.

**EC-18: `title` auto-population — document has no H1 and no file path** — Untitled document, no heading. Expected: `title` is auto-populated as `"Untitled"` per FR-6.1.3.

**EC-19: Front matter YAML contains a key that is a YAML reserved word** — E.g., a key named `true` or `null`. Expected: the parser should handle these as string keys (per YAML 1.2 mapping key rules). Display in the panel uses the raw key string. If the parser coerces the key, it is shown as-is.

**EC-20: Write-back produces a CM6 transaction on a document that has been closed** — Race condition: the user commits a field edit and immediately closes the tab before the dispatch fires. Expected: the plugin checks that `window.__CM_VIEW__` still refers to a live view before dispatching. If the view is destroyed, the dispatch is silently skipped.

**EC-21: "Add Field" — user enters a key name that already exists** — Expected: duplicate key is detected before write-back. An inline validation message: "Field \"{key}\" already exists." The add operation is aborted; the existing field is highlighted/scrolled into view.

**EC-22: "Add Field" — user enters an invalid YAML key (contains special characters)** — YAML keys with spaces or special characters must be quoted. Expected: the plugin auto-quotes the key in the written YAML if it requires quoting. The label in the panel shows the unquoted display form.

**EC-23: Plugin disabled while a field edit is in progress** — Expected: `onDisable` calls `destroy()` on the panel container, removing all DOM. The in-progress edit is discarded. The CM6 document is not modified.

**EC-24: Schema `values[]` list is empty** — `"type": "select"` with `"values": []`. Expected: the field renders as a `<select>` with no options. The user cannot select any value. A console warning is logged: "Schema field \"{name}\" has type \"select\" but no values defined."

**EC-25: Front matter first line has trailing whitespace** — `---   ` (with trailing spaces). Expected: detection is whitespace-tolerant. The line is treated as a valid opening delimiter if its trimmed content is `---`.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| YAML Pane plugin | `src/plugins/yaml-pane/yaml-pane.plugin.ts` (new) | IIFE plugin: panel render, field form, YAML parse/serialize, schema load |
| YAML parser (bundled) | Bundled into plugin IIFE | TBD by Architect (OQ-1); likely `js-yaml` or custom minimal parser |
| Plugin build registration | `scripts/build-plugins.mjs` | Add yaml-pane to PLUGINS array |
| Plugin settings store | `~/Library/.../plugins/yaml-pane/settings.json` | Created at runtime via `api.saveSettings()` |
| YAML Pane tests | `tests/plugins/yaml-pane/yaml-pane.test.ts` (new) | Unit tests for all pure functions + edge cases |
| Schema loader tests | Included in above test file | EC-10, EC-11, EC-12, EC-24 |
| Bridge `readFile` scope check | `src/lib/bridge.ts` / Tauri config | Confirm arbitrary-path reads work for schema (OQ-3) |
