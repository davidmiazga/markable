import { describe, expect, it } from "vitest";
import { filesMatchingTagQuery, parseTagSearch } from "../../src/lib/tag-search";

const notes = [
  "/vault/Recipe.md",
  "/vault/Plain.md",
  "/vault/Test01.md",
];

const scan = [
  { tag: "recipe", filePaths: ["/vault/Recipe.md"] },
  { tag: "Tags:Great", filePaths: ["/vault/Test01.md"] },
  { tag: "Tags:Nice,", filePaths: ["/vault/Test01.md"] },
  { tag: "Category:Awesome", filePaths: ["/vault/Test01.md"] },
  { tag: "Tags:Great, Nice, Super", filePaths: ["/vault/Test02.md"] },
];

describe("parseTagSearch", () => {
  it("reads include and exclude tag clauses and leaves leftover text", () => {
    expect(parseTagSearch("tag:#recipe -tag:#soup stew")).toEqual({
      clauses: [
        { exclude: false, field: "tag", value: "recipe" },
        { exclude: true, field: "tag", value: "soup" },
      ],
      text: "stew",
    });
  });

  it("treats tags: as the tag list and keeps a quoted value", () => {
    expect(parseTagSearch('tags:#"Very Awesome"')).toEqual({
      clauses: [{ exclude: false, field: "tag", value: "Very Awesome" }],
      text: "",
    });
  });
});

describe("filesMatchingTagQuery", () => {
  it("returns notes that include the tag", () => {
    const match = filesMatchingTagQuery(notes, scan, "tag:#recipe");
    expect(match.active).toBe(true);
    expect(match.paths).toEqual(["/vault/Recipe.md"]);
  });

  it("returns notes that do not have the tag, including notes with no tags", () => {
    const match = filesMatchingTagQuery(notes, scan, "-tag:#recipe");
    expect(match.paths).toEqual(["/vault/Plain.md", "/vault/Test01.md", "/vault/Test02.md"]);
  });

  it("matches a capitalized Tags field and a trailing comma", () => {
    expect(filesMatchingTagQuery(notes, scan, "tag:#Great").paths).toEqual([
      "/vault/Test01.md",
      "/vault/Test02.md",
    ]);
    expect(filesMatchingTagQuery(notes, scan, "tag:#Nice").paths).toEqual([
      "/vault/Test01.md",
      "/vault/Test02.md",
    ]);
  });

  it("matches a category clause and excludes it", () => {
    expect(filesMatchingTagQuery(notes, scan, "category:#Awesome").paths).toEqual([
      "/vault/Test01.md",
    ]);
    expect(filesMatchingTagQuery(notes, scan, "-category:#Awesome").paths).not.toContain(
      "/vault/Test01.md",
    );
  });

  it("requires every include and rejects any exclude", () => {
    expect(filesMatchingTagQuery(notes, scan, "tag:#Great -tag:#Nice").paths).toEqual([]);
    expect(filesMatchingTagQuery(notes, scan, "tag:#Great tag:#Nice").paths).toEqual([
      "/vault/Test01.md",
      "/vault/Test02.md",
    ]);
  });

  it("leaves a plain query inactive", () => {
    expect(filesMatchingTagQuery(notes, scan, "stew")).toEqual({
      active: false,
      paths: [],
      text: "stew",
    });
  });
});
