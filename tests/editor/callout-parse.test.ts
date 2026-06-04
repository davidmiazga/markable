/**
 * tests/editor/callout-parse.test.ts
 *
 * Vitest unit tests for src/editor/callouts.ts — the shared callout parser
 * that both live-preview and HTML export depend on. Drift here would split
 * the two paths visually, so the cases below pin every Obsidian-parity
 * behavior we care about: alias resolution, fold markers, default title
 * casing, depth detection, and custom-type fall-through.
 */

import { describe, it, expect } from "vitest";
import {
  parseCalloutHeader,
  parseCalloutTitle,
  CALLOUT_ALIASES,
  CALLOUT_TYPES,
  isPlainCallout,
  stripBlockquotePrefix,
} from "../../src/editor/callouts";

describe("parseCalloutHeader — happy paths", () => {
  it("parses a basic note callout with no title", () => {
    const h = parseCalloutHeader("> [!note]");
    expect(h).not.toBeNull();
    expect(h!.canonical).toBe("note");
    expect(h!.written).toBe("Note");
    expect(h!.fold).toBe("");
    expect(h!.title).toBe("");
    expect(h!.depth).toBe(1);
  });

  it("parses a callout with an explicit title override", () => {
    const h = parseCalloutHeader("> [!tip] Pro Tip Inside")!;
    expect(h.canonical).toBe("tip");
    expect(h.title).toBe("Pro Tip Inside");
  });

  it("returns null for a non-callout blockquote line", () => {
    expect(parseCalloutHeader("> just a quote")).toBeNull();
  });

  it("returns null for a non-blockquote line", () => {
    expect(parseCalloutHeader("plain paragraph")).toBeNull();
  });
});

describe("parseCalloutHeader — alias resolution", () => {
  it("resolves hint to tip", () => {
    const h = parseCalloutHeader("> [!hint]")!;
    expect(h.canonical).toBe("tip");
    expect(h.written).toBe("Hint");
  });

  it("resolves summary to abstract", () => {
    const h = parseCalloutHeader("> [!summary]")!;
    expect(h.canonical).toBe("abstract");
    expect(h.written).toBe("Summary");
  });

  it("resolves fail to failure", () => {
    const h = parseCalloutHeader("> [!fail]")!;
    expect(h.canonical).toBe("failure");
    expect(h.written).toBe("Fail");
  });

  it("resolves error to danger", () => {
    const h = parseCalloutHeader("> [!error]")!;
    expect(h.canonical).toBe("danger");
    expect(h.written).toBe("Error");
  });
});

describe("parseCalloutHeader — fold markers", () => {
  it("recognizes the open marker (+)", () => {
    expect(parseCalloutHeader("> [!tip]+")!.fold).toBe("+");
  });
  it("recognizes the collapsed marker (-)", () => {
    expect(parseCalloutHeader("> [!tip]-")!.fold).toBe("-");
  });
  it("returns empty fold when no marker is present", () => {
    expect(parseCalloutHeader("> [!tip]")!.fold).toBe("");
  });
  it("keeps title after fold marker", () => {
    const h = parseCalloutHeader("> [!warning]- Hidden")!;
    expect(h.fold).toBe("-");
    expect(h.title).toBe("Hidden");
  });
});

describe("parseCalloutHeader — depth detection (nested)", () => {
  it("returns depth 1 for a top-level callout", () => {
    expect(parseCalloutHeader("> [!note]")!.depth).toBe(1);
  });
  it("returns depth 2 for a nested callout", () => {
    expect(parseCalloutHeader("> > [!warning]")!.depth).toBe(2);
  });
  it("returns depth 3 for triple nesting", () => {
    expect(parseCalloutHeader("> > > [!bug]")!.depth).toBe(3);
  });
});

describe("parseCalloutHeader — custom (unknown) types", () => {
  it("passes unknown types through as their own canonical", () => {
    const h = parseCalloutHeader("> [!recipe]")!;
    expect(h.canonical).toBe("recipe");
    expect(h.written).toBe("Recipe");
  });

  it("lowercases the canonical even when written in mixed case", () => {
    const h = parseCalloutHeader("> [!RECIPE]")!;
    expect(h.canonical).toBe("recipe");
    expect(h.written).toBe("Recipe");
  });
});

describe("parseCalloutHeader — plain variant", () => {
  it("parses a bare plain callout (no icon, no default title)", () => {
    const h = parseCalloutHeader("> [!plain]")!;
    expect(h.canonical).toBe("plain");
    expect(h.title).toBe("");
    expect(h.written).toBe("Plain");
    expect(h.fold).toBe("");
  });

  it("preserves an explicit title on a plain callout", () => {
    const h = parseCalloutHeader("> [!plain] My Container")!;
    expect(h.canonical).toBe("plain");
    expect(h.title).toBe("My Container");
  });

  it("supports the fold marker on plain", () => {
    expect(parseCalloutHeader("> [!plain]+")!.fold).toBe("+");
    expect(parseCalloutHeader("> [!plain]-")!.fold).toBe("-");
  });
});

describe("parseCalloutHeader — plain color variants", () => {
  it("parses each plain-<color> variant as its own canonical", () => {
    for (const color of ["blue", "cyan", "green", "yellow", "orange", "red", "purple"]) {
      const h = parseCalloutHeader(`> [!plain-${color}]`)!;
      expect(h.canonical).toBe(`plain-${color}`);
      expect(h.title).toBe("");
    }
  });

  it("preserves an explicit title on a plain-color callout", () => {
    const h = parseCalloutHeader("> [!plain-blue] Heads up")!;
    expect(h.canonical).toBe("plain-blue");
    expect(h.title).toBe("Heads up");
  });

  it("supports the fold marker on plain-color variants", () => {
    expect(parseCalloutHeader("> [!plain-red]+")!.fold).toBe("+");
    expect(parseCalloutHeader("> [!plain-red]-")!.fold).toBe("-");
  });

  it("isPlainCallout returns true for plain and every plain-<color>", () => {
    expect(isPlainCallout("plain")).toBe(true);
    expect(isPlainCallout("plain-blue")).toBe(true);
    expect(isPlainCallout("plain-purple")).toBe(true);
  });

  it("isPlainCallout returns false for non-plain canonicals", () => {
    expect(isPlainCallout("note")).toBe(false);
    expect(isPlainCallout("tip")).toBe(false);
    expect(isPlainCallout("plainview")).toBe(false); // no hyphen → not a variant
  });
});

describe("CALLOUT_ALIASES + CALLOUT_TYPES integrity", () => {
  it("contains 21 canonical types (13 Obsidian + plain + 7 plain-color variants)", () => {
    expect(CALLOUT_TYPES.length).toBe(21);
  });

  it("maps every alias to a known canonical type", () => {
    for (const canonical of Object.values(CALLOUT_ALIASES)) {
      expect(CALLOUT_TYPES).toContain(canonical);
    }
  });
});

describe("parseCalloutTitle — heading marker detection", () => {
  it("extracts h2 level from `## Title`", () => {
    expect(parseCalloutTitle("## Section")).toEqual({ level: 2, rest: "Section" });
  });
  it("extracts h1 from `# Title`", () => {
    expect(parseCalloutTitle("# Hero")).toEqual({ level: 1, rest: "Hero" });
  });
  it("extracts h6 from `###### Title`", () => {
    expect(parseCalloutTitle("###### Small")).toEqual({ level: 6, rest: "Small" });
  });
  it("returns level 0 when there is no heading marker", () => {
    expect(parseCalloutTitle("Plain title")).toEqual({ level: 0, rest: "Plain title" });
  });
  it("rejects too-deep markers (>6 #s)", () => {
    expect(parseCalloutTitle("####### x")).toEqual({ level: 0, rest: "####### x" });
  });
  it("requires a space after the markers", () => {
    expect(parseCalloutTitle("##NoSpace")).toEqual({ level: 0, rest: "##NoSpace" });
  });
});

describe("stripBlockquotePrefix", () => {
  it("strips one level of `> ` prefix", () => {
    expect(stripBlockquotePrefix("> body", 1)).toBe("body");
  });
  it("strips two levels for nested content", () => {
    expect(stripBlockquotePrefix("> > nested", 2)).toBe("nested");
  });
  it("returns null when there are fewer prefix levels than requested", () => {
    expect(stripBlockquotePrefix("plain", 1)).toBeNull();
  });
});
