/**
 * tests/folder-view/parser-image-fields.test.ts
 *
 * Tests for the four image built-in field identifiers in BUILTIN_FIELDS and
 * their interaction with parseFolderMd()'s extraFields derivation.
 *
 * Covers step_03_parser_builtin_fields.md tests PI-01 through PI-07.
 */

import { describe, it, expect } from "vitest";
import {
  BUILTIN_FIELDS,
  parseFolderMd,
} from "../../src/plugins/file-browser/folder-view/parser";

describe("BUILTIN_FIELDS — image field membership", () => {
  it("PI-01: BUILTIN_FIELDS.has('width') is true", () => {
    expect(BUILTIN_FIELDS.has("width")).toBe(true);
  });

  it("PI-02: BUILTIN_FIELDS.has('height') is true", () => {
    expect(BUILTIN_FIELDS.has("height")).toBe(true);
  });

  it("PI-03: BUILTIN_FIELDS.has('date-taken') is true", () => {
    expect(BUILTIN_FIELDS.has("date-taken")).toBe(true);
  });

  it("PI-04: BUILTIN_FIELDS.has('camera') is true", () => {
    expect(BUILTIN_FIELDS.has("camera")).toBe(true);
  });
});

describe("parseFolderMd — image fields excluded from extraFields", () => {
  it("PI-05: fields: [name, width, height] → config.extraFields is empty (both are built-in)", () => {
    const content = "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - height\n---\n";
    const config = parseFolderMd(content, "TestFolder");

    expect(config.fields).toEqual(["name", "width", "height"]);
    expect(config.extraFields).toEqual([]);
  });

  it("PI-06: fields: [name, width, rating] → extraFields has one entry {key:'rating'} (rating is custom)", () => {
    const content = "---\nlayout: folder-table\nfields:\n  - name\n  - width\n  - rating\n---\n";
    const config = parseFolderMd(content, "TestFolder");

    expect(config.fields).toContain("width");
    expect(config.fields).toContain("rating");
    // width is built-in → not in extraFields. rating is custom → in extraFields.
    const extraKeys = config.extraFields.map(f => f.key);
    expect(extraKeys).not.toContain("width");
    expect(extraKeys).toContain("rating");
    expect(config.extraFields).toHaveLength(1);
  });

  it("PI-07: fields: [date-taken, camera] → config.fields contains both, extraFields is empty", () => {
    const content = "---\nlayout: folder-table\nfields:\n  - date-taken\n  - camera\n---\n";
    const config = parseFolderMd(content, "TestFolder");

    expect(config.fields).toEqual(["date-taken", "camera"]);
    expect(config.extraFields).toEqual([]);
  });
});
