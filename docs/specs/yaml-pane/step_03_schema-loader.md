---
title: "YAML Pane — Step 03: Schema Loader"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# Step 03 — Schema Loader

## Goal

Implement and test the **schema loading, validation, and caching subsystem** plus the **plugin settings persistence** functions. This step introduces the first Tauri invocation (for reading the schema file) and the first plugin settings read/write calls.

---

## Files to Modify

| Action | File |
|---|---|
| Modify | `src/plugins/yaml-pane/yaml-pane.plugin.ts` — add schema types, loader, settings functions |
| Modify | `tests/plugins/yaml-pane/yaml-pane.test.ts` — add schema loader tests |

---

## Interfaces and Types to Define

```typescript
export interface SchemaFieldDef {
  type: "string" | "number" | "boolean" | "date" | "array" | "select" | "multiselect";
  values?: string[];
  required?: boolean;
  description?: string;
}

export interface YamlSchema {
  fields: Record<string, SchemaFieldDef>;
}

export interface YamlPaneSettings {
  schemaPath: string;      // empty string = no schema configured
  defaultSide: "left" | "right";
}

// Default settings — used when no settings file exists yet
export const DEFAULT_SETTINGS: YamlPaneSettings = {
  schemaPath: "",
  defaultSide: "right",
};

// Known valid field types for schema validation
export const VALID_SCHEMA_TYPES = [
  "string", "number", "boolean", "date", "array", "select", "multiselect"
] as const;
```

---

## Functions to Implement

### `validateSchemaJson(raw: unknown): YamlSchema`

Takes the result of `JSON.parse()` on the schema file content and validates it against the required structure. Returns a cleaned `YamlSchema`.

Validation rules:
1. `raw` must be an object (not null, not array).
2. `raw.fields` must exist and be an object.
3. For each key in `raw.fields`:
   a. The value must be an object.
   b. `type` must be a string present in `VALID_SCHEMA_TYPES`. If the type is not recognized, emit a `console.warn` and default the type to `"string"` (EC-12: graceful degradation).
   c. `values`, if present, must be an array of strings. Non-string items are silently filtered out.
   d. `required`, if present, must be a boolean. If it is not a boolean, ignore it (treat as `false`).
   e. `description`, if present, must be a string. If it is not, ignore it.
4. Return the cleaned object as `YamlSchema`.

If validation fails at the top level (step 1 or 2), throw an `Error` with a descriptive message. The caller (`loadSchema`) catches this and treats it as a load failure.

**Pure function** — no I/O, no globals.

### `loadSchema(schemaPath: string): Promise<{ schema: YamlSchema } | { error: string }>`

Loads and validates the schema file from the given absolute path. Returns a discriminated union.

Algorithm:
1. If `schemaPath` is empty → return `{ error: "No schema path configured" }`.
2. Invoke `window.__TAURI_INTERNALS__.invoke("read_file", { path: schemaPath })`.
   - On error → return `{ error: "Schema file not found or unreadable: " + errorMessage }` (EC-10).
3. Call `JSON.parse(fileContent)`.
   - On `SyntaxError` → return `{ error: "Schema file contains invalid JSON: " + syntaxError.message }` (EC-11).
4. Call `validateSchemaJson(parsed)`.
   - On thrown `Error` → return `{ error: "Schema has invalid structure: " + error.message }`.
5. Return `{ schema: validatedSchema }`.

This function accesses `window.__TAURI_INTERNALS__` and is therefore not pure. Tests mock the global.

### `getSchemaFieldDef(schema: YamlSchema | null, key: string): SchemaFieldDef | null`

Look up a field definition in the schema by exact key match. Returns `null` if no schema is loaded or the key is not in the schema.

**Pure function.** Used by the panel renderer (Step 04) to determine whether to use schema-driven controls instead of inferred type controls.

### `resolveFieldType(field: YamlField, schema: YamlSchema | null): SchemaFieldDef['type'] | YamlFieldType`

Determines the effective display type for a field, merging schema override with inferred type.

Priority:
1. If `schema` is non-null and `schema.fields[field.key]` exists → use `schema.fields[field.key].type`.
2. Otherwise → use `field.rawType`.

Returns a unified type string used by the DOM renderer (Step 04) to select the correct control.

**Pure function.**

### `mergeWithSchema(fields: YamlField[], schema: YamlSchema | null): EnrichedField[]`

Produces an enriched field array combining parsed fields with schema metadata. Also injects "missing required" placeholder fields.

```typescript
export interface EnrichedField {
  key: string;
  value: unknown;
  effectiveType: SchemaFieldDef['type'] | YamlFieldType;
  isBlockScalar: boolean;
  lineIndex: number;
  schemaValues?: string[];          // from schema.fields[key].values
  required: boolean;                // from schema or false
  description?: string;             // from schema
  isMissing: boolean;               // true = field is in schema as required but absent from doc
}
```

Algorithm:
1. For each field in `fields`: build an `EnrichedField` using `resolveFieldType` and `getSchemaFieldDef`.
2. If `schema` is non-null: scan `schema.fields` for keys marked `required: true` that are NOT present in `fields`. For each missing required key, push a placeholder `EnrichedField` with `isMissing: true`, `value: null`, `effectiveType: schema.fields[key].type` (FR-5.5).
3. Return the result. Missing required fields are appended after the document's existing fields.

**Pure function.**

### `loadSettings(): Promise<YamlPaneSettings>`

Loads plugin settings from Tauri storage via `window.__TAURI_INTERNALS__.invoke("read_plugin_settings", { pluginId: "yaml-pane" })`.

Algorithm:
1. Invoke the command. On error or null result → return `DEFAULT_SETTINGS`.
2. Parse the returned JSON string.
3. Merge with `DEFAULT_SETTINGS` (spread defaults first, then overlay loaded values). This handles missing keys in the stored JSON gracefully.
4. Validate `defaultSide` is `"left"` or `"right"`; default to `"right"` if invalid.
5. Return the merged settings.

### `saveSettings(settings: YamlPaneSettings): Promise<void>`

Persists plugin settings via `window.__TAURI_INTERNALS__.invoke("write_plugin_settings", { pluginId: "yaml-pane", data: JSON.stringify(settings) })`.

On error: log a console warning but do not throw (non-fatal).

---

## Module-Level Schema Cache

The schema is loaded once at `onEnable` time (FR-5.7) and stored in a module-level variable:

```typescript
let _schema: YamlSchema | null = null;
let _schemaLoadError: string | null = null;   // non-null when load failed; shown in panel header
let _settings: YamlPaneSettings = { ...DEFAULT_SETTINGS };
```

These variables are reset to their initial values in `onDisable`.

The panel renderer (Step 04) reads `_schema` and `_schemaLoadError` directly — no prop-drilling, consistent with the backlinks plugin pattern.

---

## Test Cases to Write First (Red Phase)

### Group: `validateSchemaJson`

```
1.  null → throws Error
2.  "string" → throws Error
3.  [] → throws Error
4.  {} (no fields key) → throws Error
5.  { fields: null } → throws Error
6.  { fields: {} } → returns { fields: {} } (empty schema, valid)
7.  { fields: { title: { type: "string" } } } → returns { fields: { title: { type: "string", required: false } } }
    (required defaults to false when absent)
8.  Field with unknown type "color" → type degraded to "string", console.warn emitted (EC-12)
9.  Field with type "select", values: ["a", "b"] → values preserved
10. Field with type "select", values: [] → values preserved as [] (EC-24: empty values, consumer warns)
11. Field with values containing non-strings: ["a", 42, "b"] → non-strings filtered out
12. Field with required: "yes" (not boolean) → required treated as false (invalid non-boolean ignored)
13. Field with description: 123 (not string) → description dropped
14. Multiple fields → all fields present in output
```

### Group: `loadSchema` (mock-based)

```
15. schemaPath="" → { error: "No schema path configured" }
16. invoke throws "File not found" → { error includes "not found" }  (EC-10)
17. invoke returns invalid JSON → { error includes "invalid JSON" }  (EC-11)
18. invoke returns valid JSON but malformed schema (no fields key) → { error includes "invalid structure" }
19. invoke returns valid schema JSON → { schema: { fields: {...} } }
20. invoke returns schema with unknown type → schema returned with type degraded (EC-12)
```

### Group: `getSchemaFieldDef`

```
21. schema=null, key="title" → null
22. schema with "title" field, key="title" → returns that field def
23. schema with "title" field, key="missing" → null
24. schema with "title" field, key="Title" (different case) → null (case-sensitive lookup)
```

### Group: `resolveFieldType`

```
25. field rawType="string", schema=null → "string"
26. field rawType="string", schema has "title" field with type "date" → "date" (schema overrides)
27. field rawType="array", schema has field with type "multiselect" → "multiselect"
28. field rawType="string", schema loaded but field key not in schema → "string" (fallback)
```

### Group: `mergeWithSchema`

```
29. No schema: fields pass through unchanged, isMissing=false for all
30. Schema with "title" required, field present → enriched, isMissing=false
31. Schema with "status" required, field absent → placeholder appended, isMissing=true
32. Schema with "tags" required=false, field absent → no placeholder appended
33. Schema field description carried into EnrichedField.description
34. Schema values[] carried into EnrichedField.schemaValues
35. Two missing required fields → both appended (order: alphabetical by key, or schema order)
```

### Group: `loadSettings` (mock-based)

```
36. invoke returns null → DEFAULT_SETTINGS returned
37. invoke throws → DEFAULT_SETTINGS returned (non-fatal)
38. invoke returns JSON with only "schemaPath" → merges with defaults for missing keys
39. invoke returns settings with invalid defaultSide "top" → defaultSide coerced to "right"
40. invoke returns valid settings → exact settings returned
```

### Group: `saveSettings` (mock-based)

```
41. Successful save → invoke called with correct pluginId and JSON string
42. invoke throws → no throw propagated to caller, console.warn emitted
```

---

## Implementation Notes

1. **Tauri invocation pattern in tests:** Use `vi.stubGlobal('__TAURI_INTERNALS__', { invoke: vi.fn() })` to mock. The mock's `invoke` function should match on command name and return appropriate values per test. Clean up with `vi.unstubAllGlobals()` in `afterEach`.

2. **`mergeWithSchema` missing required field order:** The requirements do not specify the order of missing required field placeholders. Choose alphabetical order by key name for determinism. Document this choice in a comment.

3. **Schema cache invalidation:** The requirements specify a "Reload Schema" button (FR-5.7). This button is rendered in the panel settings area (Step 04) and calls `loadSchema(_settings.schemaPath)` to refresh `_schema` and `_schemaLoadError`. The "Reload Schema" flow is wired in Step 04/05.

4. **`VALID_SCHEMA_TYPES` as const array:** The `as const` assertion gives TypeScript a narrow tuple type, enabling exhaustive checking if needed later. This is good practice for a versioned schema format.

5. **EC-24 handling in `validateSchemaJson`:** An empty `values: []` array is NOT an error at the schema validation layer — `validateSchemaJson` preserves it. The warning about EC-24 is emitted by the DOM renderer (Step 04) when it tries to build a `<select>` with no options, not here. Keep concerns separated.

---

## Acceptance Criteria

- [ ] All schema test cases pass
- [ ] `validateSchemaJson` degrades unknown types to `"string"` with console.warn (EC-12)
- [ ] `loadSchema` returns `{ error }` union for all failure modes (EC-10, EC-11)
- [ ] `mergeWithSchema` injects `isMissing: true` placeholders for absent required fields (FR-5.5)
- [ ] `loadSettings` always returns a valid `YamlPaneSettings` (never throws, merges with defaults)
- [ ] `saveSettings` never throws (non-fatal logging only)
- [ ] Module-level cache variables (`_schema`, `_schemaLoadError`, `_settings`) are declared and ready for use in Steps 04/05
