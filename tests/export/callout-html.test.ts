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

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => p,
  invoke: vi.fn(),
}));

import { markdownToHtml, buildStandaloneHtml, buildPdfHtml, MINIMAL_CSS } from "../../src/lib/export";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { fencedCodePreviewField, livePreviewExtension, viewModeField } from "../../src/editor/live-preview";

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

describe("export — layout fences and tinted callouts", () => {
  const columns = [
    "```columns",
    "2",
    "> [!plain-blue] Hello",
    "> left",
    "---",
    "> [!note|purple] Titled",
    "> right",
    "```",
  ].join("\n");

  it("renders columns, columns-card, grid, and grid-card as CSS grids", () => {
    const columnsHtml = markdownToHtml(columns);
    expect(columnsHtml).toContain("md-columns");
    expect(columnsHtml).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
    expect(columnsHtml).not.toContain("language-columns");

    const card = markdownToHtml("```columns-card\n3\nA\n---\nB\n---\nC\n```");
    expect(card).toContain("md-layout-cell--card");
    expect(card).toContain("grid-template-columns:repeat(3, minmax(0, 1fr))");
    expect(card).not.toContain("language-columns-card");

    const grid = markdownToHtml("```grid\nA\n---\nB\n```");
    expect(grid).toContain("md-grid");
    expect(grid).toContain("grid-template-columns:repeat(3, minmax(0, 1fr))");
    expect(grid).not.toContain("language-grid");

    const gridCard = markdownToHtml("```grid-card wide\n2x1\nA\n---\nB\n```");
    expect(gridCard).toContain("md-layout-cell--card");
    expect(gridCard).toContain("md-block-wide");
    expect(gridCard).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
    expect(gridCard).not.toContain("<pre><code");
  });

  it("renders nested callouts and pipe background overrides inside cells", () => {
    const html = markdownToHtml(columns);
    expect(html).toContain(`data-callout="plain-blue"`);
    expect(html).toContain(`data-callout="note"`);
    expect(html).toContain(`style="--callout-color: #a371f7"`);
    expect(html).toContain("Hello");
    expect(html).toContain("Titled");

    const tinted = markdownToHtml(
      "> [!warning|red] Careful\n> body\n\n> [!plain-green]\n> ok\n\n> [!quote|#f0b429] Said\n> words",
    );
    expect(tinted).toContain(`data-callout="warning"`);
    expect(tinted).toContain(`style="--callout-color: #da3633"`);
    expect(tinted).toContain(`data-callout="plain-green"`);
    expect(tinted).toContain(`style="--callout-color: #f0b429"`);
  });

  it("converts sidebar fences to aside HTML", () => {
    const html = markdownToHtml("```sidebar\n> [!tip|yellow] Side\n> note\n```");
    expect(html).toContain("md-sidebar-right");
    expect(html).toContain(`data-callout="tip"`);
    expect(html).toContain(`style="--callout-color: #e6a817"`);
    expect(html).not.toContain("language-sidebar");
    const left = markdownToHtml("```sidebar-left full\nHello\n```");
    expect(left).toContain("md-sidebar-left");
    expect(left).toContain("md-block-full");
  });

  it("embeds column grid styles and callout background rules in standalone HTML and PDF HTML", () => {
    expect(MINIMAL_CSS).toContain(".md-layout");
    expect(MINIMAL_CSS).toContain(".md-sidebar");
    expect(MINIMAL_CSS).toContain("color-mix(in srgb, var(--callout-color)");
    expect(MINIMAL_CSS).toContain(".callout[style*=\"--callout-color\"]");

    const html = buildStandaloneHtml(columns, "Notes");
    expect(html).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
    expect(html).toContain("--callout-color: #a371f7");
    expect(html).toContain(".md-columns");
    expect(html).not.toContain("language-columns");

    const pdf = buildPdfHtml(columns, "Notes");
    expect(pdf).toContain("@page { size: letter;");
    expect(pdf).toContain("grid-template-columns:repeat(2, minmax(0, 1fr))");
    expect(pdf).toContain("--callout-color: #a371f7");
    expect(pdf).not.toContain("<pre><code class=\"language-columns\"");
  });
});

describe("live preview — columns, grids, and tinted callouts", () => {
  function preview(doc: string): HTMLElement {
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [markdown(), viewModeField, fencedCodePreviewField, livePreviewExtension],
    });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });
    return view.dom;
  }

  it("renders columns and columns-card as multi-column grids with nested callouts", () => {
    const dom = preview("```columns\n2\n> [!plain-blue] Hello\n> left\n---\n> [!note|purple] Titled\n> right\n```\n");
    const grid = dom.querySelector<HTMLElement>(".cm-columns");
    expect(grid).toBeTruthy();
    expect(grid!.style.gridTemplateColumns).toContain("repeat(2");
    expect(grid!.querySelectorAll(".cm-grid-cell").length).toBe(2);
    expect(grid!.innerHTML).toContain(`data-callout="plain-blue"`);
    expect(grid!.innerHTML).toContain(`data-callout="note"`);
    expect(grid!.innerHTML).toContain("--callout-color: #a371f7");
    expect(grid!.innerHTML).not.toContain("language-columns");

    const card = preview("```columns-card wide\n3\nA\n---\nB\n---\nC\n```\n");
    const cardGrid = card.querySelector<HTMLElement>(".cm-columns");
    expect(cardGrid!.style.gridTemplateColumns).toContain("repeat(3");
    expect(card.querySelectorAll(".cm-grid-cell--card").length).toBe(3);
    expect(card.querySelector(".cm-block-width-wide")).toBeTruthy();
  });

  it("renders grid and grid-card, keeping a bare grid count square", () => {
    const grid = preview("```grid\n4\nOnly\n```\n");
    const el = grid.querySelector<HTMLElement>(".cm-grid");
    expect(el!.style.gridTemplateColumns).toContain("repeat(4");
    expect(grid.querySelectorAll(".cm-grid-cell").length).toBe(16);

    const card = preview("```grid-card\n2x1\nA\n---\nB\n```\n");
    expect(card.querySelector<HTMLElement>(".cm-grid")!.style.gridTemplateColumns).toContain("repeat(2");
    expect(card.querySelectorAll(".cm-grid-cell--card").length).toBe(2);
  });

  it("applies --callout-color from a pipe override on the live-preview line", () => {
    const dom = preview("> [!warning|red] Careful\n> body\n\n> [!plain-green]\n> ok\n\n> [!quote|#f0b429] Said\n> words\n");
    const lines = Array.from(dom.querySelectorAll<HTMLElement>(".cm-live-callout-first"));
    const warning = lines.find((el) => el.getAttribute("data-callout") === "warning");
    const plain = lines.find((el) => el.getAttribute("data-callout") === "plain-green");
    const quote = lines.find((el) => el.getAttribute("data-callout") === "quote");
    expect(warning?.getAttribute("style")).toContain("--callout-color: #da3633");
    expect(plain?.getAttribute("data-callout")).toBe("plain-green");
    expect(quote?.getAttribute("style")).toContain("--callout-color: #f0b429");
  });
});
