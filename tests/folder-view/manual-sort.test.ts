/**
 * Tests for the `manual` sort mode and the persistence round-trips that
 * support drag/drop custom ordering (Phase 1).
 *
 * Covers:
 *  - applyManualOrder() — moves listed paths to the front in declared order;
 *    unknown paths are silently dropped; unlisted files keep their order.
 *  - sortCards("manual") — no-op preserve.
 *  - parseSelectBody round-trips `order:` and `sort: manual`.
 *  - buildSelectFenceFromState emits `order:` and `sort: manual` together,
 *    and only when sort is manual + order is non-empty.
 *  - parseFolderMd parses `order:` and `sort: manual` from frontmatter.
 *  - attachFolderItemDrag fires onReorder with the full new ID list after a
 *    pointer drag past the 6px threshold.
 */

import { describe, it, expect, vi } from "vitest";
import {
  sortCards,
  applyManualOrder,
} from "../../src/plugins/file-browser/folder-view/renderer";
import type { FolderCard } from "../../src/plugins/file-browser/folder-view/types";
import { parseSelectBody, parseSelectBodyForBuilder } from "../../src/editor/select-widget";
import { buildSelectFenceFromState } from "../../src/lib/select-builder";
import { parseFolderMd } from "../../src/plugins/file-browser/folder-view/parser";
import { attachFolderItemDrag } from "../../src/plugins/file-browser/folder-view/folder-item-drag";

function fileCard(name: string): FolderCard {
  return {
    path: `/vault/${name}.md`,
    name,
    kind: "file",
    ext: ".md",
    modified: 0,
  };
}

describe("applyManualOrder", () => {
  it("reorders listed paths to the front in declared order", () => {
    const cards = [fileCard("a"), fileCard("b"), fileCard("c")];
    applyManualOrder(cards, ["/vault/c.md", "/vault/a.md"]);
    expect(cards.map((c) => c.name)).toEqual(["c", "a", "b"]);
  });

  it("keeps unlisted files in their relative order at the tail", () => {
    const cards = [fileCard("a"), fileCard("b"), fileCard("c"), fileCard("d")];
    applyManualOrder(cards, ["/vault/c.md"]);
    expect(cards.map((c) => c.name)).toEqual(["c", "a", "b", "d"]);
  });

  it("silently drops paths not in the visible card list", () => {
    const cards = [fileCard("a"), fileCard("b")];
    applyManualOrder(cards, ["/vault/ghost.md", "/vault/b.md"]);
    expect(cards.map((c) => c.name)).toEqual(["b", "a"]);
  });

  it("dedupes duplicate paths in the order array", () => {
    const cards = [fileCard("a"), fileCard("b"), fileCard("c")];
    applyManualOrder(cards, ["/vault/b.md", "/vault/b.md", "/vault/a.md"]);
    expect(cards.map((c) => c.name)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when order is empty", () => {
    const cards = [fileCard("a"), fileCard("b")];
    applyManualOrder(cards, []);
    expect(cards.map((c) => c.name)).toEqual(["a", "b"]);
  });
});

describe("sortCards('manual')", () => {
  it("preserves the incoming order (no-op)", () => {
    // The caller is expected to have already applied applyManualOrder.
    const cards = [fileCard("z"), fileCard("a"), fileCard("m")];
    sortCards(cards, "manual");
    expect(cards.map((c) => c.name)).toEqual(["z", "a", "m"]);
  });
});

describe("parseSelectBody — order: round-trip", () => {
  it("parses sort: manual and order: list into config", () => {
    const body =
      "path: ./\n" +
      "sort: manual\n" +
      "display: cards\n" +
      "order:\n" +
      "  - /vault/b.md\n" +
      "  - /vault/a.md\n";
    const { config } = parseSelectBody(body);
    expect(config.sort).toBe("manual");
    expect(config.order).toEqual(["/vault/b.md", "/vault/a.md"]);
  });

  it("ignores order: when not a YAML list", () => {
    const body = "path: ./\nsort: manual\ndisplay: cards\norder: bogus\n";
    const { config } = parseSelectBody(body);
    expect(config.order).toBeUndefined();
  });

  it("parseSelectBodyForBuilder pulls order through to initial", () => {
    const body =
      "sort: manual\n" +
      "display: cards\n" +
      "order:\n" +
      "  - /a.md\n" +
      "  - /b.md\n";
    const initial = parseSelectBodyForBuilder(body);
    expect(initial.sort).toBe("manual");
    expect(initial.order).toEqual(["/a.md", "/b.md"]);
  });
});

describe("buildSelectFenceFromState — order: emission", () => {
  function baseState(overrides: Record<string, unknown> = {}): Parameters<typeof buildSelectFenceFromState>[0] {
    return {
      rules: [],
      path: "./",
      display: "cards" as const,
      displayOption: "grid",
      sort: "name-asc",
      showModified: true,
      showExtensions: true,
      previewPane: false,
      kanbanField: "",
      contentWidth: "normal" as const,
      ...overrides,
    } as Parameters<typeof buildSelectFenceFromState>[0];
  }

  it("emits sort: manual + order: list when manual+order is set", () => {
    const fence = buildSelectFenceFromState(baseState({
      sort: "manual",
      order: ["/a.md", "/b.md"],
    }));
    expect(fence).toContain("sort: manual");
    expect(fence).toContain("order:");
    expect(fence).toContain("  - /a.md");
    expect(fence).toContain("  - /b.md");
  });

  it("does NOT emit order: when sort is not manual", () => {
    const fence = buildSelectFenceFromState(baseState({
      sort: "name-asc",
      order: ["/a.md"],
    }));
    expect(fence).not.toContain("order:");
  });

  it("does NOT emit order: when order is empty", () => {
    const fence = buildSelectFenceFromState(baseState({
      sort: "manual",
      order: [],
    }));
    expect(fence).not.toContain("order:");
  });

  it("round-trips sort: manual + order: through parse → build", () => {
    const original = buildSelectFenceFromState(baseState({
      sort: "manual",
      order: ["/x.md", "/y.md"],
    }));
    // Strip the ``` fences and re-parse the YAML body.
    const body = original.split("\n").slice(1, -1).join("\n");
    const { config } = parseSelectBody(body);
    expect(config.sort).toBe("manual");
    expect(config.order).toEqual(["/x.md", "/y.md"]);
  });
});

describe("parseFolderMd — order: in _folder.md", () => {
  it("parses sort: manual + order: list", () => {
    const content =
      "---\n" +
      "layout: folder-cards\n" +
      "sort: manual\n" +
      "order:\n" +
      "  - /vault/two.md\n" +
      "  - /vault/one.md\n" +
      "---\n";
    const config = parseFolderMd(content, "vault");
    expect(config.sort).toBe("manual");
    expect(config.order).toEqual(["/vault/two.md", "/vault/one.md"]);
  });

  it("treats absent order: as undefined", () => {
    const content =
      "---\n" +
      "layout: folder-cards\n" +
      "sort: name-asc\n" +
      "---\n";
    const config = parseFolderMd(content, "vault");
    expect(config.order).toBeUndefined();
  });
});

describe("attachFolderItemDrag", () => {
  it("calls onReorder with the new full order after a drag past 6px", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const a = document.createElement("div");
    a.className = "fv-test-item";
    a.dataset.path = "/a.md";
    const b = document.createElement("div");
    b.className = "fv-test-item";
    b.dataset.path = "/b.md";
    const c = document.createElement("div");
    c.className = "fv-test-item";
    c.dataset.path = "/c.md";
    container.append(a, b, c);

    // Stub bounding rects so the gap-detection has geometry to work with.
    let nextLeft = 0;
    for (const el of [a, b, c]) {
      const left = nextLeft;
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        x: left, y: 0, top: 0, bottom: 100, left, right: left + 100,
        width: 100, height: 100, toJSON: () => ({}),
      } as DOMRect);
      nextLeft += 110;
    }

    const onReorder = vi.fn();
    attachFolderItemDrag(a, container, "/a.md", ".fv-test-item[data-path]", onReorder);

    // Simulate pointerdown at (5,5), pointermove past 6px threshold to position
    // beyond c's right edge (so dragged item lands at the tail), then pointerup.
    a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 5, clientY: 5 }));
    a.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 350, clientY: 50 }));
    a.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, pointerId: 1, clientX: 350, clientY: 50 }));

    expect(onReorder).toHaveBeenCalledTimes(1);
    // Dropped beyond all siblings — a should land at the end.
    expect(onReorder.mock.calls[0][0]).toEqual(["/b.md", "/c.md", "/a.md"]);

    container.remove();
  });

  it("does NOT fire onReorder for a click below the 6px threshold", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const a = document.createElement("div");
    a.dataset.path = "/a.md";
    a.className = "fv-test-item";
    container.append(a);

    const onReorder = vi.fn();
    attachFolderItemDrag(a, container, "/a.md", ".fv-test-item[data-path]", onReorder);

    a.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 0, clientY: 0 }));
    a.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 3, clientY: 3 }));
    a.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, pointerId: 1, clientX: 3, clientY: 3 }));

    expect(onReorder).not.toHaveBeenCalled();
    container.remove();
  });
});
