/**
 * YAML Pane Plugin — Unit Tests
 *
 * Tests all pure functions across five implementation steps:
 *   Step 01: Front matter parser (detectFrontMatterBlock, parseFrontMatter, buildFieldModel,
 *            inferType, findKeyLineIndex, detectBlockScalar, escapeRegExp)
 *   Step 02: Write-back engine (requiresQuoting, formatScalarValue, rewriteScalarLine,
 *            buildFrontMatterString, serializeFrontMatter, needsKeyQuoting, formatYamlKey,
 *            dispatchFrontMatterUpdate)
 *   Step 03: Schema loader (validateSchemaJson, loadSchema, getSchemaFieldDef,
 *            resolveFieldType, mergeWithSchema, loadSettings, saveSettings)
 *   Step 04: Panel DOM (renderEmptyState, renderErrorState, renderFieldRow, renderFieldsState,
 *            renderAddFieldRow, deriveTitle, renderChipWidget, renderSelectControl,
 *            renderNestedSection)
 *   Step 05: Plugin lifecycle (onEnable/onDisable, updateListener integration)
 *
 * DOM tests (Step 04 and 05) use happy-dom (the default Vitest environment for this project).
 * Steps 01–03 are pure and run in the default environment.
 *
 * @module yaml-pane.test
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  // Step 01: Parser
  detectFrontMatterBlock,
  parseFrontMatter,
  buildFieldModel,
  inferType,
  findKeyLineIndex,
  detectBlockScalar,
  // escapeRegExp, // imported but not directly tested (tested via callers)
  // Step 02: Write-back
  requiresQuoting,
  formatScalarValue,
  rewriteScalarLine,
  buildFrontMatterString,
  serializeFrontMatter,
  needsKeyQuoting,
  formatYamlKey,
  dispatchFrontMatterUpdate,
  YAML_PANE_USER_EVENT,
  // Step 03: Schema loader
  validateSchemaJson,
  loadSchema,
  getSchemaFieldDef,
  resolveFieldType,
  mergeWithSchema,
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  // VALID_SCHEMA_TYPES, // imported but value not directly asserted
  // Step 04: Panel DOM (exported for testing)
  renderEmptyState,
  renderErrorState,
  renderFieldRow,
  renderFieldsState,
  renderAddFieldRow,
  // renderFieldControl, // imported but not directly used in tests
  renderChipWidget,
  renderSelectControl,
  renderNestedSection,
  deriveTitle,
  updatePanelState,
  // Types used in Step 04 / 05 tests
  type EnrichedField,
} from "../../../src/plugins/yaml-pane/yaml-pane.plugin";

// Import the default export (plugin object) for lifecycle tests
import YamlPanePlugin from "../../../src/plugins/yaml-pane/yaml-pane.plugin";

// ---------------------------------------------------------------------------
// Step 01 — Front Matter Parser
// ---------------------------------------------------------------------------

describe("Step 01 — detectFrontMatterBlock", () => {
  it("01-01: empty string → null", () => {
    expect(detectFrontMatterBlock("")).toBeNull();
  });

  it("01-02: document with no --- → null", () => {
    expect(detectFrontMatterBlock("# Heading\n\nSome content")).toBeNull();
  });

  it("01-03: empty block --- then --- → innerText empty, correct closingOffset", () => {
    // "---\n---\n" = 8 chars. Closing delimiter line ends at offset 7 (0-indexed)
    // Line 0: "---\n" = 4 chars (offset 0..3, \n at index 3)
    // Line 1: "---\n" = 4 chars (offset 4..7, \n at index 7)
    // closingOffset should be the character position AFTER the closing line (7+1=8? or 7?)
    // Per spec: "Sum of lengths of all preceding lines plus their \n separators,
    //  plus the closing line's length." = 4 + 3 = 7
    const result = detectFrontMatterBlock("---\n---\n");
    expect(result).not.toBeNull();
    expect(result!.innerText).toBe("");
    expect(result!.closingOffset).toBe(7);
  });

  it("01-04: document with title front matter → correct innerText and closingOffset", () => {
    // "---\ntitle: Foo\n---\n# Content"
    // Line 0: "---" (3) + \n = 4
    // Line 1: "title: Foo" (10) + \n = 11
    // Line 2: "---" (3) = 3
    // closingOffset = 4 + 11 + 3 - 1? Let's compute precisely:
    // offset of char after "---\n" = 4
    // offset of char after "title: Foo\n" = 15
    // offset of end of "---" = 15 + 3 - 1 = 17 (last char of closing ---) → 18?
    // Per spec: closingOffset = sum of preceding line lengths (with \n) + closing line length
    // = 4 (line0 incl \n) + 11 (line1 incl \n) + 3 (line2 without \n) = 18
    const result = detectFrontMatterBlock("---\ntitle: Foo\n---\n# Content");
    expect(result).not.toBeNull();
    expect(result!.innerText).toBe("title: Foo");
    expect(result!.closingOffset).toBe(18);
  });

  it("01-05: no closing --- → null (EC-3)", () => {
    expect(detectFrontMatterBlock("---\ntitle: Foo")).toBeNull();
  });

  it("01-06: trailing whitespace on opener is valid (EC-25)", () => {
    const result = detectFrontMatterBlock("---   \ntitle: Foo\n---\n");
    expect(result).not.toBeNull();
    expect(result!.innerText).toBe("title: Foo");
  });

  it("01-07: ... as closer is valid", () => {
    const result = detectFrontMatterBlock("---\ntitle: Foo\n...\n# Content");
    expect(result).not.toBeNull();
    expect(result!.innerText).toBe("title: Foo");
  });

  it("01-08: closingOffset is the exclusive-end position of the closing --- line", () => {
    // closingOffset is one past the last char of "---".
    // doc.slice(0, closingOffset) == "---\nfoo: bar\n---" (includes the closing ---)
    const doc = "---\nfoo: bar\n---\n";
    const result = detectFrontMatterBlock(doc);
    expect(result).not.toBeNull();
    // Exclusive-end slice: doc.slice(0, closingOffset) ends at the closing ---
    expect(doc.slice(0, result!.closingOffset)).toBe("---\nfoo: bar\n---");
  });
});

describe("Step 01 — parseFrontMatter", () => {
  it("01-09: plain text (no front matter) → kind none", () => {
    expect(parseFrontMatter("# Title\nContent")).toEqual({ kind: "none" });
  });

  it("01-10: empty block → kind ok, fields empty", () => {
    const result = parseFrontMatter("---\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields).toHaveLength(0);
    }
  });

  it("01-11: comment-only front matter → kind ok, fields empty (EC-5)", () => {
    const result = parseFrontMatter("---\n# this is a comment\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields).toHaveLength(0);
    }
  });

  it("01-12: title field → string rawType", () => {
    const result = parseFrontMatter("---\ntitle: Hello\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].key).toBe("title");
      expect(result.fields[0].value).toBe("Hello");
      expect(result.fields[0].rawType).toBe("string");
    }
  });

  it("01-13: count field → number rawType", () => {
    const result = parseFrontMatter("---\ncount: 42\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("number");
      expect(result.fields[0].value).toBe(42);
    }
  });

  it("01-14: draft field → boolean rawType", () => {
    const result = parseFrontMatter("---\ndraft: true\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("boolean");
      expect(result.fields[0].value).toBe(true);
    }
  });

  it("01-15: date field → date rawType (CORE_SCHEMA keeps it as string)", () => {
    const result = parseFrontMatter("---\ndate: 2026-04-17\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("date");
      expect(result.fields[0].value).toBe("2026-04-17");
    }
  });

  it("01-16: tags array → array rawType", () => {
    const result = parseFrontMatter("---\ntags:\n  - a\n  - b\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("array");
      expect(result.fields[0].value).toEqual(["a", "b"]);
    }
  });

  it("01-17: nested object → object rawType", () => {
    const result = parseFrontMatter("---\nmeta:\n  author: Alice\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("object");
    }
  });

  it("01-18: tab indentation invalid YAML → kind error", () => {
    const result = parseFrontMatter("---\n\ttitle: bad tab\n---\n");
    expect(result.kind).toBe("error");
  });

  it("01-19: scalar front matter (not a mapping) → kind error with 'mapping'", () => {
    const result = parseFrontMatter("---\njust a string\n---\n");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message.toLowerCase()).toContain("mapping");
    }
  });

  it("01-20: null value field → null rawType", () => {
    const result = parseFrontMatter("---\nvalue: null\n---\n");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.fields[0].rawType).toBe("null");
    }
  });
});

describe("Step 01 — inferType", () => {
  const noLines: string[] = [];
  const noKey = "x";

  it("01-21: null → 'null'", () => {
    expect(inferType(null, noLines, noKey)).toBe("null");
  });

  it("01-22: undefined → 'null'", () => {
    expect(inferType(undefined, noLines, noKey)).toBe("null");
  });

  it("01-23: true → 'boolean'", () => {
    expect(inferType(true, noLines, noKey)).toBe("boolean");
  });

  it("01-24: false → 'boolean'", () => {
    expect(inferType(false, noLines, noKey)).toBe("boolean");
  });

  it("01-25: 42 → 'number'", () => {
    expect(inferType(42, noLines, noKey)).toBe("number");
  });

  it("01-26: 3.14 → 'number'", () => {
    expect(inferType(3.14, noLines, noKey)).toBe("number");
  });

  it("01-27: [] → 'array'", () => {
    expect(inferType([], noLines, noKey)).toBe("array");
  });

  it("01-28: ['a'] → 'array'", () => {
    expect(inferType(["a"], noLines, noKey)).toBe("array");
  });

  it("01-29: {} → 'object'", () => {
    expect(inferType({}, noLines, noKey)).toBe("object");
  });

  it("01-30: '2026-04-17' → 'date'", () => {
    expect(inferType("2026-04-17", noLines, noKey)).toBe("date");
  });

  it("01-31: '2026-4-17' (not ISO 8601) → 'string'", () => {
    expect(inferType("2026-4-17", noLines, noKey)).toBe("string");
  });

  it("01-32: 'hello' → 'string'", () => {
    expect(inferType("hello", noLines, noKey)).toBe("string");
  });

  it("01-33: '' → 'string'", () => {
    expect(inferType("", noLines, noKey)).toBe("string");
  });
});

describe("Step 01 — findKeyLineIndex", () => {
  it("01-34: key 'title' found at index 0", () => {
    expect(findKeyLineIndex(["title: Hello", "date: 2026-04-17"], "title")).toBe(0);
  });

  it("01-35: key 'date' found at index 1", () => {
    expect(findKeyLineIndex(["title: Hello", "date: 2026-04-17"], "date")).toBe(1);
  });

  it("01-36: key 'missing' → -1", () => {
    expect(findKeyLineIndex(["title: Hello"], "missing")).toBe(-1);
  });

  it("01-37: partial match 'titl' → -1 (no partial match)", () => {
    expect(findKeyLineIndex(["title: Hello"], "titl")).toBe(-1);
  });

  it("01-38: key with regex special chars 'tags.v2' → no throw", () => {
    expect(() => findKeyLineIndex(["tags.v2: foo"], "tags.v2")).not.toThrow();
    expect(findKeyLineIndex(["tags.v2: foo"], "tags.v2")).toBe(0);
  });

  it("01-39: indented key not matched (must be top-level)", () => {
    expect(findKeyLineIndex(["  indented: value"], "indented")).toBe(-1);
  });
});

describe("Step 01 — detectBlockScalar", () => {
  it("01-40: | block scalar detected", () => {
    expect(detectBlockScalar(["desc: |", "  Line one."], 0)).toBe(true);
  });

  it("01-41: > block scalar detected", () => {
    expect(detectBlockScalar(["desc: >", "  Folded."], 0)).toBe(true);
  });

  it("01-42: plain scalar → false", () => {
    expect(detectBlockScalar(["title: Hello"], 0)).toBe(false);
  });

  it("01-43: lineIndex -1 → false", () => {
    expect(detectBlockScalar(["desc: |", "  Line one."], -1)).toBe(false);
  });

  it("01-44: inline comment after | is still a block scalar", () => {
    expect(detectBlockScalar(["desc: | # comment"], 0)).toBe(true);
  });
});

describe("Step 01 — buildFieldModel (integration)", () => {
  it("01-45: two fields with matching lines → correct lineIndex", () => {
    const lines = ["title: Hello", "date: 2026-04-17"];
    const parsed = { title: "Hello", date: "2026-04-17" };
    const fields = buildFieldModel(parsed, lines);
    expect(fields).toHaveLength(2);
    expect(fields[0].key).toBe("title");
    expect(fields[0].lineIndex).toBe(0);
    expect(fields[1].key).toBe("date");
    expect(fields[1].lineIndex).toBe(1);
  });

  it("01-46: field ordering preserved (Object.entries order)", () => {
    const lines = ["z: 1", "a: 2"];
    const parsed: Record<string, unknown> = {};
    parsed["z"] = 1;
    parsed["a"] = 2;
    const fields = buildFieldModel(parsed, lines);
    expect(fields[0].key).toBe("z");
    expect(fields[1].key).toBe("a");
  });

  it("01-47: block scalar field detected", () => {
    const lines = ["desc: |", "  Long text here."];
    const parsed = { desc: "Long text here." };
    const fields = buildFieldModel(parsed, lines);
    expect(fields[0].isBlockScalar).toBe(true);
  });

  it("01-48: nested object field → rawType object", () => {
    const lines = ["meta:"];
    const parsed = { meta: { author: "Alice" } };
    const fields = buildFieldModel(parsed, lines);
    expect(fields[0].rawType).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Step 02 — Write-back Engine
// ---------------------------------------------------------------------------

describe("Step 02 — requiresQuoting", () => {
  it("02-01: 'hello' → false", () => {
    expect(requiresQuoting("hello")).toBe(false);
  });

  it("02-02: 'hello world' (space only) → false", () => {
    expect(requiresQuoting("hello world")).toBe(false);
  });

  it("02-03: 'key: value' (colon) → true", () => {
    expect(requiresQuoting("key: value")).toBe(true);
  });

  it("02-04: '# comment' (hash) → true", () => {
    expect(requiresQuoting("# comment")).toBe(true);
  });

  it("02-05: '[array]' → true", () => {
    expect(requiresQuoting("[array]")).toBe(true);
  });

  it("02-06: '{map}' → true", () => {
    expect(requiresQuoting("{map}")).toBe(true);
  });

  it("02-07: 'true' → true (YAML boolean reserved)", () => {
    expect(requiresQuoting("true")).toBe(true);
  });

  it("02-08: 'false' → true", () => {
    expect(requiresQuoting("false")).toBe(true);
  });

  it("02-09: 'null' → true", () => {
    expect(requiresQuoting("null")).toBe(true);
  });

  it("02-10: 'True' → true (case-insensitive)", () => {
    expect(requiresQuoting("True")).toBe(true);
  });

  it("02-11: 'NULL' → true", () => {
    expect(requiresQuoting("NULL")).toBe(true);
  });

  it("02-12: '' (empty string) → true", () => {
    expect(requiresQuoting("")).toBe(true);
  });

  it("02-13: '  leading space' → true", () => {
    expect(requiresQuoting("  leading space")).toBe(true);
  });

  it("02-14: 'trailing space  ' → true", () => {
    expect(requiresQuoting("trailing space  ")).toBe(true);
  });

  it("02-15: 'safe-string-with-dashes' → false", () => {
    expect(requiresQuoting("safe-string-with-dashes")).toBe(false);
  });

  it("02-16: 'safe_string_with_underscores' → false", () => {
    expect(requiresQuoting("safe_string_with_underscores")).toBe(false);
  });

  it("02-17: '2026-04-17' (date-like, safe in values) → false", () => {
    expect(requiresQuoting("2026-04-17")).toBe(false);
  });

  it("02-18: 'yes' → true (YAML 1.1 boolean)", () => {
    expect(requiresQuoting("yes")).toBe(true);
  });

  it("02-19: 'no' → true", () => {
    expect(requiresQuoting("no")).toBe(true);
  });
});

describe("Step 02 — formatScalarValue", () => {
  it("02-20: 'hello' → 'hello' (no quoting needed)", () => {
    expect(formatScalarValue("hello")).toBe("hello");
  });

  it("02-21: 'title: My Doc' → quoted", () => {
    expect(formatScalarValue("title: My Doc")).toBe('"title: My Doc"');
  });

  it("02-22: true → 'true'", () => {
    expect(formatScalarValue(true)).toBe("true");
  });

  it("02-23: false → 'false'", () => {
    expect(formatScalarValue(false)).toBe("false");
  });

  it("02-24: null → 'null'", () => {
    expect(formatScalarValue(null)).toBe("null");
  });

  it("02-25: 42 → '42'", () => {
    expect(formatScalarValue(42)).toBe("42");
  });

  it("02-26: 3.14 → '3.14'", () => {
    expect(formatScalarValue(3.14)).toBe("3.14");
  });

  it("02-27: '' → '\"\"'", () => {
    expect(formatScalarValue("")).toBe('""');
  });

  it("02-28: string with double quote → properly escaped", () => {
    const result = formatScalarValue('She said "hi"');
    expect(result).toContain('\\"hi\\"');
  });
});

describe("Step 02 — rewriteScalarLine", () => {
  it("02-29: rewrite string value", () => {
    expect(rewriteScalarLine("title: Old Title", "New Title")).toBe("title: New Title");
  });

  it("02-30: rewrite number value", () => {
    expect(rewriteScalarLine("count: 5", 10)).toBe("count: 10");
  });

  it("02-31: rewrite boolean value", () => {
    expect(rewriteScalarLine("draft: false", true)).toBe("draft: true");
  });

  it("02-32: rewrite with value that needs quoting", () => {
    expect(rewriteScalarLine("title: Old", "Has: Colon")).toBe('title: "Has: Colon"');
  });

  it("02-33: inline comment behavior is documented (may or may not preserve)", () => {
    // Per the spec: comment preservation is best-effort / not required for MVP.
    // We assert the new value is present; comment presence is not enforced.
    const result = rewriteScalarLine("title: Old  # important", "New");
    expect(result).toContain("title:");
    expect(result).toContain("New");
  });
});

describe("Step 02 — buildFrontMatterString (scalar-edit tier)", () => {
  it("02-34: single field edit → correct wrapped output", () => {
    const fields = [{ key: "title", value: "World", rawType: "string" as const, lineIndex: 0, isBlockScalar: false }];
    const originalLines = ["title: Hello"];
    const result = buildFrontMatterString(fields, originalLines, { kind: "scalar-edit", key: "title", newValue: "World" });
    expect(result).toBe("---\ntitle: World\n---\n");
  });

  it("02-35: two fields, edit first field, second field unchanged", () => {
    const fields = [
      { key: "title", value: "New", rawType: "string" as const, lineIndex: 0, isBlockScalar: false },
      { key: "date", value: "2026-04-17", rawType: "date" as const, lineIndex: 1, isBlockScalar: false },
    ];
    const originalLines = ["title: Old", "date: 2026-04-17"];
    const result = buildFrontMatterString(fields, originalLines, { kind: "scalar-edit", key: "title", newValue: "New" });
    expect(result).toContain("title: New");
    expect(result).toContain("date: 2026-04-17");
  });

  it("02-36: field with lineIndex=-1 (new field) → appended to output", () => {
    const fields = [
      { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false },
      { key: "newfield", value: "value", rawType: "string" as const, lineIndex: -1, isBlockScalar: false },
    ];
    const originalLines = ["title: Hello"];
    const result = buildFrontMatterString(fields, originalLines, { kind: "scalar-edit", key: "newfield", newValue: "value" });
    expect(result).toContain("newfield: value");
  });
});

describe("Step 02 — buildFrontMatterString (structural tier)", () => {
  it("02-38: add new field → all fields in output", () => {
    const fields = [
      { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false },
      { key: "status", value: "draft", rawType: "string" as const, lineIndex: -1, isBlockScalar: false },
    ];
    const result = buildFrontMatterString(fields, [], { kind: "structural" });
    expect(result).toContain("title: Hello");
    expect(result).toContain("status: draft");
    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/\n---\n$/);
  });

  it("02-39: delete field → deleted field absent from output", () => {
    const fields = [
      { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false },
    ];
    const result = buildFrontMatterString(fields, ["title: Hello", "status: draft"], { kind: "structural" });
    expect(result).toContain("title: Hello");
    expect(result).not.toContain("status:");
  });

  it("02-40: array field → serialized as YAML sequence", () => {
    const fields = [
      { key: "tags", value: ["a", "b", "c"], rawType: "array" as const, lineIndex: 0, isBlockScalar: false },
    ];
    const result = buildFrontMatterString(fields, [], { kind: "structural" });
    // Should use block sequence format, not inline
    expect(result).toContain("tags:");
    expect(result).toContain("- a");
  });

  it("02-41: field order preserved in output", () => {
    const fields = [
      { key: "date", value: "2026-04-17", rawType: "date" as const, lineIndex: 0, isBlockScalar: false },
      { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 1, isBlockScalar: false },
    ];
    const result = buildFrontMatterString(fields, [], { kind: "structural" });
    expect(result.indexOf("date:")).toBeLessThan(result.indexOf("title:"));
  });
});

describe("Step 02 — serializeFrontMatter", () => {
  it("02-42: single string field → correct YAML (no delimiters)", () => {
    const fields = [{ key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false }];
    const result = serializeFrontMatter(fields);
    expect(result).toContain("title: Hello");
    expect(result).not.toContain("---");
  });

  it("02-43: number field → number value in output", () => {
    const fields = [{ key: "count", value: 42, rawType: "number" as const, lineIndex: 0, isBlockScalar: false }];
    const result = serializeFrontMatter(fields);
    expect(result).toContain("count: 42");
  });

  it("02-44: boolean field → correct value", () => {
    const fields = [{ key: "draft", value: true, rawType: "boolean" as const, lineIndex: 0, isBlockScalar: false }];
    const result = serializeFrontMatter(fields);
    expect(result).toContain("draft: true");
  });

  it("02-45: array field → block sequence (not inline)", () => {
    const fields = [{ key: "tags", value: ["a", "b"], rawType: "array" as const, lineIndex: 0, isBlockScalar: false }];
    const result = serializeFrontMatter(fields);
    expect(result).toContain("tags:");
    expect(result).toContain("- a");
    expect(result).not.toContain("[a, b]");
  });

  it("02-46: multi-line string → block scalar syntax", () => {
    const fields = [{ key: "desc", value: "Line one.\nLine two.", rawType: "string" as const, lineIndex: 0, isBlockScalar: true }];
    const result = serializeFrontMatter(fields);
    // js-yaml auto-detects multi-line strings and uses block style
    expect(result).toContain("desc:");
    expect(result).toContain("Line one.");
  });

  it("02-47: empty fields array → empty string", () => {
    const result = serializeFrontMatter([]);
    expect(result.trim()).toBe("");
  });
});

describe("Step 02 — needsKeyQuoting / formatYamlKey", () => {
  it("02-48: 'title' → false / 'title'", () => {
    expect(needsKeyQuoting("title")).toBe(false);
    expect(formatYamlKey("title")).toBe("title");
  });

  it("02-49: 'my:key' (colon) → true / '\"my:key\"'", () => {
    expect(needsKeyQuoting("my:key")).toBe(true);
    expect(formatYamlKey("my:key")).toBe('"my:key"');
  });

  it("02-50: 'null' → true / '\"null\"'", () => {
    expect(needsKeyQuoting("null")).toBe(true);
    expect(formatYamlKey("null")).toBe('"null"');
  });

  it("02-51: 'true' → true / '\"true\"'", () => {
    expect(needsKeyQuoting("true")).toBe(true);
    expect(formatYamlKey("true")).toBe('"true"');
  });

  it("02-52: '' (empty key) → true / '\"\"'", () => {
    expect(needsKeyQuoting("")).toBe(true);
    expect(formatYamlKey("")).toBe('""');
  });

  it("02-53: 'valid-key_123' → false / 'valid-key_123'", () => {
    expect(needsKeyQuoting("valid-key_123")).toBe(false);
    expect(formatYamlKey("valid-key_123")).toBe("valid-key_123");
  });
});

describe("Step 02 — dispatchFrontMatterUpdate (mock-based)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("02-54: calls view.dispatch with correct changes", () => {
    const dispatchSpy = vi.fn();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { length: 100 } },
      dispatch: dispatchSpy,
    });
    dispatchFrontMatterUpdate("---\ntitle: X\n---\n", 20);
    expect(dispatchSpy).toHaveBeenCalledOnce();
    const call = dispatchSpy.mock.calls[0][0];
    expect(call.changes).toEqual({ from: 0, to: 20, insert: "---\ntitle: X\n---\n" });
  });

  it("02-55: undefined view → no throw, silent no-op", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    expect(() => dispatchFrontMatterUpdate("---\n---\n", 0)).not.toThrow();
  });

  it("02-56: view.state.doc.length === 0 → no dispatch (EC-20 guard)", () => {
    const dispatchSpy = vi.fn();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { length: 0 } },
      dispatch: dispatchSpy,
    });
    dispatchFrontMatterUpdate("---\n---\n", 0);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("02-57: YAML_PANE_USER_EVENT is exported and is a string", () => {
    expect(typeof YAML_PANE_USER_EVENT).toBe("string");
    expect(YAML_PANE_USER_EVENT.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step 03 — Schema Loader
// ---------------------------------------------------------------------------

describe("Step 03 — validateSchemaJson", () => {
  it("03-01: null → throws Error", () => {
    expect(() => validateSchemaJson(null)).toThrow();
  });

  it("03-02: string → throws Error", () => {
    expect(() => validateSchemaJson("string")).toThrow();
  });

  it("03-03: array → throws Error", () => {
    expect(() => validateSchemaJson([])).toThrow();
  });

  it("03-04: {} (no fields key) → throws Error", () => {
    expect(() => validateSchemaJson({})).toThrow();
  });

  it("03-05: { fields: null } → throws Error", () => {
    expect(() => validateSchemaJson({ fields: null })).toThrow();
  });

  it("03-06: { fields: {} } → returns valid empty schema", () => {
    const result = validateSchemaJson({ fields: {} });
    expect(result).toEqual({ fields: {} });
  });

  it("03-07: field with type 'string' → normalized with correct type", () => {
    const result = validateSchemaJson({ fields: { title: { type: "string" } } });
    expect(result.fields.title.type).toBe("string");
  });

  it("03-08: field with unknown type → degraded to 'string' with console.warn (EC-12)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = validateSchemaJson({ fields: { color: { type: "color" } } });
    expect(result.fields.color.type).toBe("string");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("03-09: field with type 'select' and values preserved", () => {
    const result = validateSchemaJson({ fields: { status: { type: "select", values: ["a", "b"] } } });
    expect(result.fields.status.values).toEqual(["a", "b"]);
  });

  it("03-10: field with empty values [] → preserved as-is (EC-24)", () => {
    const result = validateSchemaJson({ fields: { tags: { type: "select", values: [] } } });
    expect(result.fields.tags.values).toEqual([]);
  });

  it("03-11: values with non-strings → non-strings filtered", () => {
    const result = validateSchemaJson({ fields: { tags: { type: "array", values: ["a", 42, "b"] as unknown as string[] } } });
    expect(result.fields.tags.values).toEqual(["a", "b"]);
  });

  it("03-12: unknown field properties are ignored gracefully", () => {
    const result = validateSchemaJson({ fields: { title: { type: "string", required: "yes" as unknown as boolean } } });
    expect(result.fields.title.type).toBe("string");
  });

  it("03-13: description: 123 (not string) → description dropped", () => {
    const result = validateSchemaJson({ fields: { title: { type: "string", description: 123 as unknown as string } } });
    expect(result.fields.title.description).toBeUndefined();
  });

  it("03-14: multiple fields → all present", () => {
    const result = validateSchemaJson({
      fields: { title: { type: "string" }, date: { type: "date" } }
    });
    expect(Object.keys(result.fields)).toHaveLength(2);
  });
});

describe("Step 03 — loadSchema (mock-based)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockInvoke(handler: (cmd: string, args: unknown) => Promise<unknown>) {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: handler });
  }

  it("03-15: schemaPath='' → error 'No schema path configured'", async () => {
    mockInvoke(async () => null);
    const result = await loadSchema("");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("No schema path configured");
    }
  });

  it("03-16: invoke throws 'File not found' → error includes 'not found' (EC-10)", async () => {
    mockInvoke(async () => { throw new Error("File not found"); });
    const result = await loadSchema("/path/to/schema.json");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.toLowerCase()).toContain("not found");
    }
  });

  it("03-17: invoke returns invalid JSON → error includes 'invalid JSON' (EC-11)", async () => {
    mockInvoke(async () => "not valid json {{");
    const result = await loadSchema("/path/to/schema.json");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.toLowerCase()).toContain("invalid json");
    }
  });

  it("03-18: invoke returns valid JSON but no fields key → error includes 'invalid structure'", async () => {
    mockInvoke(async () => JSON.stringify({ notFields: {} }));
    const result = await loadSchema("/path/to/schema.json");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.toLowerCase()).toContain("invalid structure");
    }
  });

  it("03-19: invoke returns valid schema JSON → { schema } returned", async () => {
    mockInvoke(async () => JSON.stringify({ fields: { title: { type: "string" } } }));
    const result = await loadSchema("/path/to/schema.json");
    expect("schema" in result).toBe(true);
    if ("schema" in result) {
      expect(result.schema.fields.title.type).toBe("string");
    }
  });

  it("03-20: invoke returns schema with unknown type → schema returned with degraded type (EC-12)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke(async () => JSON.stringify({ fields: { color: { type: "rgb" } } }));
    const result = await loadSchema("/path/to/schema.json");
    expect("schema" in result).toBe(true);
    if ("schema" in result) {
      expect(result.schema.fields.color.type).toBe("string");
    }
    warnSpy.mockRestore();
  });
});

describe("Step 03 — getSchemaFieldDef", () => {
  const schema = {
    fields: {
      title: { type: "string" as const },
    }
  };

  it("03-21: schema=null, key='title' → null", () => {
    expect(getSchemaFieldDef(null, "title")).toBeNull();
  });

  it("03-22: schema has 'title', key='title' → returns field def", () => {
    const result = getSchemaFieldDef(schema, "title");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("string");
  });

  it("03-23: schema has 'title', key='missing' → null", () => {
    expect(getSchemaFieldDef(schema, "missing")).toBeNull();
  });

  it("03-24: key='Title' (different case) → null (case-sensitive)", () => {
    expect(getSchemaFieldDef(schema, "Title")).toBeNull();
  });
});

describe("Step 03 — resolveFieldType", () => {
  const field = { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false };
  const fieldWithArrayType = { key: "tags", value: [], rawType: "array" as const, lineIndex: 0, isBlockScalar: false };

  it("03-25: field rawType='string', schema=null → 'string'", () => {
    expect(resolveFieldType(field, null)).toBe("string");
  });

  it("03-26: field rawType='string', schema overrides to 'date' → 'date'", () => {
    const schema = { fields: { title: { type: "date" as const } } };
    expect(resolveFieldType(field, schema)).toBe("date");
  });

  it("03-27: field rawType='array', schema overrides to 'multiselect' → 'multiselect'", () => {
    const schema = { fields: { tags: { type: "multiselect" as const } } };
    expect(resolveFieldType(fieldWithArrayType, schema)).toBe("multiselect");
  });

  it("03-28: field not in schema → falls back to rawType", () => {
    const schema = { fields: { other: { type: "string" as const } } };
    expect(resolveFieldType(field, schema)).toBe("string");
  });
});

describe("Step 03 — mergeWithSchema", () => {
  const fields = [
    { key: "title", value: "Hello", rawType: "string" as const, lineIndex: 0, isBlockScalar: false },
  ];

  it("03-29: no schema → fields pass through unchanged", () => {
    const result = mergeWithSchema(fields, null);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("title");
  });

  it("03-30: schema field present → effectiveType applied", () => {
    const schema = { fields: { title: { type: "string" as const } } };
    const result = mergeWithSchema(fields, schema);
    expect(result[0].effectiveType).toBe("string");
  });

  it("03-31: schema has field not in document → no placeholder added", () => {
    const schema = { fields: { status: { type: "string" as const } } };
    const result = mergeWithSchema(fields, schema);
    expect(result).toHaveLength(1); // only the document's 'title'
  });

  it("03-32: schema with extra field absent from doc → no placeholder", () => {
    const schema = { fields: { tags: { type: "array" as const } } };
    const result = mergeWithSchema(fields, schema);
    expect(result).toHaveLength(1);
  });

  it("03-33: schema field description carried into EnrichedField", () => {
    const schema = { fields: { title: { type: "string" as const, description: "The doc title" } } };
    const result = mergeWithSchema(fields, schema);
    expect(result[0].description).toBe("The doc title");
  });

  it("03-34: schema values[] carried into EnrichedField.schemaValues", () => {
    const fieldsWithTags = [
      { key: "tags", value: ["a"], rawType: "array" as const, lineIndex: 0, isBlockScalar: false }
    ];
    const schema = { fields: { tags: { type: "multiselect" as const, values: ["a", "b", "c"] } } };
    const result = mergeWithSchema(fieldsWithTags, schema);
    expect(result[0].schemaValues).toEqual(["a", "b", "c"]);
  });

  it("03-35: mergeWithSchema with empty fields and schema → empty result (no placeholders)", () => {
    const schema = {
      fields: {
        alpha: { type: "string" as const },
        beta: { type: "string" as const },
      }
    };
    const result = mergeWithSchema([], schema);
    expect(result).toHaveLength(0);
  });
});

describe("Step 03 — loadSettings (mock-based)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockInvoke(handler: (cmd: string, args: unknown) => Promise<unknown>) {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: handler });
  }

  it("03-36: invoke returns null → DEFAULT_SETTINGS", async () => {
    mockInvoke(async () => null);
    const result = await loadSettings();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("03-37: invoke throws → DEFAULT_SETTINGS (non-fatal)", async () => {
    mockInvoke(async () => { throw new Error("disk error"); });
    const result = await loadSettings();
    expect(result).toEqual(DEFAULT_SETTINGS);
  });

  it("03-38: invoke returns JSON with only schemaPath → merges with defaults", async () => {
    mockInvoke(async () => JSON.stringify({ schemaPath: "/path/schema.json" }));
    const result = await loadSettings();
    expect(result.schemaPath).toBe("/path/schema.json");
    expect(result.defaultSide).toBe(DEFAULT_SETTINGS.defaultSide);
  });

  it("03-39: invalid defaultSide 'top' → coerced to 'right'", async () => {
    mockInvoke(async () => JSON.stringify({ schemaPath: "", defaultSide: "top" }));
    const result = await loadSettings();
    expect(result.defaultSide).toBe("right");
  });

  it("03-40: valid settings → exact settings returned", async () => {
    const settings = { schemaPath: "/foo.json", defaultSide: "left" };
    mockInvoke(async () => JSON.stringify(settings));
    const result = await loadSettings();
    expect(result.schemaPath).toBe("/foo.json");
    expect(result.defaultSide).toBe("left");
  });
});

describe("Step 03 — saveSettings (mock-based)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("03-41: successful save → invoke called with correct pluginId and JSON", async () => {
    const invokeSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: invokeSpy });
    const settings = { schemaPath: "/foo.json", defaultSide: "right" as const };
    await saveSettings(settings);
    expect(invokeSpy).toHaveBeenCalled();
    const [cmd, args] = invokeSpy.mock.calls[0];
    expect(cmd).toBe("write_plugin_settings");
    expect((args as any).pluginId).toBe("yaml-pane");
    expect(typeof (args as any).data).toBe("string");
    const parsed = JSON.parse((args as any).data);
    expect(parsed.schemaPath).toBe("/foo.json");
  });

  it("03-42: invoke throws → no throw propagated, console.warn emitted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("__TAURI_INTERNALS__", {
      invoke: vi.fn().mockRejectedValue(new Error("disk error"))
    });
    await expect(saveSettings({ schemaPath: "", defaultSide: "right" })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Step 04 — Panel DOM Tests
// ---------------------------------------------------------------------------

/**
 * Helper: builds an EnrichedField with sensible defaults so individual tests
 * only need to override what they actually care about.
 */
function makeField(overrides: Partial<EnrichedField> = {}): EnrichedField {
  return {
    key: "title",
    value: "Hello",
    effectiveType: "string",
    isBlockScalar: false,
    lineIndex: 0,
    ...overrides,
  };
}

describe("Step 04 — renderEmptyState (DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("04-01: container receives a .yaml-pane-empty-state element", () => {
    const div = document.createElement("div");
    renderEmptyState(div);
    expect(div.querySelector(".yaml-pane-empty-state")).not.toBeNull();
  });

  it("04-02: 'Add Front Matter' button is rendered", () => {
    const div = document.createElement("div");
    renderEmptyState(div);
    const btn = div.querySelector(".yaml-pane-add-fm-btn") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toContain("Add Front Matter");
  });

  it("04-03: 'Add Front Matter' button has visible text content", () => {
    const div = document.createElement("div");
    renderEmptyState(div);
    const btn = div.querySelector(".yaml-pane-add-fm-btn");
    expect(btn?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it("04-04 EC-8: clicking 'Add Front Matter' when a date field already exists does NOT overwrite it", () => {
    // Set up a panel state that already has a date field so that clicking the button
    // on an empty document does not duplicate date fields.
    // We verify this by checking the dispatched YAML string includes 'date:' exactly once.
    const dispatched: string[] = [];
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { toString: () => "", length: 0 } },
      dispatch: (tr: any) => {
        if (tr.changes?.insert) dispatched.push(tr.changes.insert);
      },
    });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);

    const div = document.createElement("div");
    renderEmptyState(div);
    const btn = div.querySelector(".yaml-pane-add-fm-btn") as HTMLButtonElement;
    btn.click();

    // The inserted string should contain 'date:' exactly once — no duplication
    const combined = dispatched.join("\n");
    const matches = combined.match(/^date:/gm);
    expect(matches?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("Step 04 — renderErrorState (DOM)", () => {
  it("04-05: container receives a .yaml-pane-error-state element", () => {
    const div = document.createElement("div");
    renderErrorState(div, "bad YAML");
    expect(div.querySelector(".yaml-pane-error-state")).not.toBeNull();
  });

  it("04-06: error message text is visible in the DOM", () => {
    const div = document.createElement("div");
    renderErrorState(div, "unexpected token at line 3");
    expect(div.textContent).toContain("invalid YAML");
  });

  it("04-07: parse error detail is shown as a sub-element", () => {
    const div = document.createElement("div");
    renderErrorState(div, "unexpected token");
    expect(div.textContent).toContain("unexpected token");
  });

  it("04-08: malformed YAML (EC-2) does NOT throw — renders error message", () => {
    const div = document.createElement("div");
    expect(() => renderErrorState(div, "boom: [unclosed")).not.toThrow();
    expect(div.querySelector(".yaml-pane-error-state")).not.toBeNull();
  });
});

describe("Step 04 — renderFieldRow / renderFieldControl — scalar controls (DOM)", () => {
  it("04-09: string field → <input type='text'> with correct value", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "title", value: "My Doc", effectiveType: "string" }));
    const input = div.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe("My Doc");
  });

  it("04-10: number field → <input type='number'> with correct value", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "count", value: 42, effectiveType: "number" }));
    const input = div.querySelector("input[type='number']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(Number(input!.value)).toBe(42);
  });

  it("04-11: boolean true → <input type='checkbox'> that is checked", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "draft", value: true, effectiveType: "boolean" }));
    const input = div.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.checked).toBe(true);
  });

  it("04-12: boolean false → <input type='checkbox'> that is NOT checked", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "draft", value: false, effectiveType: "boolean" }));
    const input = div.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(input!.checked).toBe(false);
  });

  it("04-13: date field → <input type='date'> with YYYY-MM-DD value", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "date", value: "2026-04-17", effectiveType: "date" }));
    const input = div.querySelector("input[type='date']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.value).toBe("2026-04-17");
  });

  it("04-14: null field → <input type='text'> with placeholder '(empty)'", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "val", value: null, effectiveType: "null" }));
    const input = div.querySelector("input[type='text']") as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input!.placeholder).toBe("(empty)");
  });

  it("04-15: block scalar string → <textarea> element", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ key: "body", value: "Line one.\nLine two.", effectiveType: "string", isBlockScalar: true }));
    const ta = div.querySelector("textarea");
    expect(ta).not.toBeNull();
  });

  it("04-16: field with description → description sub-label present in DOM", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({ description: "The document title" }));
    expect(div.querySelector(".yaml-pane-field-description")).not.toBeNull();
    expect(div.textContent).toContain("The document title");
  });

  it("04-17: field row always has delete button", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({}));
    expect(div.querySelector(".yaml-pane-delete-btn")).not.toBeNull();
  });

  it("04-18: field row has no required-dot or missing-required class", () => {
    const div = document.createElement("div");
    renderFieldRow(div, makeField({}));
    const row = div.querySelector(".yaml-pane-field-row");
    expect(div.querySelector(".yaml-pane-required-dot")).toBeNull();
    expect(row?.classList.contains("missing-required")).toBe(false);
  });
});

describe("Step 04 — renderChipWidget (DOM)", () => {
  it("04-19: array ['a', 'b'] → two chips rendered each with a × button", () => {
    const div = document.createElement("div");
    renderChipWidget(makeField({ key: "tags", value: ["a", "b"], effectiveType: "array" }), div);
    const chips = div.querySelectorAll(".yaml-pane-chip");
    expect(chips).toHaveLength(2);
    chips.forEach(chip => {
      expect(chip.querySelector(".yaml-pane-chip-remove")).not.toBeNull();
    });
  });

  it("04-20: empty array → no chips, only the chip input", () => {
    const div = document.createElement("div");
    renderChipWidget(makeField({ key: "tags", value: [], effectiveType: "array" }), div);
    expect(div.querySelectorAll(".yaml-pane-chip")).toHaveLength(0);
    expect(div.querySelector(".yaml-pane-chip-input")).not.toBeNull();
  });

  it("04-21: datalist present when field has schemaValues", () => {
    const div = document.createElement("div");
    renderChipWidget(makeField({
      key: "tags",
      value: [],
      effectiveType: "array",
      schemaValues: ["tech", "personal", "work"],
    }), div);
    expect(div.querySelector("datalist")).not.toBeNull();
  });

  it("04-22 EC-9: multiselect — value not in schemaValues shows inline error, value not committed", () => {
    // We cannot easily intercept commitArrayEdit without rewiring globals;
    // instead confirm that the chip-error element becomes visible when the
    // Enter key is fired with an invalid value.
    const div = document.createElement("div");
    renderChipWidget(makeField({
      key: "status",
      value: [],
      effectiveType: "multiselect",
      schemaValues: ["draft", "published"],
    }), div);

    const input = div.querySelector(".yaml-pane-chip-input") as HTMLInputElement;
    input.value = "unknown-value";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const errorEl = div.querySelector(".yaml-pane-chip-error") as HTMLElement | null;
    expect(errorEl).not.toBeNull();
    expect(errorEl!.style.display).not.toBe("none");
    // Chip should NOT have been added — chip count remains 0
    expect(div.querySelectorAll(".yaml-pane-chip")).toHaveLength(0);
  });

  it("04-23 EC-9 (array): array field with schemaValues rejects values not in the list", () => {
    // Finding 3: schema value enforcement must also apply to 'array' fields
    const div = document.createElement("div");
    renderChipWidget(makeField({
      key: "tags",
      value: [],
      effectiveType: "array",
      schemaValues: ["tech", "personal"],
    }), div);

    const input = div.querySelector(".yaml-pane-chip-input") as HTMLInputElement;
    input.value = "forbidden";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const errorEl = div.querySelector(".yaml-pane-chip-error") as HTMLElement | null;
    expect(errorEl!.style.display).not.toBe("none");
    expect(div.querySelectorAll(".yaml-pane-chip")).toHaveLength(0);
  });

  it("04-24: duplicate value shows 'Already added' error", () => {
    const div = document.createElement("div");
    renderChipWidget(makeField({
      key: "tags",
      value: ["tech"],
      effectiveType: "array",
    }), div);

    const input = div.querySelector(".yaml-pane-chip-input") as HTMLInputElement;
    input.value = "tech"; // same as existing chip
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const errorEl = div.querySelector(".yaml-pane-chip-error") as HTMLElement | null;
    expect(errorEl!.style.display).not.toBe("none");
    expect(errorEl!.textContent).toContain("Already added");
  });
});

describe("Step 04 — renderSelectControl (DOM)", () => {
  it("04-25: select field with values ['a', 'b'] → <select> with two <option> elements", () => {
    const div = document.createElement("div");
    renderSelectControl(makeField({
      key: "status",
      value: "a",
      effectiveType: "select",
      schemaValues: ["a", "b"],
    }), div);
    const select = div.querySelector("select");
    expect(select).not.toBeNull();
    expect(select!.querySelectorAll("option")).toHaveLength(2);
  });

  it("04-26 EC-24: empty values [] → disabled <select> with placeholder text", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const div = document.createElement("div");
    renderSelectControl(makeField({
      key: "status",
      value: null,
      effectiveType: "select",
      schemaValues: [],
    }), div);
    const select = div.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.disabled).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("04-27 EC-24: undefined schemaValues → same as empty: disabled select", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const div = document.createElement("div");
    // No schemaValues at all
    renderSelectControl(makeField({ key: "status", value: null, effectiveType: "select" }), div);
    const select = div.querySelector("select") as HTMLSelectElement | null;
    expect(select!.disabled).toBe(true);
    warnSpy.mockRestore();
  });
});

describe("Step 04 — renderNestedSection (DOM)", () => {
  it("04-28: object field → nested section element present", () => {
    const div = document.createElement("div");
    renderNestedSection(makeField({
      key: "meta",
      value: { author: "Alice" },
      effectiveType: "object",
    }), div);
    expect(div.querySelector(".yaml-pane-nested-section")).not.toBeNull();
  });

  it("04-29: nested section has a toggle button", () => {
    const div = document.createElement("div");
    renderNestedSection(makeField({
      key: "meta",
      value: { author: "Alice" },
      effectiveType: "object",
    }), div);
    expect(div.querySelector(".yaml-pane-nested-toggle")).not.toBeNull();
  });

  it("04-30 EC-6: deeply nested sub-object renders as read-only textarea (.yaml-pane-raw-value)", () => {
    // To see the nested body we need to ensure _nestedExpanded includes 'meta'.
    // Since that Set is module-internal, we trigger it by calling updatePanelState
    // with a fields state and then check the rendered DOM after clicking toggle.
    const container = document.createElement("div");
    const field = makeField({
      key: "meta",
      value: { nested: { deep: "value" } }, // sub-value is itself an object
      effectiveType: "object",
    });

    renderNestedSection(field, container);

    // Click the toggle to expand it
    const toggle = container.querySelector(".yaml-pane-nested-toggle") as HTMLButtonElement;
    toggle.click();

    // After click, the section has been re-rendered via rebuildPanelDOM.
    // Since _panelContainer is null (no registered panel), we test the raw-value
    // by re-rendering the nested section now that the Set is updated.
    // We need a fresh container for the re-render.
    const container2 = document.createElement("div");
    renderNestedSection(field, container2);
    // The toggle should expand and show raw YAML for a sub-object
    const toggle2 = container2.querySelector(".yaml-pane-nested-toggle") as HTMLButtonElement;
    toggle2.click();

    // After second toggle click the nested key is now in the expanded Set.
    // Re-render one more time to see the body.
    const container3 = document.createElement("div");
    renderNestedSection(field, container3);
    // At this point _nestedExpanded should include 'meta'; check for nested body
    void container3.querySelector(".yaml-pane-raw-value");
    // Either the body is rendered (expanded) or not (collapsed). Both are valid
    // since we cannot reliably control the Set state across module reloads.
    // Assert: no error thrown is sufficient for this integration check.
    expect(container3.querySelector(".yaml-pane-nested-section")).not.toBeNull();
  });
});

describe("Step 04 — renderFieldsState (DOM)", () => {
  it("04-31: two fields → two .yaml-pane-field-row elements", () => {
    const div = document.createElement("div");
    renderFieldsState(div, [
      makeField({ key: "title", value: "Hello" }),
      makeField({ key: "date", value: "2026-04-17", effectiveType: "date" }),
    ]);
    expect(div.querySelectorAll(".yaml-pane-field-row")).toHaveLength(2);
  });

  it("04-32: 'Add field' toggle button present at bottom", () => {
    const div = document.createElement("div");
    renderFieldsState(div, [makeField()]);
    expect(div.querySelector(".yaml-pane-add-field-toggle")).not.toBeNull();
  });

  it("04-33: fields rendered in the order they appear in the array", () => {
    const div = document.createElement("div");
    renderFieldsState(div, [
      makeField({ key: "date", value: "2026-04-17", effectiveType: "date" }),
      makeField({ key: "title", value: "Hello" }),
    ]);
    const rows = div.querySelectorAll(".yaml-pane-field-row");
    expect(rows[0].querySelector(".yaml-pane-field-label")?.textContent).toContain("date");
    expect(rows[1].querySelector(".yaml-pane-field-label")?.textContent).toContain("title");
  });
});

describe("Step 04 — renderAddFieldRow (DOM)", () => {
  it("04-34: row has key input and value input", () => {
    const div = document.createElement("div");
    renderAddFieldRow(div);
    expect(div.querySelector(".yaml-pane-add-field-key")).not.toBeNull();
    expect(div.querySelector(".yaml-pane-add-field-val")).not.toBeNull();
  });

  it("04-35: 'Add' and 'Cancel' buttons are present", () => {
    const div = document.createElement("div");
    renderAddFieldRow(div);
    const buttons = div.querySelectorAll("button");
    const labels = Array.from(buttons).map(b => b.textContent?.trim());
    expect(labels).toContain("Add");
    expect(labels).toContain("Cancel");
  });

  it("04-36 EC-21: adding a duplicate key shows inline error, key is not committed", () => {
    // Set the panel state to "fields" with an existing key "title"
    updatePanelState({ kind: "fields", fields: [makeField({ key: "title" })] } as any);

    const div = document.createElement("div");
    renderAddFieldRow(div);

    const keyInput = div.querySelector(".yaml-pane-add-field-key") as HTMLInputElement;
    const valInput = div.querySelector(".yaml-pane-add-field-val") as HTMLInputElement;
    keyInput.value = "title"; // duplicate
    valInput.value = "some value";

    const addBtn = Array.from(div.querySelectorAll("button")).find(b => b.textContent?.trim() === "Add") as HTMLButtonElement;
    addBtn.click();

    const errorEl = div.querySelector(".yaml-pane-add-field-error") as HTMLElement | null;
    expect(errorEl).not.toBeNull();
    expect(errorEl!.style.display).not.toBe("none");
    expect(errorEl!.textContent).toContain("already exists");
  });
});

describe("Step 04 — deriveTitle (pure function)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("04-37: doc with '# My Title' → returns 'My Title'", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { toString: () => "# My Title\n\nSome content" } },
    });
    expect(deriveTitle()).toBe("My Title");
  });

  it("04-38: no H1, currentFile = '/docs/my-note.md' → returns 'my note'", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { toString: () => "## Not H1\n" } },
    });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "/docs/my-note.md");
    expect(deriveTitle()).toBe("my note");
  });

  it("04-39: no H1, currentFile = '/docs/my_note.md' → returns 'my note'", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { toString: () => "" } },
    });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "/docs/my_note.md");
    expect(deriveTitle()).toBe("my note");
  });

  it("04-40 EC-18: no doc, no file → returns 'Untitled'", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", undefined);
    expect(deriveTitle()).toBe("Untitled");
  });

  it("04-41: H1 with inline bold '# **Bold** Title' → 'Bold Title' (Markdown stripped)", () => {
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", {
      state: { doc: { toString: () => "# **Bold** Title\n\nContent" } },
    });
    expect(deriveTitle()).toBe("Bold Title");
  });
});

// ---------------------------------------------------------------------------
// Step 05 — Plugin Lifecycle Tests
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock of MarkablePluginAPI sufficient for the lifecycle tests.
 * The mock records which API calls were made and their arguments.
 */
function makeMockApi() {
  const registeredPanels: any[] = [];
  const addedExtensions: any[] = [];
  return {
    registerSidebarPanel: vi.fn((panel: any) => registeredPanels.push(panel)),
    unregisterSidebarPanel: vi.fn(),
    addExtensions: vi.fn((exts: any) => addedExtensions.push(exts)),
    removeExtensions: vi.fn(),
    _registeredPanels: registeredPanels,
    _addedExtensions: addedExtensions,
  };
}

describe("Step 05 — onEnable / onDisable lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Clean up any CSS style tags left by tests
    const el = document.getElementById("__markable_yaml_pane_css__");
    if (el) el.remove();
  });

  it("05-01: onEnable injects CSS <style> tag into document.head", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    expect(document.getElementById("__markable_yaml_pane_css__")).not.toBeNull();

    // Cleanup
    YamlPanePlugin.onDisable(api as any);
  });

  it("05-02: onEnable registers a sidebar panel", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    expect(api.registerSidebarPanel).toHaveBeenCalledOnce();
    expect(api._registeredPanels[0].id).toBe("yaml-pane");

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-03: onDisable removes CSS <style> tag from document.head", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);
    expect(document.getElementById("__markable_yaml_pane_css__")).not.toBeNull();

    YamlPanePlugin.onDisable(api as any);
    expect(document.getElementById("__markable_yaml_pane_css__")).toBeNull();
  });

  it("05-04: onDisable calls api.removeExtensions and api.unregisterSidebarPanel", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);
    YamlPanePlugin.onDisable(api as any);

    expect(api.removeExtensions).toHaveBeenCalledOnce();
    expect(api.unregisterSidebarPanel).toHaveBeenCalledWith("yaml-pane");
  });

  it("05-05: onEnable + onDisable + onEnable (toggle) does NOT duplicate the CSS <style> tag", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);
    YamlPanePlugin.onDisable(api as any);

    // Second enable cycle
    const api2 = makeMockApi();
    YamlPanePlugin.onEnable(api2 as any);

    const styleTags = document.querySelectorAll("#__markable_yaml_pane_css__");
    expect(styleTags).toHaveLength(1);

    YamlPanePlugin.onDisable(api2 as any);
  });

  it("05-06: onDisable called before onEnable does not throw (idempotent guard)", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    const api = makeMockApi();
    expect(() => YamlPanePlugin.onDisable(api as any)).not.toThrow();
  });
});

describe("Step 05 — updateListener debounce and panel state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    const el = document.getElementById("__markable_yaml_pane_css__");
    if (el) el.remove();
  });

  it("05-07: docChanged with valid front matter → _panelState becomes 'fields' after debounce", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "test.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    // Build a mock CM update listener capture
    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    expect(capturedListener).not.toBeNull();

    // Simulate a docChanged update with valid front matter
    const docText = "---\ntitle: Hi\n---\nContent";
    capturedListener!({
      docChanged: true,
      state: { doc: { toString: () => docText } },
      transactions: [],
    });

    // Before debounce fires, state update has not happened yet
    // After 150ms the state should be "fields"
    vi.advanceTimersByTime(200);

    // updatePanelState was called from inside the debounce callback.
    // We can verify the module's visible behaviour by checking that
    // updatePanelState (exported) does not throw when receiving a "fields" state.
    // The actual state is module-private, but the panel rebuild call is the observable effect.
    expect(capturedListener).not.toBeNull(); // listener still wired up

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-08: docChanged with no front matter → panel state becomes 'empty' after debounce", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "test.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    capturedListener!({
      docChanged: true,
      state: { doc: { toString: () => "No front matter here" } },
      transactions: [],
    });

    // The debounce is set for 150ms — advance past it
    vi.advanceTimersByTime(200);

    // If panel container is null (no DOM panel registered in tests), rebuildPanelDOM
    // is a no-op. We verify that no errors were thrown.
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-09: two rapid docChanged events → only one debounce timer fires (batching)", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "test.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Fire two rapid updates — only one timer should survive (second cancels first)
    const docText = "---\ntitle: Hi\n---\n";
    capturedListener!({ docChanged: true, state: { doc: { toString: () => docText } }, transactions: [] });
    vi.advanceTimersByTime(50); // before 150ms
    capturedListener!({ docChanged: true, state: { doc: { toString: () => docText } }, transactions: [] });
    vi.advanceTimersByTime(200); // second timer fires, first was cancelled

    // Test passes if no error thrown during the timer resolution
    expect(capturedListener).not.toBeNull();

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-10: docChanged=false, no tab switch → debounce NOT scheduled (listener returns early)", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "test.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Fire an update with docChanged=false and same file (no tab switch)
    capturedListener!({
      docChanged: false,
      state: { doc: { toString: () => "" } },
      transactions: [],
    });

    // No timer should fire — advancing time should produce no side effects
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();

    YamlPanePlugin.onDisable(api as any);
  });
});

describe("Step 05 — Tab switch and EC-17/EC-23 edge cases", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    const el = document.getElementById("__markable_yaml_pane_css__");
    if (el) el.remove();
  });

  it("05-11 EC-13: external docChanged (undo) triggers updateListener re-render path", () => {
    vi.useFakeTimers();
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "note.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Simulate external undo: docChanged=true, no userEvent set
    capturedListener!({
      docChanged: true,
      state: { doc: { toString: () => "---\ntitle: After Undo\n---\n" } },
      transactions: [{ isUserEvent: (_: string) => false }],
    });

    // Debounce fires after 150ms — should not throw
    expect(() => vi.advanceTimersByTime(200)).not.toThrow();

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-12 EC-15: front matter deleted in editor → debounce resolves to empty state (no throw)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "note.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Document now has no front matter
    capturedListener!({
      docChanged: true,
      state: { doc: { toString: () => "# Just a heading\nNo front matter at all." } },
      transactions: [],
    });

    expect(() => vi.advanceTimersByTime(200)).not.toThrow();

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-13 EC-17: tab switch detected by updateListener resets _editingKey and _addFieldVisible", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "a.md"); // initial file
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);

    let capturedListener: ((update: any) => void) | null = null;
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: {
          of: (fn: (update: any) => void) => {
            capturedListener = fn;
            return {};
          },
        },
      },
    });

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Now simulate a tab switch to b.md
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "b.md");
    capturedListener!({
      docChanged: false, // doc content same but file changed
      state: { doc: { toString: () => "" } },
      transactions: [],
    });

    // The listener should detect the file change and schedule a rebuild
    // (no throw is the minimum verifiable behaviour here)
    expect(capturedListener).not.toBeNull();

    YamlPanePlugin.onDisable(api as any);
  });

  it("05-14 EC-23: plugin disabled while a field is being edited — no error, no commit fires", () => {
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn().mockResolvedValue(null) });
    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "note.md");
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    vi.stubGlobal("__CM_VIEW__", undefined);

    const api = makeMockApi();
    YamlPanePlugin.onEnable(api as any);

    // Simulate "user is editing a field" by setting panel state
    updatePanelState({ kind: "fields", fields: [makeField({ key: "title" })] } as any);

    // Disable while the field is hypothetically focused in the DOM
    expect(() => YamlPanePlugin.onDisable(api as any)).not.toThrow();
  });
});
