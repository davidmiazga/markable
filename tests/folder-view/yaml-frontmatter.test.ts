/**
 * tests/folder-view/yaml-frontmatter.test.ts
 *
 * Unit tests for the line-oriented YAML frontmatter parser and writer.
 *
 * Covers FR-6, EC-08 through EC-24.
 */

import { describe, it, expect } from "vitest";
import {
  parseYamlFrontmatter,
  applyYamlKey,
  removeYamlKey,
  reconstructFile,
} from "../../src/plugins/file-browser/folder-view/yaml-frontmatter";

// ── parseYamlFrontmatter ──────────────────────────────────────────────────────

describe("parseYamlFrontmatter", () => {
  it("P-01: file with frontmatter and body", () => {
    const result = parseYamlFrontmatter("---\ntitle: hello\n---\nBody text");
    expect(result.hasFrontmatter).toBe(true);
    expect(result.malformed).toBe(false);
    expect(result.frontmatterLines).toEqual(["title: hello"]);
    expect(result.bodyLines).toEqual(["Body text"]);
  });

  it("P-02: file with no frontmatter returns hasFrontmatter:false", () => {
    const result = parseYamlFrontmatter("Just content");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.malformed).toBe(false);
    expect(result.bodyLines).toEqual(["Just content"]);
    expect(result.frontmatterLines).toEqual([]);
  });

  it("P-03: file with empty frontmatter block", () => {
    const result = parseYamlFrontmatter("---\n---\nBody");
    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatterLines).toEqual([]);
    expect(result.bodyLines).toEqual(["Body"]);
  });

  it("P-04: malformed — opening --- with no closing ---", () => {
    const result = parseYamlFrontmatter("---\ntitle: x");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.malformed).toBe(true);
  });

  it("P-05: value containing --- does NOT close block (EC-24)", () => {
    const result = parseYamlFrontmatter('---\nkey: "--- not a delim"\n---\nbody');
    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatterLines).toEqual(['key: "--- not a delim"']);
    expect(result.bodyLines).toEqual(["body"]);
  });

  it("P-06: multiple key lines are all preserved", () => {
    const result = parseYamlFrontmatter("---\na: 1\nb: 2\nc: 3\n---\n");
    expect(result.hasFrontmatter).toBe(true);
    expect(result.frontmatterLines).toEqual(["a: 1", "b: 2", "c: 3"]);
  });

  it("P-07: empty string file", () => {
    const result = parseYamlFrontmatter("");
    expect(result.hasFrontmatter).toBe(false);
    expect(result.malformed).toBe(false);
    expect(result.bodyLines).toEqual([""]);
  });

  it("P-08: body begins immediately after closing ---", () => {
    const result = parseYamlFrontmatter("---\nk: v\n---\nLine1\nLine2");
    expect(result.bodyLines).toEqual(["Line1", "Line2"]);
  });
});

// ── applyYamlKey ─────────────────────────────────────────────────────────────

describe("applyYamlKey", () => {
  it("A-01: adds new key when not present", () => {
    const result = applyYamlKey([], "status", "done");
    expect(result).toEqual(["status: done"]);
  });

  it("A-02: updates existing key", () => {
    const result = applyYamlKey(["status: old"], "status", "new");
    expect(result).toEqual(["status: new"]);
  });

  it("A-03: value with colon is double-quoted (EC-13)", () => {
    const result = applyYamlKey([], "desc", "foo: bar");
    expect(result[0]).toBe('desc: "foo: bar"');
  });

  it("A-04: value with leading whitespace is double-quoted (EC-13)", () => {
    const result = applyYamlKey([], "x", " padded");
    expect(result[0]).toMatch(/^x: "/);
  });

  it("A-05: value with trailing whitespace is double-quoted", () => {
    const result = applyYamlKey([], "x", "padded ");
    expect(result[0]).toMatch(/^x: "/);
  });

  it("A-06: value containing --- receives quoting (EC-24)", () => {
    // A value that starts with "---" must be double-quoted to prevent ambiguity
    // when the reconstructed file is re-parsed by another YAML tool. The
    // needsQuoting predicate includes value.startsWith("---") for this reason.
    const result = applyYamlKey([], "key", "--- heading");
    expect(result[0]).toBe('key: "--- heading"');
  });

  it("A-07: normal value without colon or whitespace is not quoted", () => {
    const result = applyYamlKey([], "key", "active");
    expect(result[0]).toBe("key: active");
  });

  it("A-08: does not mutate the input array", () => {
    const input = ["a: 1"];
    applyYamlKey(input, "b", "2");
    expect(input).toHaveLength(1);
    expect(input[0]).toBe("a: 1");
  });

  it("A-09: existing double-quote in value is escaped", () => {
    // The value `say "hi"` contains no colon or whitespace, but does contain a quote.
    // It won't be auto-quoted by whitespace/colon rules. However, if it were quoted,
    // the inner quote must be escaped.
    // Actually per the spec: "say \"hi\"" contains no colon or leading/trailing whitespace
    // so it is NOT auto-quoted. But if we test a colon-bearing value with quotes:
    const result = applyYamlKey([], "key", 'foo: say "hi"');
    // Has colon → quoted; inner quote must be escaped
    expect(result[0]).toBe('key: "foo: say \\"hi\\""');
  });
});

// ── removeYamlKey ─────────────────────────────────────────────────────────────

describe("removeYamlKey", () => {
  it("R-01: removes an existing key", () => {
    const result = removeYamlKey(["status: done", "title: x"], "status");
    expect(result).toEqual(["title: x"]);
  });

  it("R-02: key absent — no error, returns copy unchanged (EC-09)", () => {
    const result = removeYamlKey(["title: x"], "status");
    expect(result).toEqual(["title: x"]);
  });

  it("R-03: does not mutate the input array", () => {
    const input = ["a: 1", "b: 2"];
    removeYamlKey(input, "a");
    expect(input).toHaveLength(2);
  });

  it("R-04: removes only the exact key, not partial matches", () => {
    // "a" must not match "a-extra"
    const result = removeYamlKey(["a: 1", "b: 2", "a-extra: 3"], "a");
    expect(result).toEqual(["b: 2", "a-extra: 3"]);
  });
});

// ── reconstructFile ───────────────────────────────────────────────────────────

describe("reconstructFile", () => {
  it("RC-01: roundtrip — parse then reconstruct preserves content", () => {
    const original = "---\ntitle: x\n---\nBody\n";
    const parsed = parseYamlFrontmatter(original);
    const result = reconstructFile(parsed);
    expect(result).toBe(original);
  });

  it("RC-02: empty frontmatter block is removed (EC-23)", () => {
    const result = reconstructFile({
      hasFrontmatter: true,
      frontmatterLines: [],
      bodyLines: ["Body"],
    });
    expect(result).toBe("Body");
  });

  it("RC-03: no frontmatter — body returned as-is", () => {
    const result = reconstructFile({
      hasFrontmatter: false,
      frontmatterLines: [],
      bodyLines: ["Hello"],
    });
    expect(result).toBe("Hello");
  });

  it("RC-04: non-.md file (no frontmatter) roundtrips cleanly", () => {
    const content = "plain text file";
    const parsed = parseYamlFrontmatter(content);
    const result = reconstructFile(parsed);
    expect(result).toBe(content);
  });
});
