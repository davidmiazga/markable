/**
 * layout-engine.ts — Handlebars-style template tokenizer and evaluator.
 *
 * Core library module (src/lib/). Compiled into the main bundle.
 * No window/document access at module level.
 *
 * Public API (consumed by layout-manager.ts):
 *   - buildContext()        — assemble a TemplateContext from vault/meta/file data
 *   - render()              — async tokenize + evaluate + strip-scripts pipeline
 *   - stripScripts()        — remove <script> elements from an HTML string
 *   - wireDataPathListeners() — attach click-to-open listeners for data-path elements
 *
 * Internal exports (also exported for unit testing):
 *   - tokenize()            — flat Token[] from a template source string
 *   - resolvePath()         — dot-path lookup on an arbitrary context object
 *   - escape()              — HTML-escape a string for double-brace output
 *   - applyFilters()        — apply a Filter[] pipeline to a value
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * The top-level data object passed to every template render call.
 * All three keys are always present; individual sub-fields may be null.
 */
export interface TemplateContext {
  file: FileContext | null;
  vault: VaultContext;
  meta: MetaContext;
  // Allow additional iteration context keys like "this", "@index", "@key".
  [key: string]: unknown;
}

export interface FileContext {
  title: string;
  content: string;        // raw Markdown
  rendered: string;       // HTML from marked.parse(content)
  tags: string[];
  yaml: Record<string, unknown>;
  path: string;
  name: string;           // stem without extension
  modified: number;       // unix ms
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
  [key: string]: unknown;  // allow dot-path access to additional index fields
}

export interface MetaContext {
  tags: string[];
  fields: Record<string, string[]>;
}

// ── Token types ────────────────────────────────────────────────────────────────

/*
 * A flat Token[] is produced by tokenize(). Nested block bodies are stored
 * on the token itself as a recursively tokenized Token[]. The evaluator
 * consumes the flat outer list and recurses into body arrays as needed.
 */
type Token =
  | { type: "text"; value: string }
  | { type: "var_escaped"; path: string; filters: Filter[] }
  | { type: "var_raw"; path: string; filters: Filter[] }
  | { type: "block_if"; expr: string; body: Token[] }
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

// ── Tokenizer ──────────────────────────────────────────────────────────────────

/**
 * Parse a template source string into a flat array of Token objects.
 *
 * Single-pass regex scan over the source. The master regex matches triple-brace
 * raw-variable expressions first (longer match), then double-brace expressions.
 * Text between matches is accumulated as text tokens.
 *
 * Block tags ({{#if}}, {{#each}}, {{#where}}) recursively tokenize their body by
 * scanning forward to the matching closing tag and calling tokenize() on the
 * captured body text.
 *
 * @param src  Raw template source string.
 * @returns    Flat Token[] array ready for the evaluator.
 */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];

  // Master regex: triple-brace first (group 1), then double-brace (group 2).
  // The /g flag enables repeated lastIndex-based scanning via exec().
  const MASTER = /\{\{\{([^}]+)\}\}\}|\{\{([^}]+)\}\}/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MASTER.exec(src)) !== null) {
    // Emit any literal text between the previous match end and this match start.
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: src.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // Triple-brace: raw variable output (no HTML escaping).
      const inner = match[1].trim();
      tokens.push(parseVarToken(inner, "var_raw"));
    } else {
      // Double-brace: parse the inner expression.
      const inner = match[2].trim();
      const blockToken = parseBlockOrSpecial(inner, src, MASTER);
      if (blockToken !== null) {
        // Block tokens (if/each/where) consume the body text by advancing MASTER.lastIndex.
        // The return value from parseBlockOrSpecial carries the token AND updates MASTER.lastIndex.
        tokens.push(blockToken.token);
        MASTER.lastIndex = blockToken.nextIndex;
      } else {
        tokens.push(parseVarToken(inner, "var_escaped"));
      }
    }

    lastIndex = MASTER.lastIndex;
  }

  // Emit any remaining literal text after the last match.
  if (lastIndex < src.length) {
    tokens.push({ type: "text", value: src.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Attempt to parse a double-brace inner expression as a block tag or special
 * (embed/partial). Returns null if the expression is a plain variable.
 *
 * When a block tag is detected, the function scans forward in `src` to find
 * the matching closing tag (e.g. `{{/if}}`), tokenizes the body text between
 * the opening and closing tags, and returns a result that includes the correct
 * value for `MASTER.lastIndex` after the closing tag.
 *
 * @param inner      The trimmed content between {{ and }}.
 * @param src        The full template source string (for forward scanning).
 * @param masterRe   The master regex (its lastIndex has been advanced past this tag).
 * @returns          { token, nextIndex } on success, or null for plain variables.
 */
function parseBlockOrSpecial(
  inner: string,
  src: string,
  masterRe: RegExp,
): { token: Token; nextIndex: number } | null {
  // embed "path"
  const embedMatch = inner.match(/^embed\s+"([^"]+)"$/);
  if (embedMatch) {
    return { token: { type: "embed", path: embedMatch[1] }, nextIndex: masterRe.lastIndex };
  }

  // partial "path"
  const partialMatch = inner.match(/^partial\s+"([^"]+)"$/);
  if (partialMatch) {
    return { token: { type: "partial", path: partialMatch[1] }, nextIndex: masterRe.lastIndex };
  }

  // {{#if expr}}
  if (inner.startsWith("#if ")) {
    const expr = inner.slice(4).trim();
    const { body, nextIndex } = scanBlock(src, masterRe.lastIndex, "/if");
    return {
      token: { type: "block_if", expr, body: tokenize(body) },
      nextIndex,
    };
  }

  // {{#each collection}}
  if (inner.startsWith("#each ")) {
    const collection = inner.slice(6).trim();
    const { body, nextIndex } = scanBlock(src, masterRe.lastIndex, "/each");
    return {
      token: { type: "block_each", collection, body: tokenize(body) },
      nextIndex,
    };
  }

  // {{#where collection field op "value"}}
  if (inner.startsWith("#where ")) {
    const whereRest = inner.slice(7).trim();
    // Grammar: collection field op "value"
    // op is one of: eq | neq | contains | hasTag
    const whereMatch = whereRest.match(/^(\S+)\s+(\S+)\s+(eq|neq|contains|hasTag)\s+"([^"]*)"$/);
    if (whereMatch) {
      const [, collection, field, op, value] = whereMatch;
      const { body, nextIndex } = scanBlock(src, masterRe.lastIndex, "/where");
      return {
        token: {
          type: "block_where",
          collection,
          field,
          op: op as WhereOp,
          value,
          body: tokenize(body),
        },
        nextIndex,
      };
    }
  }

  return null;
}

/**
 * Scan forward from `startIndex` in `src` to find the first occurrence of
 * `{{closingTag}}` and return the text body between `startIndex` and that tag,
 * plus the index immediately after the closing tag.
 *
 * This is a naïve linear scan that does not handle nested blocks of the same
 * type. The template grammar is simple enough that full nesting support is not
 * required for this implementation phase.
 *
 * @param src          Full template source.
 * @param startIndex   Start of the body (immediately after the opening tag).
 * @param closingTag   The expected closing tag content, e.g. "/if".
 * @returns            { body, nextIndex } — body text and the index after the closer.
 */
function scanBlock(src: string, startIndex: number, closingTag: string): { body: string; nextIndex: number } {
  const closePattern = new RegExp(`\\{\\{\\s*${closingTag.replace("/", "\\/")}\\s*\\}\\}`, "g");
  closePattern.lastIndex = startIndex;
  const closeMatch = closePattern.exec(src);
  if (!closeMatch) {
    // Unclosed block: treat the rest of the source as the body (graceful degradation).
    return { body: src.slice(startIndex), nextIndex: src.length };
  }
  return {
    body: src.slice(startIndex, closeMatch.index),
    nextIndex: closeMatch.index + closeMatch[0].length,
  };
}

/**
 * Parse a variable token (double-brace or triple-brace).
 *
 * The inner string may contain pipe-separated filter expressions after the path,
 * e.g. "file.title | upper | truncate:10".
 *
 * @param inner  The trimmed content between the delimiters.
 * @param kind   "var_escaped" or "var_raw".
 * @returns      A var_escaped or var_raw Token.
 */
function parseVarToken(inner: string, kind: "var_escaped" | "var_raw"): Token {
  const parts = inner.split("|").map((s) => s.trim());
  const path = parts[0];
  const filters: Filter[] = parts.slice(1).map(parseFilter);
  if (kind === "var_raw") {
    return { type: "var_raw", path, filters };
  }
  return { type: "var_escaped", path, filters };
}

/**
 * Parse a single filter expression string into a Filter object.
 *
 * @param raw  A trimmed filter segment, e.g. "date", "truncate:10", "join:, ".
 * @returns    A Filter union member.
 */
function parseFilter(raw: string): Filter {
  if (raw === "date")  return { name: "date" };
  if (raw === "upper") return { name: "upper" };
  if (raw === "lower") return { name: "lower" };

  // truncate:N — N must be a valid integer.
  const truncMatch = raw.match(/^truncate:(.+)$/);
  if (truncMatch) {
    const n = parseInt(truncMatch[1], 10);
    if (!isNaN(n)) return { name: "truncate", n };
    // EC-13: non-integer N → unknown filter.
    return { name: "unknown", raw };
  }

  // join:sep — everything after "join:" is the separator.
  // Strip optional surrounding double or single quotes from the separator
  // so that {{value | join:", "}} produces sep=", " not sep='", "'.
  if (raw.startsWith("join:")) {
    let sep = raw.slice(5);
    if (
      (sep.startsWith('"') && sep.endsWith('"')) ||
      (sep.startsWith("'") && sep.endsWith("'"))
    ) {
      sep = sep.slice(1, -1);
    }
    return { name: "join", sep };
  }

  return { name: "unknown", raw };
}

// ── Path resolver ──────────────────────────────────────────────────────────────

/**
 * Traverse `ctx` by splitting `path` on "." and walking each segment.
 *
 * Returns an empty string for any missing segment rather than throwing (FR-13).
 * Handles special keys like "this", "@index", "@key" as single-segment paths.
 *
 * @param path  Dot-separated key path, e.g. "file.yaml.author" or "@index".
 * @param ctx   The context object (TemplateContext or an iteration sub-context).
 * @returns     The resolved value, or "" if any segment is missing.
 */
export function resolvePath(path: string, ctx: unknown): unknown {
  if (typeof ctx !== "object" || ctx === null) return "";
  const parts = path.split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return "";
  }
  return current ?? "";
}

// ── Value serializer ───────────────────────────────────────────────────────────

/**
 * Convert a resolved value to a string for template output.
 *
 * - null / undefined → ""
 * - string → as-is
 * - number / boolean → String(value)
 * - Array or object → JSON.stringify (EC-10: prevents [object Object] output)
 *
 * @param value  The resolved context value.
 * @returns      String representation.
 */
function serialise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Arrays and plain objects → JSON for transparency (EC-10).
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ── HTML escaper ───────────────────────────────────────────────────────────────

/**
 * Escape special HTML characters in `s` so the output is safe for innerHTML
 * assignment when using double-brace (escaped) variable output (NFR-03).
 *
 * Escapes: & < > " '
 *
 * @param s  The string to escape.
 * @returns  The HTML-escaped string.
 */
export function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Filter application ─────────────────────────────────────────────────────────

/**
 * Apply an ordered list of Filter objects to a value and return the final string.
 *
 * Filters are applied left-to-right. Each filter receives the accumulated value
 * from the previous filter (or the original value for the first filter).
 *
 * @param value    The initial value (may be any type — filters stringify as needed).
 * @param filters  The Filter[] array from the token.
 * @returns        Final string output after all filters are applied.
 */
export function applyFilters(value: unknown, filters: Filter[]): string {
  let current: unknown = value;

  for (const filter of filters) {
    switch (filter.name) {
      case "date": {
        // Convert value to a Date and call toLocaleDateString().
        // On invalid input, return the original value serialised as a string (EC-20).
        const d = new Date(current as string | number);
        if (isNaN(d.getTime())) {
          // EC-20: invalid date → return original value unchanged.
          current = serialise(current);
        } else {
          current = d.toLocaleDateString();
        }
        break;
      }
      case "upper":
        current = serialise(current).toUpperCase();
        break;

      case "lower":
        current = serialise(current).toLowerCase();
        break;

      case "truncate": {
        const s = serialise(current);
        current = s.length > filter.n ? s.slice(0, filter.n) + "\u2026" : s;
        break;
      }

      case "join":
        // If the value is an array, join with the separator.
        // Otherwise return the serialised value unchanged (EC-12).
        if (Array.isArray(current)) {
          current = current.join(filter.sep);
        } else {
          current = serialise(current);
        }
        break;

      case "unknown":
        // FR-15, AC-15: unknown filters produce a bracketed error string.
        return `[unknown filter: ${filter.raw}]`;
    }
  }

  return serialise(current);
}

// ── Context builder ────────────────────────────────────────────────────────────

/**
 * Assemble a TemplateContext from raw vault and meta data.
 *
 * Called by layouts.plugin.ts before every render. The file argument may be
 * null for collection layouts that do not operate on a single active file.
 *
 * @param file   The active file's data, or null for collection layouts.
 * @param vault  The raw vault data (name, files, directories).
 * @param meta   The raw MetaStore (tags, fields).
 * @returns      A TemplateContext ready for render().
 */
export function buildContext(
  file: FileContext | null,
  vault: { name: string; files: VaultFileEntry[]; directories: string[] },
  meta: { tags: string[]; fields: Record<string, string[]> },
): TemplateContext {
  return {
    file,
    vault: {
      name: vault.name,
      files: vault.files,
      directories: vault.directories,
    },
    meta: {
      tags: meta.tags,
      fields: meta.fields,
    },
  };
}

// ── Evaluator ──────────────────────────────────────────────────────────────────

/**
 * Render a layout template string against a context, returning sanitized HTML.
 *
 * The pipeline is:
 *   1. tokenize(templateSrc) → Token[]
 *   2. evaluate(tokens, ctx, depth, vaultRoot, invoke, renderMd) → HTML string
 *   3. stripScripts(html) → sanitised HTML string
 *
 * Async because {{embed}} and {{partial}} require file reads via Tauri invoke.
 *
 * @param templateSrc  The raw template source (layout file body after frontmatter).
 * @param ctx          The TemplateContext built by buildContext().
 * @param depth        Current partial recursion depth (default 0). Max 3.
 * @param vaultRoot    Absolute vault root path for resolving embed/partial paths.
 * @param invoke       The Tauri invoke function (injected for testability).
 * @param renderMd     The marked.parse function (injected for testability).
 * @returns            Sanitized HTML string ready for innerHTML assignment.
 */
export async function render(
  templateSrc: string,
  ctx: TemplateContext,
  depth: number,
  vaultRoot: string,
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>,
  renderMd: (md: string) => string,
): Promise<string> {
  const tokens = tokenize(templateSrc);
  const html = await evaluate(tokens, ctx, depth, vaultRoot, invoke, renderMd);
  return stripScripts(html);
}

/**
 * Evaluate a Token[] against a context and return the concatenated HTML string.
 *
 * For top-level embed tokens, all reads are collected and resolved in parallel
 * before substitution (NFR-01 performance requirement). Partial tokens and
 * tokens inside loop bodies are resolved serially because their execution order
 * may matter and they may be rare enough that parallelism is not worth the
 * added complexity.
 *
 * @param tokens     The Token[] array to evaluate.
 * @param ctx        Current context (may be an iteration sub-context inside loops).
 * @param depth      Partial recursion depth (incremented on each {{partial}} call).
 * @param vaultRoot  Absolute vault root for resolving file paths.
 * @param invoke     Tauri invoke function (dependency-injected).
 * @param renderMd   Markdown-to-HTML function (dependency-injected).
 * @returns          HTML string.
 */
async function evaluate(
  tokens: Token[],
  ctx: unknown,
  depth: number,
  vaultRoot: string,
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>,
  renderMd: (md: string) => string,
): Promise<string> {
  // ── First pass: resolve all top-level embed tokens in parallel (NFR-01) ──────
  //
  // Collect (index, path) pairs for every embed token at the top level of this
  // token list. Resolve them all with Promise.all before the string-join pass.
  const embedPromises: Array<{ idx: number; promise: Promise<string> }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === "embed") {
      // Resolve the embed path relative to the vault root.
      const absPath = tok.path.startsWith("/")
        ? tok.path
        : vaultRoot + "/" + tok.path;
      embedPromises.push({
        idx: i,
        promise: resolveEmbed(absPath, invoke, renderMd),
      });
    }
  }

  // Await all embed reads in parallel.
  const embedResults = new Map<number, string>();
  if (embedPromises.length > 0) {
    const resolved = await Promise.all(embedPromises.map((e) => e.promise));
    for (let k = 0; k < embedPromises.length; k++) {
      embedResults.set(embedPromises[k].idx, resolved[k]);
    }
  }

  // ── Second pass: assemble the output string ──────────────────────────────────

  const parts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    switch (tok.type) {
      case "text":
        parts.push(tok.value);
        break;

      case "var_escaped": {
        const value = resolvePath(tok.path, ctx);
        const str = applyFilters(value, tok.filters);
        parts.push(escape(str));
        break;
      }

      case "var_raw": {
        const value = resolvePath(tok.path, ctx);
        const str = applyFilters(value, tok.filters);
        parts.push(str);
        break;
      }

      case "block_if": {
        // Resolve the expression as a dot-path; treat the result as truthy/falsy.
        const value = resolvePath(tok.expr, ctx);
        if (isTruthy(value)) {
          parts.push(await evaluate(tok.body, ctx, depth, vaultRoot, invoke, renderMd));
        }
        break;
      }

      case "block_each": {
        const collection = resolvePath(tok.collection, ctx);
        if (Array.isArray(collection)) {
          // Iterate with @index and this.
          for (let idx = 0; idx < collection.length; idx++) {
            const iterCtx = mergeContext(ctx, { this: collection[idx], "@index": idx });
            parts.push(await evaluate(tok.body, iterCtx, depth, vaultRoot, invoke, renderMd));
          }
        } else if (typeof collection === "object" && collection !== null) {
          // Iterate key-value pairs of a plain object with @key and this.
          let idx = 0;
          for (const [key, val] of Object.entries(collection as Record<string, unknown>)) {
            const iterCtx = mergeContext(ctx, { this: val, "@key": key, "@index": idx++ });
            parts.push(await evaluate(tok.body, iterCtx, depth, vaultRoot, invoke, renderMd));
          }
        }
        // EC-11: non-iterable value → zero iterations (no output).
        break;
      }

      case "block_where": {
        const collection = resolvePath(tok.collection, ctx);
        if (!Array.isArray(collection)) break; // EC-11: non-array → zero iterations.

        // Filter the array based on the where operator.
        const filtered = (collection as Record<string, unknown>[]).filter((item) =>
          matchesWhereOp(item, tok.field, tok.op, tok.value)
        );

        for (let idx = 0; idx < filtered.length; idx++) {
          const iterCtx = mergeContext(ctx, { this: filtered[idx], "@index": idx });
          parts.push(await evaluate(tok.body, iterCtx, depth, vaultRoot, invoke, renderMd));
        }
        break;
      }

      case "embed": {
        // Use the pre-resolved embed result from the parallel phase.
        const result = embedResults.get(i);
        parts.push(result ?? "");
        break;
      }

      case "partial": {
        // Partial depth check: stop recursion at depth 3 (AC-19, EC-08).
        if (depth >= 3) {
          parts.push("<!-- partial depth limit reached -->");
          break;
        }
        const partialPath =
          vaultRoot + "/VaultSettings/layouts/partials/" + tok.path;
        try {
          const src = await invoke("read_file", { path: partialPath }) as string;
          // Render the partial at depth+1, then strip scripts from its output.
          const partialHtml = await render(src, ctx as TemplateContext, depth + 1, vaultRoot, invoke, renderMd);
          parts.push(partialHtml);
        } catch {
          // Partial read failure: show an inline error span.
          parts.push(`<span class="layout-error">Failed to load partial: ${tok.path}</span>`);
        }
        break;
      }
    }
  }

  return parts.join("");
}

/**
 * Resolve an {{embed}} path by reading the file and rendering its content as
 * Markdown HTML. Returns an error span on read failure (AC-18).
 *
 * @param absPath   Absolute path to the file to embed.
 * @param invoke    Tauri invoke function.
 * @param renderMd  Markdown-to-HTML converter.
 * @returns         Rendered HTML or an error span string.
 */
async function resolveEmbed(
  absPath: string,
  invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>,
  renderMd: (md: string) => string,
): Promise<string> {
  try {
    const content = await invoke("read_file", { path: absPath }) as string;
    return renderMd(content);
  } catch {
    return `<span class="layout-error">Failed to embed: ${absPath}</span>`;
  }
}

/**
 * Test whether a value is truthy according to template semantics.
 *
 * The rules mirror JavaScript truthiness but treat empty arrays as falsy,
 * consistent with template conventions in other systems (Handlebars, Mustache).
 *
 * @param value  The resolved context value.
 * @returns      true when the value should cause an {{#if}} block to render.
 */
function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  // Non-null plain object is truthy.
  return true;
}

/**
 * Apply a where operator comparison between an item's field value and the
 * expected value string.
 *
 * @param item    One element from the collection being filtered.
 * @param field   The field name to test on `item`.
 * @param op      The comparison operator.
 * @param value   The expected value string from the template.
 * @returns       true if the item matches the condition.
 */
function matchesWhereOp(
  item: Record<string, unknown>,
  field: string,
  op: WhereOp,
  value: string,
): boolean {
  const fieldValue = item[field];
  switch (op) {
    case "eq":
      return String(fieldValue) === value;
    case "neq":
      return String(fieldValue) !== value;
    case "contains":
      return String(fieldValue).includes(value);
    case "hasTag":
      return Array.isArray(fieldValue) && (fieldValue as string[]).includes(value);
    default:
      return false;
  }
}

/**
 * Create a new context object that merges the parent context with iteration
 * variables (this, @index, @key).
 *
 * The merge is a flat object spread at the top level of the context object.
 * The iteration variables shadow any same-named top-level keys (which is
 * intentional — "this" should always mean the current iteration item).
 *
 * @param parent  The enclosing context (TemplateContext or a sub-iteration context).
 * @param extras  Iteration variables to inject: { this, @index, @key }.
 * @returns       A new context object combining parent and extras.
 */
function mergeContext(parent: unknown, extras: Record<string, unknown>): unknown {
  if (typeof parent !== "object" || parent === null) return extras;
  return { ...(parent as Record<string, unknown>), ...extras };
}

// ── stripScripts ───────────────────────────────────────────────────────────────

/**
 * Remove all <script> elements from an HTML string before it is assigned to
 * innerHTML. Operates on a detached DOM node so no scripts execute (NFR-02).
 *
 * @param html  Raw HTML string that may contain <script> elements.
 * @returns     HTML string with all <script> elements removed.
 */
export function stripScripts(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("script").forEach((s) => s.remove());
  return div.innerHTML;
}

// ── wireDataPathListeners ──────────────────────────────────────────────────────

/**
 * Attach click event listeners to all elements inside `container` that carry
 * a `data-path` attribute. Clicking such an element calls
 * `window.__MARKABLE_TAB_MANAGER__.openFileInTab(path)` (FR-27).
 *
 * This function accesses `window.__MARKABLE_TAB_MANAGER__` at call time (not
 * at import time), which is safe in the IIFE context because the global is set
 * before any plugin is enabled.
 *
 * @param container  The rendered #custom-tab-host element.
 */
export function wireDataPathListeners(container: HTMLElement): void {
  // Access the tab manager global at call time so tests can inject it freely.
  const tm = (window as unknown as Record<string, unknown>)["__MARKABLE_TAB_MANAGER__"] as
    { openFileInTab: (path: string) => unknown } | undefined;
  if (!tm) return;

  container.querySelectorAll("[data-path]").forEach((el) => {
    (el as HTMLElement).style.cursor = "pointer";
    el.addEventListener("click", () => {
      const path = (el as HTMLElement).dataset.path;
      if (path) void tm.openFileInTab(path);
    });
  });
}
