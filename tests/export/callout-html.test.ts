/**
 * tests/export/callout-html.test.ts
 *
 * Vitest unit tests for the callout converter inside src/lib/export.ts.
 * We assert on the markdown → HTML transform that the exporter performs
 * before marked() runs: non-foldable callouts emit <div class="callout">,
 * foldable callouts emit <details>, the data-callout attribute carries the
 * canonical type, and nested callouts produce nested HTML elements.
 *
 * These cases lock in the Obsidian parity contract — drift here means the
 * exported HTML stops matching what the live preview shows.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/bridge", () => ({
  saveHtmlDialog: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  openFileDialog: vi.fn(),
  saveFileDialog: vi.fn(),
  updateRecentFilesMenu: vi.fn(),
}));

import { markdownToHtml } from "../../src/lib/export";

describe("export — non-foldable callouts", () => {
  it("emits a <div> with class+data-callout for a basic tip", () => {
    const html = markdownToHtml("> [!tip] Pro Tip\n> body text");
    expect(html).toContain(`class="callout callout-tip"`);
    expect(html).toContain(`data-callout="tip"`);
    expect(html).toContain("<div");
    expect(html).not.toContain("<details");
    expect(html).toContain("Pro Tip");
  });

  it("includes the icon SVG inside the title row", () => {
    const html = markdownToHtml("> [!warning] Heads up\n> body");
    expect(html).toContain(`<span class="callout-icon">`);
    expect(html).toContain("<svg");
  });
});

describe("export — foldable callouts", () => {
  it("emits <details open> for the open marker (+)", () => {
    const html = markdownToHtml("> [!note]+ Title\n> body");
    expect(html).toContain("<details");
    expect(html).toContain("open");
    expect(html).toContain(`data-callout="note"`);
  });

  it("emits <details> without open attribute for the collapsed marker (-)", () => {
    const html = markdownToHtml("> [!warning]- Hidden\n> body");
    expect(html).toContain("<details");
    expect(html).toContain(`data-callout="warning"`);
    // No literal " open>" or " open " inside the opening details tag.
    const detailsTag = html.match(/<details[^>]*>/)![0];
    expect(detailsTag).not.toMatch(/\bopen\b/);
  });

  it("uses <summary> for the title row in foldable callouts", () => {
    const html = markdownToHtml("> [!tip]+ Heads up\n> body");
    expect(html).toContain(`<summary class="callout-title">`);
  });
});

describe("export — alias resolution carries to HTML", () => {
  it("maps [!hint] to data-callout=tip with the written title 'Hint'", () => {
    const html = markdownToHtml("> [!hint]\n> body");
    expect(html).toContain(`data-callout="tip"`);
    expect(html).toContain("Hint");
  });

  it("maps [!summary] to data-callout=abstract", () => {
    const html = markdownToHtml("> [!summary]\n> body");
    expect(html).toContain(`data-callout="abstract"`);
  });
});

describe("export — custom (unknown) types fall through", () => {
  it("emits data-callout=recipe for a user-defined custom type", () => {
    const html = markdownToHtml("> [!recipe] Carbonara\n> ingredients...");
    expect(html).toContain(`data-callout="recipe"`);
    expect(html).toContain(`class="callout callout-recipe"`);
  });
});

describe("export — markdown inside the title field", () => {
  it("strips a leading `## ` and tags the title with the h2 level class", () => {
    const html = markdownToHtml("> [!tip] ## Section Title\n> body");
    expect(html).toContain(`callout-title-text-h2`);
    expect(html).toContain(">Section Title<");
    expect(html).not.toContain("## Section");
  });

  it("supports h1..h6 via 1..6 leading #s", () => {
    expect(markdownToHtml("> [!note] # Hero\n> b")).toContain("callout-title-text-h1");
    expect(markdownToHtml("> [!note] ###### Tiny\n> b")).toContain("callout-title-text-h6");
  });

  it("renders **bold** and *italic* in the title", () => {
    const html = markdownToHtml("> [!info] **Big** and *small*\n> body");
    expect(html).toContain("<strong>Big</strong>");
    expect(html).toContain("<em>small</em>");
  });
});

describe("export — markdown inside callout body", () => {
  it("renders an ATX heading inside the body as <h2>", () => {
    const html = markdownToHtml("> [!note]\n> ## Section\n> body text");
    expect(html).toContain("<h2>Section</h2>");
    expect(html).not.toContain("## Section");
  });

  it("renders bold + italic inside the body", () => {
    const html = markdownToHtml("> [!info]\n> **bold** and *italic*");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });
});

describe("export — plain variant", () => {
  it("emits NO icon span and NO title-text span when [!plain] has no title", () => {
    const html = markdownToHtml("> [!plain]\n> body content");
    expect(html).toContain(`data-callout="plain"`);
    expect(html).not.toContain(`<span class="callout-icon">`);
    expect(html).not.toContain(`<span class="callout-title-text">`);
    expect(html).toContain("body content");
  });

  it("emits the title-text span (but no icon) when [!plain] has an explicit title", () => {
    const html = markdownToHtml("> [!plain] My Box\n> body content");
    expect(html).toContain(`data-callout="plain"`);
    expect(html).not.toContain(`<span class="callout-icon">`);
    expect(html).toContain(`<span class="callout-title-text">My Box</span>`);
  });

  it("emits the chevron but no icon for a foldable plain callout with no title", () => {
    const html = markdownToHtml("> [!plain]+\n> body content");
    expect(html).toContain("<details");
    expect(html).toContain(`<span class="callout-chevron">`);
    expect(html).not.toContain(`<span class="callout-icon">`);
    expect(html).not.toContain(`<span class="callout-title-text">`);
  });
});

describe("export — nested callouts", () => {
  it("emits an inner callout block inside an outer callout's body", () => {
    const md =
      "> [!note] Outer\n" +
      "> top-level body\n" +
      "> > [!warning] Inner\n" +
      "> > nested body";
    const html = markdownToHtml(md);
    expect(html).toContain(`data-callout="note"`);
    expect(html).toContain(`data-callout="warning"`);
    // The inner block must appear before the outer's closing </div>.
    const outerStart = html.indexOf(`data-callout="note"`);
    const innerStart = html.indexOf(`data-callout="warning"`);
    expect(outerStart).toBeGreaterThanOrEqual(0);
    expect(innerStart).toBeGreaterThan(outerStart);
  });
});
