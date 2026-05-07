---
title: "Step 02 — Layout Engine"
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Step 02 — Layout Engine

Delivers FR-13 through FR-21: the tokenizer, evaluator, pipe filters, embed,
partial, context builder, and script-stripping sanitizer.

**Single file to create:** `src/plugins/layouts/layout-engine.ts`

This file is a plain TypeScript module imported by `layouts.plugin.ts`. Rollup
bundles it inline into the IIFE — it is never loaded at runtime as a separate
file.

---

## Public API (interface contract for `layouts.plugin.ts`)

```typescript
// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The top-level data object passed to every template render call.
 * All three keys are always present; individual sub-fields may be null.
 */
export interface TemplateContext {
  file: FileContext | null;
  vault: VaultContext;
  meta: MetaContext;
}

export interface FileContext {
  title: string;
  content: string;         // raw Markdown
  rendered: string;        // HTML from marked.parse(content)
  tags: string[];
  yaml: Record<string, unknown>;
  path: string;
  name: string;            // stem without extension
  modified: number;        // unix ms
}

export interface VaultContext {
  files: VaultFileEntry[];
  name: string;
  directories: string[];
}

/** Mirrors the VaultIndexEntry fields exposed to templates. */
export interface VaultFileEntry {
  title: string;
  path: string;
  name: string;
  tags: string[];
  modified: number;
  [key: string]: unknown;   // allow dot-path access to additional index fields
}

export interface MetaContext {
  tags: string[];
  fields: Record<string, string[]>;
}

// ── Context builder ────────────────────────────────────────────────────────────

/**
 * Build a TemplateContext from raw vault/meta data.
 *
 * Called by layouts.plugin.ts before every render. All parameters except
 * `renderMd` are passed in from the plugin's runtime globals.
 *
 * @param file     The active file's data, or null for collection layouts.
 * @param vault    The raw vault index (window.__MARKABLE_VAULT_MANAGER__).
 * @param meta     The raw MetaStore (window.__MARKABLE_META__).
 * @param renderMd The marked.parse function (window.__MARKABLE_RENDER_MD__).
 */
export function buildContext(
  file: FileContext | null,
  vault: { name: string; files: VaultFileEntry[]; directories: string[] },
  meta: { tags: string[]; fields: Record<string, string[]> },
): TemplateContext;

// ── Renderer ───────────────────────────────────────────────────────────────────

/**
 * Render a layout template string against a context.
 *
 * Async because {{embed}} and {{partial}} require file reads via Tauri.
 *
 * @param templateSrc  The raw template source (layout file body after frontmatter).
 * @param ctx          The TemplateContext built by buildContext().
 * @param depth        Current partial recursion depth (default 0). Max 3.
 * @param vaultRoot    Absolute vault root path for resolving relative embed paths.
 * @param invoke       The __TAURI_INTERNALS__.invoke function.
 * @param renderMd     The __MARKABLE_RENDER_MD__ function.
 * @returns            Sanitized HTML string ready for innerHTML assignment.
 */
export async function render(
  templateSrc: string,
  ctx: TemplateContext,
  depth: number,
  vaultRoot: string,
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>,
  renderMd: (md: string) => string,
): Promise<string>;

/**
 * Strip all <script> elements from an HTML string before DOM insertion.
 * Operates on a detached div via innerHTML + querySelectorAll (NFR-02).
 *
 * @param html  Raw HTML string potentially containing <script> tags.
 * @returns     HTML string with all <script> elements removed.
 */
export function stripScripts(html: string): string;

/**
 * Wire click listeners on all [data-path] elements inside a container.
 * Listeners call window.__MARKABLE_TAB_MANAGER__.openFileInTab(path) (FR-27).
 *
 * @param container  The rendered #custom-tab-host element.
 */
export function wireDataPathListeners(container: HTMLElement): void;
```

---

## Internal Implementation

### Token types

```typescript
type Token =
  | { type: "text"; value: string }
  | { type: "var_escaped"; path: string; filters: Filter[] }
  | { type: "var_raw"; path: string; filters: Filter[] }
  | { type: "block_if"; expr: string; body: Token[]; }
  | { type: "block_each"; collection: string; body: Token[] }
  | { type: "block_where"; collection: string; field: string; op: WhereOp; value: string; body: Token[] }
  | { type: "embed"; path: string }
  | { type: "partial"; path: string };

type Filter =
  | { name: "date" }
  | { name: "upper" }
  | { name: "lower" }
  | { name: "truncate"; n: number }
  | { name: "join"; sep: string }
  | { name: "unknown"; raw: string };

type WhereOp = "eq" | "neq" | "contains" | "hasTag";
```

### Tokenizer (`tokenize(src: string): Token[]`)

Single-pass regex scan. The master regex matches:

```
/\{\{\{([^}]+)\}\}\}|\{\{([^}]+)\}\}/g
```

- Triple-brace match → `var_raw` token.
- Double-brace match → parse the inner string:
  - Starts with `#if ` → `block_if` (scan forward to `{{/if}}`).
  - Starts with `#each ` → `block_each` (scan to `{{/each}}`).
  - Starts with `#where ` → `block_where` (scan to `{{/where}}`).
  - `embed "path"` → `embed` token.
  - `partial "path"` → `partial` token.
  - Otherwise → `var_escaped` with optional pipe filters.
- Text between matches → `text` token.

Block body scanning: the tokenizer is recursive for block bodies.
`tokenize(bodySource)` is called on the text between `{{#tag}}` and `{{/tag}}`.

Pipe filter parsing: split inner string on `|`, then parse each filter segment:
- `"date"` → `{ name: "date" }`
- `"upper"` → `{ name: "upper" }`
- `"lower"` → `{ name: "lower" }`
- `"truncate:N"` where N is a valid integer → `{ name: "truncate", n: N }`
- `"truncate:X"` where X is not a valid integer → `{ name: "unknown", raw: "truncate:X" }` (EC-13)
- `"join:sep"` → `{ name: "join", sep }`
- Anything else → `{ name: "unknown", raw: filter }`

### Path resolver (`resolvePath(path: string, ctx: unknown): unknown`)

Splits `path` on `.` and traverses the context object. Returns `""` (empty
string) for any missing segment rather than throwing (FR-13).

Special variables available inside `#each` and `#where` body contexts:
- `this` → current iteration item
- `@index` → zero-based index (array iteration only)
- `@key` → key string (object iteration only)

### Value serialiser (`serialise(value: unknown): string`)

Used by `var_escaped` and `var_raw` after resolution:
- `null` / `undefined` → `""`
- `string` → as-is
- `number` / `boolean` → `String(value)`
- Array or object → `JSON.stringify(value)` (EC-10)

### HTML escaper (`escape(s: string): string`)

Escapes `&`, `<`, `>`, `"`, `'` for double-brace output (NFR-03):

```typescript
function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

### Filter application (`applyFilters(value: unknown, filters: Filter[]): string`)

Applies each filter in left-to-right order:

| Filter | Implementation |
|---|---|
| `date` | `new Date(value).toLocaleDateString()` — returns original on invalid (EC-20) |
| `upper` | `String(value).toUpperCase()` |
| `lower` | `String(value).toLowerCase()` |
| `truncate:N` | `s.length > N ? s.slice(0, N) + "…" : s` |
| `join:sep` | `Array.isArray(value) ? value.join(sep) : serialise(value)` (EC-12) |
| `unknown` | Returns `[unknown filter: ${raw}]` (FR-15, AC-15) |

### Evaluator (`evaluate(tokens, ctx, depth, vaultRoot, invoke, renderMd)`)

Async. Returns `Promise<string>`.

For `embed` tokens: collect all embed paths in the token list, resolve them in
parallel with `Promise.all`, then substitute results into the output string
(NFR-01: parallel reads).

For `partial` tokens:
- Depth check: if `depth >= 3`, return `<!-- partial depth limit reached -->`.
- Read file: `invoke("read_file", { path: vaultRoot + "/VaultSettings/layouts/partials/" + partialPath })`.
- On read failure: return `<span class="layout-error">Failed to load partial: {path}</span>`.
- Otherwise: call `render(src, ctx, depth + 1, ...)` recursively.

For `#if` tokens:
- Resolve `expr` as a dot-path on `ctx`. Truthy check: non-empty string, non-zero
  number, non-empty array, non-null object, `true` boolean.

For `#each` tokens:
- If value is an Array: iterate with `@index` + `this`.
- If value is a plain object (and not null): iterate key-value pairs with `@key` + `this`.
- Otherwise: zero iterations (EC-11).

For `#where` tokens:
- Resolve `collection` on `ctx`.
- If not an array: zero iterations (EC-11 applies).
- Filter array with the given operator:
  - `eq`: `String(item[field]) === value`
  - `neq`: `String(item[field]) !== value`
  - `contains`: `String(item[field]).includes(value)`
  - `hasTag`: `Array.isArray(item.tags) && item.tags.includes(value)`
- Iterate filtered array with `@index` + `this`.

### Context merging for iterations

Each iteration merges the parent context with `{ this: item, "@index": idx, "@key": key }`.
Resolution of `this.field` traverses `item.field`. Resolution of `@index` resolves
`ctx["@index"]`. The merge is a flat object spread — deep nesting is not needed
because `this` is always the current item and `vault`/`file`/`meta` remain accessible.

### `stripScripts(html)`

```typescript
export function stripScripts(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("script").forEach((s) => s.remove());
  return div.innerHTML;
}
```

This executes in a detached DOM node — no scripts run. Must be called on the
final assembled HTML string before it is assigned to `#custom-tab-host.innerHTML`.

### `wireDataPathListeners(container)`

```typescript
export function wireDataPathListeners(container: HTMLElement): void {
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tm) return;
  container.querySelectorAll("[data-path]").forEach((el) => {
    (el as HTMLElement).style.cursor = "pointer";
    el.addEventListener("click", () => {
      const path = (el as HTMLElement).dataset.path;
      if (path) void tm.openFileInTab(path);
    });
  });
}
```

---

## Parallel embed resolution design

The evaluator makes two passes over the token list for async operations:

1. **Collection pass**: walk the token list and collect all `embed` and `partial`
   paths that are statically known (i.e. not inside `#each` — those are resolved
   lazily during evaluation).
2. **Resolution pass**: `Promise.all` for top-level embeds only.
3. **Substitution pass**: substitute resolved HTML strings during the string-join.

For `embed` tokens inside `#each` bodies, the body evaluator resolves them
serially (the array may be large and the depth may matter). For top-level embeds
outside loops, parallel resolution satisfies NFR-01 (sub-200 ms for 500 files).

---

## Test Cases (Red phase — `tests/plugins/layouts/layout-engine.test.ts`)

```typescript
// ── Tokenizer ──────────────────────────────────────────────────────────────────
// TC-01: plain text with no tags → single text token
// TC-02: {{var}} → var_escaped token with empty filters
// TC-03: {{{var}}} → var_raw token
// TC-04: {{value | upper}} → var_escaped with upper filter
// TC-05: {{value | truncate:10}} → var_escaped with truncate:10 filter
// TC-06: {{value | truncate:abc}} → var_escaped with unknown filter (EC-13)
// TC-07: {{value | join:", "}} → var_escaped with join:", " filter
// TC-08: {{#if expr}}body{{/if}} → block_if token with body
// TC-09: {{#each collection}}body{{/each}} → block_each token with body
// TC-10: {{#where vault.files tag eq "project"}}body{{/where}} → block_where
// TC-11: {{embed "path"}} → embed token with path
// TC-12: {{partial "name"}} → partial token

// ── Path resolver ─────────────────────────────────────────────────────────────
// TC-13: resolvePath("file.title", ctx) returns correct string
// TC-14: resolvePath("missing.deep.path", ctx) returns ""
// TC-15: resolvePath("file.yaml.custom", ctx) traverses frontmatter object
// TC-16: resolvePath("this", { this: "hello" }) returns "hello"
// TC-17: resolvePath("@index", { "@index": 0 }) returns 0

// ── HTML escaper ──────────────────────────────────────────────────────────────
// TC-18: escape("<script>") returns "&lt;script&gt;"
// TC-19: escape("a & b") returns "a &amp; b"

// ── Filters ───────────────────────────────────────────────────────────────────
// TC-20: date filter on ISO string returns human-readable date
// TC-21: date filter on unix ms returns human-readable date
// TC-22: date filter on invalid value returns original (EC-20)
// TC-23: upper filter returns uppercase
// TC-24: lower filter returns lowercase
// TC-25: truncate:5 on "hello world" returns "hello…"
// TC-26: truncate:20 on "short" returns "short" (no truncation)
// TC-27: join:", " on array ["a","b","c"] returns "a, b, c"
// TC-28: join on non-array returns stringified value (EC-12)
// TC-29: unknown filter returns [unknown filter: X]

// ── Evaluator ─────────────────────────────────────────────────────────────────
// TC-30: {{var}} double-brace output is HTML-escaped (AC-13)
// TC-31: {{{var}}} triple-brace output is NOT escaped (AC-13)
// TC-32: {{#if truthy}}body{{/if}} renders body
// TC-33: {{#if falsy}}body{{/if}} renders empty string
// TC-34: {{#each array}}{{this}}{{/each}} renders one line per element (AC-16)
// TC-35: {{#each object}}{{@key}}={{this}}{{/each}} renders key-value pairs
// TC-36: {{#each nonArray}}body{{/each}} renders nothing (EC-11)
// TC-37: {{#where vault.files tags hasTag "project"}} filters correctly (AC-17)
// TC-38: {{#where}} with neq operator filters correctly
// TC-39: {{#where}} with contains operator filters correctly
// TC-40: {{embed}} reads file and inlines rendered HTML (AC-18)
// TC-41: {{embed}} on missing file renders error span (AC-18)
// TC-42: {{partial}} renders sub-template with full context
// TC-43: {{partial}} at depth 3 renders depth-limit comment (AC-19)
// TC-44: <script> tags in rendered output are stripped (AC-20)
// TC-45: EC-10 — object value in double-brace is JSON.stringify'd
// TC-46: EC-08 — A→B→A cycle hits depth limit at depth 3
```

---

## Implementation Notes

- `layout-engine.ts` must export only pure functions and types — no module-level
  side effects (no `document` access, no `window` reads at import time).
- `wireDataPathListeners` accesses `window.__MARKABLE_TAB_MANAGER__` at call
  time (inside the function), not at import time. This is safe in IIFE context.
- `stripScripts` accesses `document` at call time. If the test environment does
  not have a DOM, stub it or use `jsdom` (the existing test suite uses `vitest`
  which provides a browser-like environment via `happy-dom`).
- The `render()` function signature accepts `invoke` and `renderMd` as
  parameters (dependency injection) rather than reading from window globals
  directly. This makes the function unit-testable without window mocks and
  keeps the engine free of IIFE-specific coupling.
