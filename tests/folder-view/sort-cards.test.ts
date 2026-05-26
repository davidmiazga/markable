/**
 * Unit tests for sortCards() — specifically the `author-asc` / `author-desc`
 * orders introduced for the Bookshelf display, including the
 * author → title → name fallback chain when YAML `author:` is missing.
 *
 * Author sort relies on `card.meta.author` populated by `enrichBookshelfMeta`
 * before the sort runs. If a card has no author, sortCards falls through to
 * `meta.title` then to the filename `name`, so unenriched cards still produce
 * a deterministic order.
 */

import { describe, it, expect } from "vitest";
import { sortCards } from "../../src/plugins/file-browser/folder-view/renderer";
import type { FolderCard } from "../../src/plugins/file-browser/folder-view/types";

function fileCard(
  name: string,
  meta: Record<string, string> | undefined = undefined,
): FolderCard {
  return {
    path: `/vault/${name}.md`,
    name,
    kind: "file",
    ext: ".md",
    modified: 0,
    meta,
  };
}

describe("sortCards — author sort", () => {
  it("orders by author ascending when every card has meta.author", () => {
    const cards = [
      fileCard("a", { author: "Carter" }),
      fileCard("b", { author: "Anderson" }),
      fileCard("c", { author: "Brown" }),
    ];
    sortCards(cards, "author-asc");
    expect(cards.map((c) => c.name)).toEqual(["b", "c", "a"]);
  });

  it("orders by author descending", () => {
    const cards = [
      fileCard("a", { author: "Anderson" }),
      fileCard("b", { author: "Brown" }),
      fileCard("c", { author: "Carter" }),
    ];
    sortCards(cards, "author-desc");
    expect(cards.map((c) => c.name)).toEqual(["c", "b", "a"]);
  });

  it("falls back to meta.title when author is missing", () => {
    // Two cards lack author; their order is decided by title.
    const cards = [
      fileCard("z", { author: "Alpha" }),
      fileCard("a", { title: "Gamma" }),
      fileCard("b", { title: "Beta" }),
    ];
    sortCards(cards, "author-asc");
    // Alpha < Beta < Gamma. "z" stays first because its author "Alpha"
    // sorts before the title-fallback values of the other two.
    expect(cards.map((c) => c.name)).toEqual(["z", "b", "a"]);
  });

  it("falls back to card.name when both author and title are missing", () => {
    const cards = [
      fileCard("charlie"),
      fileCard("alpha"),
      fileCard("bravo"),
    ];
    sortCards(cards, "author-asc");
    expect(cards.map((c) => c.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("treats whitespace-only author as missing", () => {
    const cards = [
      fileCard("a", { author: "   ", title: "Zulu" }),
      fileCard("b", { author: "Alpha" }),
    ];
    sortCards(cards, "author-asc");
    // "Alpha" < "Zulu" so card b comes first; card a falls through to title.
    expect(cards.map((c) => c.name)).toEqual(["b", "a"]);
  });

  it("mixes enriched and unenriched cards deterministically", () => {
    const cards = [
      fileCard("aardvark"),                            // no meta → name
      fileCard("z-book", { author: "Adams" }),          // author
      fileCard("middle", { title: "Beta" }),            // title fallback
    ];
    sortCards(cards, "author-asc");
    // Keys: "aardvark", "Adams", "Beta". localeCompare is case-insensitive
    // for letters, so "aardvark" < "Adams" < "Beta".
    expect(cards.map((c) => c.name)).toEqual(["aardvark", "z-book", "middle"]);
  });
});
