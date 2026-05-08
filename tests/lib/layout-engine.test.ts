/**
 * tests/plugins/layouts/layout-engine.test.ts
 *
 * Unit tests for the layout engine (step_02 of the Layouts feature).
 *
 * Covers all token types, path resolution, HTML escaping, filters, and evaluator
 * behaviour including embed, partial, #if, #each, #where, and script-stripping.
 *
 * All async operations use a mock invoke function so no real Tauri IPC is needed.
 * The test environment provides a DOM via happy-dom (configured in vitest config).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  tokenize,
  resolvePath,
  escape,
  applyFilters,
  stripScripts,
  wireDataPathListeners,
  render,
  buildContext,
} from "../../src/lib/layout-engine";

// ── Shared test context ────────────────────────────────────────────────────────

const baseCtx = {
  file: {
    title: "Test",
    content: "body text",
    rendered: "<p>body text</p>",
    tags: ["a", "project"],
    yaml: { author: "Dave", year: 2024 },
    path: "/v/test.md",
    name: "test",
    modified: 1000,
    toc: [],
  },
  vault: {
    files: [
      { title: "File A", path: "/v/a.md", name: "a", tags: ["project"], modified: 100 },
      { title: "File B", path: "/v/b.md", name: "b", tags: ["reference"], modified: 200 },
    ],
    name: "TestVault",
    directories: ["/v"],
  },
  meta: {
    tags: ["project", "reference"],
    fields: { status: ["draft", "done"] },
  },
};

const mockInvoke = vi.fn();
const mockRenderMd = (md: string) => `<p>${md}</p>`;

// ── Tokenizer ──────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  /**
   * TC-01: A string with no template tags produces a single text token.
   */
  it("TC-01: plain text → single text token", () => {
    const tokens = tokenize("hello world");
    expect(tokens).toEqual([{ type: "text", value: "hello world" }]);
  });

  /**
   * TC-02: {{var}} produces a var_escaped token with the correct path.
   */
  it("TC-02: {{var}} → var_escaped token with empty filters", () => {
    const tokens = tokenize("{{file.title}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "var_escaped", path: "file.title", filters: [] });
  });

  /**
   * TC-03: {{{var}}} (triple brace) produces a var_raw token.
   */
  it("TC-03: {{{var}}} → var_raw token", () => {
    const tokens = tokenize("{{{file.rendered}}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "var_raw", path: "file.rendered" });
  });

  /**
   * TC-04: {{value | upper}} produces a var_escaped token with an upper filter.
   */
  it("TC-04: {{value | upper}} → var_escaped with upper filter", () => {
    const tokens = tokenize("{{file.title | upper}}");
    expect(tokens[0]).toMatchObject({
      type: "var_escaped",
      path: "file.title",
      filters: [{ name: "upper" }],
    });
  });

  /**
   * TC-05: {{value | truncate:10}} produces a truncate filter with n=10.
   */
  it("TC-05: {{value | truncate:10}} → var_escaped with truncate:10 filter", () => {
    const tokens = tokenize("{{file.title | truncate:10}}");
    expect(tokens[0]).toMatchObject({
      type: "var_escaped",
      path: "file.title",
      filters: [{ name: "truncate", n: 10 }],
    });
  });

  /**
   * TC-06: EC-13 — {{value | truncate:abc}} (non-numeric N) produces an
   * unknown filter rather than crashing.
   */
  it("TC-06: {{value | truncate:abc}} → var_escaped with unknown filter (EC-13)", () => {
    const tokens = tokenize("{{file.title | truncate:abc}}");
    expect(tokens[0]).toMatchObject({
      type: "var_escaped",
      path: "file.title",
      filters: [{ name: "unknown", raw: "truncate:abc" }],
    });
  });

  /**
   * TC-07: {{value | join:", "}} produces a join filter with the correct separator.
   */
  it('TC-07: {{value | join:", "}} → var_escaped with join:", " filter', () => {
    const tokens = tokenize('{{file.tags | join:", "}}');
    expect(tokens[0]).toMatchObject({
      type: "var_escaped",
      path: "file.tags",
      filters: [{ name: "join", sep: ", " }],
    });
  });

  /**
   * TC-08: {{#if expr}}body{{/if}} produces a block_if token with body tokens.
   */
  it("TC-08: {{#if expr}}body{{/if}} → block_if token", () => {
    const tokens = tokenize("{{#if file.title}}has title{{/if}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "block_if",
      expr: "file.title",
    });
    const ifToken = tokens[0] as { type: "block_if"; body: unknown[] };
    expect(ifToken.body).toHaveLength(1);
    expect(ifToken.body[0]).toMatchObject({ type: "text", value: "has title" });
  });

  /**
   * TC-09: {{#each collection}}body{{/each}} produces a block_each token.
   */
  it("TC-09: {{#each vault.files}}{{this.title}}{{/each}} → block_each token", () => {
    const tokens = tokenize("{{#each vault.files}}{{this.title}}{{/each}}");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "block_each", collection: "vault.files" });
  });

  /**
   * TC-10: {{#where}} produces a block_where token with field, op, value, and body.
   */
  it('TC-10: {{#where vault.files tags hasTag "project"}} → block_where', () => {
    const tokens = tokenize('{{#where vault.files tags hasTag "project"}}{{this.title}}{{/where}}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: "block_where",
      collection: "vault.files",
      field: "tags",
      op: "hasTag",
      value: "project",
    });
  });

  /**
   * TC-11: {{embed "path"}} produces an embed token.
   */
  it('TC-11: {{embed "path"}} → embed token', () => {
    const tokens = tokenize('{{embed "docs/note.md"}}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "embed", path: "docs/note.md" });
  });

  /**
   * TC-12: {{partial "name"}} produces a partial token.
   */
  it('TC-12: {{partial "header"}} → partial token', () => {
    const tokens = tokenize('{{partial "header"}}');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ type: "partial", path: "header" });
  });
});

// ── Path resolver ──────────────────────────────────────────────────────────────

describe("resolvePath", () => {
  /**
   * TC-13: A two-segment dot path resolves to the correct nested value.
   */
  it("TC-13: resolvePath(file.title, ctx) returns correct string", () => {
    expect(resolvePath("file.title", baseCtx)).toBe("Test");
  });

  /**
   * TC-14: A path with missing segments returns an empty string rather than
   * throwing (FR-13).
   */
  it("TC-14: missing path returns empty string", () => {
    expect(resolvePath("file.missing.deep", baseCtx)).toBe("");
    expect(resolvePath("nonexistent", baseCtx)).toBe("");
  });

  /**
   * TC-15: Nested YAML frontmatter object traversal works correctly.
   */
  it("TC-15: resolvePath(file.yaml.author, ctx) returns frontmatter value", () => {
    expect(resolvePath("file.yaml.author", baseCtx)).toBe("Dave");
  });

  /**
   * TC-16: "this" resolves to the value stored under the "this" key in context.
   */
  it('TC-16: resolvePath("this", {this: "hello"}) returns "hello"', () => {
    expect(resolvePath("this", { this: "hello" })).toBe("hello");
  });

  /**
   * TC-17: "@index" resolves correctly from a context object with that key.
   */
  it('TC-17: resolvePath("@index", {"@index": 0}) returns 0', () => {
    expect(resolvePath("@index", { "@index": 0 })).toBe(0);
  });
});

// ── HTML escaper ───────────────────────────────────────────────────────────────

describe("escape", () => {
  /**
   * TC-18: < and > are escaped to HTML entities.
   */
  it("TC-18: escapes < and > in a script tag", () => {
    expect(escape("<script>")).toBe("&lt;script&gt;");
  });

  /**
   * TC-19: & is escaped to &amp;
   */
  it("TC-19: escapes ampersand", () => {
    expect(escape("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escape('"quoted"')).toBe("&quot;quoted&quot;");
  });

  it("escapes single quotes", () => {
    expect(escape("it's")).toBe("it&#39;s");
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  /**
   * TC-20: The date filter returns a human-readable string for an ISO date string.
   */
  it("TC-20: date filter on ISO string returns human-readable date", () => {
    const result = applyFilters("2024-03-15T00:00:00.000Z", [{ name: "date" }]);
    // The result should be a date string, not the raw ISO value.
    expect(result).not.toBe("2024-03-15T00:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  /**
   * TC-21: The date filter accepts a numeric unix ms timestamp.
   */
  it("TC-21: date filter on unix ms returns human-readable date", () => {
    const result = applyFilters(1700000000000, [{ name: "date" }]);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  /**
   * TC-22: EC-20 — an invalid date value is returned as-is rather than
   * producing "Invalid Date".
   */
  it("TC-22: date filter on invalid value returns original (EC-20)", () => {
    const result = applyFilters("not-a-date", [{ name: "date" }]);
    expect(result).toBe("not-a-date");
  });

  /**
   * TC-23: upper filter converts string to uppercase.
   */
  it("TC-23: upper filter returns uppercase", () => {
    expect(applyFilters("hello", [{ name: "upper" }])).toBe("HELLO");
  });

  /**
   * TC-24: lower filter converts string to lowercase.
   */
  it("TC-24: lower filter returns lowercase", () => {
    expect(applyFilters("HELLO", [{ name: "lower" }])).toBe("hello");
  });

  /**
   * TC-25: truncate:5 on a string longer than 5 chars appends ellipsis.
   */
  it("TC-25: truncate:5 on 'hello world' returns 'hello…'", () => {
    expect(applyFilters("hello world", [{ name: "truncate", n: 5 }])).toBe("hello…");
  });

  /**
   * TC-26: truncate:20 on a short string returns the string unchanged.
   */
  it("TC-26: truncate:20 on 'short' returns 'short'", () => {
    expect(applyFilters("short", [{ name: "truncate", n: 20 }])).toBe("short");
  });

  /**
   * TC-27: join filter with ", " produces a comma-separated string.
   */
  it('TC-27: join:", " on array returns joined string', () => {
    expect(applyFilters(["a", "b", "c"], [{ name: "join", sep: ", " }])).toBe("a, b, c");
  });

  /**
   * TC-28: EC-12 — join on a non-array returns the stringified value.
   */
  it("TC-28: join on non-array returns stringified value (EC-12)", () => {
    const result = applyFilters("hello", [{ name: "join", sep: ", " }]);
    expect(result).toBe("hello");
  });

  /**
   * TC-29: An unknown filter returns a bracketed error string (FR-15, AC-15).
   */
  it("TC-29: unknown filter returns [unknown filter: X]", () => {
    const result = applyFilters("value", [{ name: "unknown", raw: "nonexistent" }]);
    expect(result).toBe("[unknown filter: nonexistent]");
  });
});

// ── Evaluator ─────────────────────────────────────────────────────────────────

describe("render", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  /**
   * TC-30: Double-brace {{var}} output is HTML-escaped (AC-13).
   */
  it("TC-30: double-brace output is HTML-escaped", async () => {
    const ctx = {
      ...baseCtx,
      file: { ...baseCtx.file, title: "<b>Bold</b>" },
    };
    const html = await render("{{file.title}}", ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  /**
   * TC-31: Triple-brace {{{var}}} output is NOT HTML-escaped (AC-13).
   */
  it("TC-31: triple-brace output is NOT escaped", async () => {
    const html = await render("{{{file.rendered}}}", baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("<p>body text</p>");
  });

  /**
   * TC-32: {{#if truthy}} renders the block body.
   */
  it("TC-32: {{#if truthy}} renders body", async () => {
    const html = await render("{{#if file.title}}has title{{/if}}", baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("has title");
  });

  /**
   * TC-33: {{#if falsy}} renders an empty string.
   */
  it("TC-33: {{#if falsy}} renders empty string", async () => {
    const ctx = { ...baseCtx, file: { ...baseCtx.file, title: "" } };
    const html = await render("{{#if file.title}}has title{{/if}}", ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).not.toContain("has title");
  });

  /**
   * TC-34: {{#each array}} renders one iteration per element (AC-16).
   */
  it("TC-34: #each array renders one item per element", async () => {
    const tmpl = "{{#each vault.files}}{{this.title}},{{/each}}";
    const html = await render(tmpl, baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("File A");
    expect(html).toContain("File B");
  });

  /**
   * TC-35: {{#each object}} iterates key-value pairs via @key and this.
   */
  it("TC-35: #each object renders key-value pairs", async () => {
    const tmpl = "{{#each file.yaml}}{{@key}}={{this}};{{/each}}";
    const html = await render(tmpl, baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("author=Dave");
  });

  /**
   * TC-36: EC-11 — {{#each nonArray}} renders nothing (non-iterable value).
   */
  it("TC-36: #each nonArray renders nothing (EC-11)", async () => {
    const ctx = { ...baseCtx, vault: { ...baseCtx.vault, files: null as unknown as [] } };
    const tmpl = "{{#each vault.files}}{{this.title}}{{/each}}";
    const html = await render(tmpl, ctx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html.trim()).toBe("");
  });

  /**
   * TC-37: {{#where}} with hasTag operator filters correctly (AC-17).
   */
  it('TC-37: #where hasTag "project" filters correctly', async () => {
    const tmpl = '{{#where vault.files tags hasTag "project"}}{{this.title}},{{/where}}';
    const html = await render(tmpl, baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("File A");
    expect(html).not.toContain("File B");
  });

  /**
   * TC-38: {{#where}} with neq operator excludes matching items.
   */
  it('TC-38: #where neq filters out matching', async () => {
    const tmpl = '{{#where vault.files title neq "File A"}}{{this.title}}{{/where}}';
    const html = await render(tmpl, baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).not.toContain("File A");
    expect(html).toContain("File B");
  });

  /**
   * TC-39: {{#where}} with contains operator matches substrings.
   */
  it('TC-39: #where contains operator matches substrings', async () => {
    const tmpl = '{{#where vault.files title contains "File"}}{{this.title}},{{/where}}';
    const html = await render(tmpl, baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("File A");
    expect(html).toContain("File B");
  });

  /**
   * TC-40: {{embed}} reads a file via invoke and inlines the rendered HTML (AC-18).
   */
  it("TC-40: {{embed}} inlines rendered HTML", async () => {
    mockInvoke.mockResolvedValueOnce("# Heading");
    const html = await render('{{embed "docs/note.md"}}', baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("<p># Heading</p>");
  });

  /**
   * TC-41: {{embed}} on a missing file renders an error span (AC-18).
   */
  it("TC-41: {{embed}} on missing file renders error span", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("not found"));
    const html = await render('{{embed "missing.md"}}', baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("layout-error");
  });

  /**
   * TC-42: {{partial}} renders the sub-template with the full context.
   */
  it("TC-42: {{partial}} renders sub-template with context", async () => {
    mockInvoke.mockResolvedValueOnce("{{file.title}}");
    const html = await render('{{partial "header"}}', baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("Test");
  });

  /**
   * TC-43: {{partial}} at depth 3 renders a depth-limit comment rather than
   * recursing infinitely (AC-19).
   */
  it("TC-43: {{partial}} at depth 3 renders depth-limit comment", async () => {
    mockInvoke.mockResolvedValue("{{partial \"a\"}}");
    // Depth 2 means one more partial will reach depth 3 — the limit.
    const html = await render('{{partial "a"}}', baseCtx, 2, "/v", mockInvoke, mockRenderMd);
    expect(html).toContain("partial depth limit");
  });

  /**
   * TC-44: <script> tags in the rendered output are stripped before use (AC-20).
   */
  it("TC-44: <script> tags are stripped from output", () => {
    const rawHtml = stripScripts("<div><script>alert(1)</script>Safe</div>");
    expect(rawHtml).not.toContain("<script>");
    expect(rawHtml).toContain("Safe");
  });

  /**
   * TC-45: EC-10 — an object value in a double-brace expression is
   * serialised via JSON.stringify rather than [object Object].
   */
  it("TC-45: object value in double-brace is JSON-stringified (EC-10)", async () => {
    const html = await render("{{file.yaml}}", baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    // The YAML object should appear as a JSON string, not [object Object]
    expect(html).toContain("{");
    expect(html).not.toContain("[object Object]");
  });

  /**
   * TC-46: EC-08 — A→B→A cycle hits the depth limit at depth 3 and stops
   * recursing. The depth limit comment appears in the output.
   */
  it("TC-46: EC-08 — recursive partial cycle hits depth limit at depth 3", async () => {
    // Every invoke call returns a template that includes itself — simulating A→A recursion.
    mockInvoke.mockResolvedValue("{{partial \"self\"}}");
    const html = await render('{{partial "self"}}', baseCtx, 0, "/v", mockInvoke, mockRenderMd);
    // The depth limit comment must appear somewhere in the chain output.
    expect(html).toContain("partial depth limit");
  });
});

// ── wireDataPathListeners ──────────────────────────────────────────────────────

describe("wireDataPathListeners", () => {
  /**
   * AC-21: Elements with a data-path attribute get click handlers that call
   * window.__MARKABLE_TAB_MANAGER__.openFileInTab(path).
   */
  it("AC-21: data-path elements get click handlers targeting the tab manager", () => {
    const mockTM = { openFileInTab: vi.fn() };
    (window as unknown as Record<string, unknown>)["__MARKABLE_TAB_MANAGER__"] = mockTM;

    const container = document.createElement("div");
    container.innerHTML = '<a data-path="/v/file.md">File</a>';
    wireDataPathListeners(container);
    (container.querySelector("[data-path]") as HTMLElement).dispatchEvent(new MouseEvent("click"));
    expect(mockTM.openFileInTab).toHaveBeenCalledWith("/v/file.md");
  });
});

// ── buildContext ────────────────────────────────────────────────────────────────

describe("buildContext", () => {
  /**
   * buildContext() assembles a TemplateContext from raw vault and meta data.
   */
  it("preserves file data passed in", () => {
    const file = {
      title: "My Note",
      content: "body",
      rendered: "<p>body</p>",
      tags: ["a"],
      yaml: {},
      path: "/v/note.md",
      name: "note",
      modified: 0,
      toc: [],
    };
    const vault = { name: "V", files: [], directories: [] };
    const meta = { tags: [], fields: {} };
    const ctx = buildContext(file, vault, meta);
    expect(ctx.file?.title).toBe("My Note");
    expect(ctx.vault.name).toBe("V");
  });

  it("allows null file for collection layouts", () => {
    const vault = { name: "V", files: [], directories: [] };
    const meta = { tags: [], fields: {} };
    const ctx = buildContext(null, vault, meta);
    expect(ctx.file).toBeNull();
  });
});
