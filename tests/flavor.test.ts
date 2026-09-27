/**
 * Flavor pack-section helpers used by the Plugins panel.
 */
import { describe, it, expect } from "vitest";
import markableManifest from "../flavors/markable.json";
import remarkableManifest from "../flavors/remarkable.json";
import pkmManifest from "../flavors/pkm.json";
import projectManifest from "../flavors/project.json";
import diaryManifest from "../flavors/diary.json";
import quicknoteManifest from "../flavors/quicknote.json";
import bookManifest from "../flavors/book.json";
import {
  orderedPluginPackIds,
  pluginDefaultEnabled,
  pluginSectionStartsCollapsed,
  resolveFlavorFirstRunPlugins,
} from "../src/lib/flavor";

describe("orderedPluginPackIds", () => {
  it("puts Markable first-run packs first, then the catalog remainder", () => {
    expect(orderedPluginPackIds(markableManifest)).toEqual([
      "base",
      "pkm",
      "project",
      "quicknote",
      "diary",
      "book",
    ]);
  });

  it("uses the same order for Re-markable and Markable PKM", () => {
    const expected = ["base", "pkm", "project", "quicknote", "diary", "book"];
    expect(orderedPluginPackIds(remarkableManifest)).toEqual(expected);
    expect(orderedPluginPackIds(pkmManifest)).toEqual(expected);
  });

  it("lifts Project / Quick note / Diary / Book after Base for those flavors", () => {
    expect(orderedPluginPackIds(projectManifest)).toEqual([
      "base",
      "project",
      "pkm",
      "quicknote",
      "diary",
      "book",
    ]);
    expect(orderedPluginPackIds(quicknoteManifest)).toEqual([
      "base",
      "quicknote",
      "pkm",
      "project",
      "diary",
      "book",
    ]);
    expect(orderedPluginPackIds(diaryManifest)).toEqual([
      "base",
      "diary",
      "pkm",
      "project",
      "quicknote",
      "book",
    ]);
    expect(orderedPluginPackIds(bookManifest)).toEqual([
      "base",
      "book",
      "pkm",
      "project",
      "quicknote",
      "diary",
    ]);
  });
});

describe("pluginSectionStartsCollapsed", () => {
  it("opens only Base for Markable; User and other packs start collapsed", () => {
    expect(pluginSectionStartsCollapsed("base", markableManifest)).toBe(false);
    expect(pluginSectionStartsCollapsed("pkm", markableManifest)).toBe(true);
    expect(pluginSectionStartsCollapsed("book", markableManifest)).toBe(true);
    expect(pluginSectionStartsCollapsed("user", markableManifest)).toBe(true);
  });

  it("opens Base and PKM for Markable PKM and Re-markable", () => {
    for (const flavor of [pkmManifest, remarkableManifest]) {
      expect(pluginSectionStartsCollapsed("base", flavor)).toBe(false);
      expect(pluginSectionStartsCollapsed("pkm", flavor)).toBe(false);
      expect(pluginSectionStartsCollapsed("project", flavor)).toBe(true);
      expect(pluginSectionStartsCollapsed("user", flavor)).toBe(true);
    }
  });
});

describe("first-run defaults", () => {
  it("enables Base plugins except templates and word-count for Markable", () => {
    const enabled = resolveFlavorFirstRunPlugins(markableManifest);
    expect(enabled).toContain("markdown-toolbar");
    expect(enabled).toContain("auto-title");
    expect(enabled).toContain("insert-count");
    expect(enabled).not.toContain("templates");
    expect(enabled).not.toContain("word-count");
    expect(enabled).not.toContain("sync");
    expect(enabled).not.toContain("file-browser");
    expect(enabled).not.toContain("auto-toc");
    expect(enabled).not.toContain("diagrams");
  });

  it("keeps templates, word-count, and former Added extras default off in Base", () => {
    expect(pluginDefaultEnabled("templates", markableManifest)).toBe(false);
    expect(pluginDefaultEnabled("word-count", markableManifest)).toBe(false);
    expect(pluginDefaultEnabled("diagrams", markableManifest)).toBe(false);
    expect(pluginDefaultEnabled("auto-title", markableManifest)).toBe(true);
    expect(pluginDefaultEnabled("insert-count", markableManifest)).toBe(true);
    expect(pluginDefaultEnabled("kanban", markableManifest)).toBe(false);
    expect(pluginDefaultEnabled("auto-toc", markableManifest)).toBe(false);
  });

  it("turns auto-toc on for Markable Book and leaves former Added extras off", () => {
    expect(pluginDefaultEnabled("auto-toc", bookManifest)).toBe(true);
    expect(pluginDefaultEnabled("diagrams", bookManifest)).toBe(false);
    expect(pluginSectionStartsCollapsed("book", bookManifest)).toBe(false);
    expect(resolveFlavorFirstRunPlugins(bookManifest)).toContain("auto-toc");
    expect(resolveFlavorFirstRunPlugins(bookManifest)).toContain("markdown-toolbar");
    expect(resolveFlavorFirstRunPlugins(bookManifest)).not.toContain("diagrams");
  });

  it("turns PKM pack plugins on for Markable PKM", () => {
    expect(pluginDefaultEnabled("file-browser", pkmManifest)).toBe(true);
    expect(pluginDefaultEnabled("templates", pkmManifest)).toBe(false);
    expect(pluginDefaultEnabled("properties-wrangler", pkmManifest)).toBe(false);
    expect(resolveFlavorFirstRunPlugins(pkmManifest)).toContain("file-browser");
    expect(resolveFlavorFirstRunPlugins(pkmManifest)).not.toContain("templates");
    expect(resolveFlavorFirstRunPlugins(pkmManifest)).not.toContain("properties-wrangler");
  });
});
