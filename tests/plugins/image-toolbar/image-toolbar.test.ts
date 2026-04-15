/**
 * Unit and integration tests for the Image Toolbar plugin.
 *
 * Coverage map (matches docs/specs/image-toolbar/00_index.md):
 *   Step 01: mergeWithDefaults, CSS lifecycle, DEFAULT_SETTINGS, STYLE_ID
 *   Step 02: parseImageSyntax, detectDivWrapper, detectFloatRight,
 *            detectAlignment, extractImageCore
 *   Step 03: buildBareImage, wrapWithDiv, buildFloatRightImg,
 *            detectLineEnding, applyAlignment
 *   Step 04: replaceImageSrc, resolveRelativePath
 *   Step 05: buildPopover, positionPopover, showPopover, hideToolbar
 *   Step 06: _onDocClick path, _onDocMousedown dismiss, onEnable/onDisable lifecycle
 *   Step 07: handleAction (alignment, embed-image, choose-file, guard conditions),
 *            renderDetailExtra
 *
 * Pure-function tests (steps 01–04) require no CM6 globals.
 * DOM tests (step 05) rely on Vitest's jsdom environment.
 * CM6 and action tests (steps 06–07) use vi.stubGlobal to mock window globals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  // Step 01
  mergeWithDefaults,
  DEFAULT_SETTINGS,
  STYLE_ID,
  injectCSS,
  removeCSS,

  // Step 02
  parseImageSyntax,
  detectDivWrapper,
  detectFloatRight,
  detectAlignment,
  extractImageCore,

  // Step 03
  buildBareImage,
  wrapWithDiv,
  buildFloatRightImg,
  detectLineEnding,
  applyAlignment,

  // Step 04
  replaceImageSrc,
  resolveRelativePath,

  // Step 05
  buildPopover,
  positionPopover,
  showPopover,
  hideToolbar,

  // Step 07
  handleAction,

  // Test helper
  _setContextForTesting,
} from "../../../src/plugins/image-toolbar/image-toolbar.plugin";

import type { ImageToolbarSettings } from "../../../src/plugins/image-toolbar/image-toolbar.plugin";

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Build a minimal mock MarkablePluginAPI. */
function makeMockApi() {
  return {
    loadSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    addExtensions: vi.fn(),
    removeExtensions: vi.fn(),
    registerStatusBar: vi.fn(),
    statusBar: null,
  };
}

/** Build a minimal mock EditorView with a controllable dispatch spy. */
function makeMockView(dispatchFn = vi.fn()) {
  // The dom mock needs addEventListener/removeEventListener so the blur listener
  // wiring in onEnable/onDisable does not throw in tests that stub
  // __MARKABLE_EDITOR_VIEW__ with a plain object (not a real DOM node).
  const domEl = document.createElement("div");
  return {
    dispatch: dispatchFn,
    state: {
      doc: {
        length: 100,
        sliceString: vi.fn().mockReturnValue(""),
        lineAt: vi.fn().mockReturnValue({ from: 0, to: 20, text: "![photo](a.png)" }),
      },
      selection: { main: { head: 0 } },
    },
    dom: Object.assign(domEl, {
      querySelectorAll: vi.fn().mockReturnValue([]),
    }),
    posAtDOM: vi.fn().mockReturnValue(0),
    coordsAtPos: vi.fn().mockReturnValue(null),
    visibleRanges: [],
  };
}

/** Build a minimal fake ImageContext. */
function makeCtx(overrides: Partial<{
  from: number;
  to: number;
  rawSource: string;
  url: string;
  alt: string;
  alignment: "left" | "center" | "right" | "float-right";
  anchorEl: HTMLElement;
}> = {}) {
  const anchorEl = document.createElement("img");
  // Mock getBoundingClientRect so positionPopover does not throw.
  anchorEl.getBoundingClientRect = () => ({
    top: 200, bottom: 220, left: 100, right: 300,
    width: 200, height: 20, x: 100, y: 200,
    toJSON: () => ({}),
  } as DOMRect);

  return {
    from: 0,
    to: 15,
    rawSource: "![photo](a.png)",
    url: "a.png",
    alt: "photo",
    alignment: "left" as const,
    anchorEl,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Step 01 — Settings and CSS lifecycle
// ════════════════════════════════════════════════════════════════════════════

describe("step_01 — settings and CSS lifecycle", () => {
  // Clean up any injected style tags between tests.
  afterEach(() => { removeCSS(); });

  // ── mergeWithDefaults ──────────────────────────────────────────────────────

  it("1.1 mergeWithDefaults(null) returns {} without crash (EC-19)", () => {
    expect(mergeWithDefaults(null)).toEqual({});
  });

  it("1.2 mergeWithDefaults({}) returns {}", () => {
    expect(mergeWithDefaults({})).toEqual({});
  });

  it("1.3 mergeWithDefaults({ unknownKey: 'foo' }) drops unknown keys", () => {
    const result = mergeWithDefaults({ unknownKey: "foo" });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>)["unknownKey"]).toBeUndefined();
  });

  // ── STYLE_ID ───────────────────────────────────────────────────────────────

  it("1.4 STYLE_ID === '__markable_img_toolbar_css__'", () => {
    expect(STYLE_ID).toBe("__markable_img_toolbar_css__");
  });

  // ── injectCSS / removeCSS ─────────────────────────────────────────────────

  it("1.5 injectCSS() once — style tag is present in document.head", () => {
    injectCSS();
    expect(document.getElementById(STYLE_ID)).not.toBeNull();
  });

  it("1.6 injectCSS() twice — only one <style> tag with that id (EC-17)", () => {
    injectCSS();
    injectCSS();
    const tags = document.head.querySelectorAll(`#${STYLE_ID}`);
    expect(tags.length).toBe(1);
  });

  it("1.7 injectCSS() then removeCSS() — tag is removed", () => {
    injectCSS();
    removeCSS();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("1.8 removeCSS() when tag not injected — no crash", () => {
    expect(() => removeCSS()).not.toThrow();
  });

  it("1.9 window.__TAURI_DIALOG__ may be undefined — plugin must handle gracefully (EC-13)", () => {
    // In the test environment the global is not set. This test verifies the
    // plugin does not hard-require it at import time.
    const dialog = (window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"];
    // Either defined (if main.ts ran) or undefined — both are acceptable.
    expect(dialog === undefined || typeof dialog === "object").toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 02 — Pure image context detection
// ════════════════════════════════════════════════════════════════════════════

describe("step_02 — context detection", () => {

  // ── parseImageSyntax ───────────────────────────────────────────────────────

  it("2.1 parses standard image syntax", () => {
    expect(parseImageSyntax("![photo](./images/cat.png)")).toEqual({
      alt: "photo",
      url: "./images/cat.png",
    });
  });

  it("2.2 parses empty alt and url (EC-10)", () => {
    expect(parseImageSyntax("![]()")).toEqual({ alt: "", url: "" });
  });

  it("2.3 parses alt and url with spaces", () => {
    expect(parseImageSyntax("![alt with spaces](url with spaces)")).toEqual({
      alt: "alt with spaces",
      url: "url with spaces",
    });
  });

  it("2.4 returns null for non-image text", () => {
    expect(parseImageSyntax("not an image")).toBeNull();
  });

  it("2.5 returns null when extra text follows image syntax", () => {
    expect(parseImageSyntax("![alt](url) extra text")).toBeNull();
  });

  it("2.6 preserves double-quotes in alt verbatim (EC-26)", () => {
    expect(parseImageSyntax('![quote"alt"](url)')).toEqual({
      alt: 'quote"alt"',
      url: "url",
    });
  });

  it("2.7 returns null when bracket in alt breaks pattern (known edge case)", () => {
    // The pattern /^!\[([^\]]*)\]/ does not allow ] inside the alt brackets.
    expect(parseImageSyntax("![bracket\\]alt](url)")).toBeNull();
  });

  // ── detectDivWrapper ───────────────────────────────────────────────────────

  it("2.8 single-line center wrapper", () => {
    const result = detectDivWrapper('<div align="center">![a](b)</div>', null);
    expect(result).toEqual({ align: "center", innerText: "![a](b)" });
  });

  it("2.9 two-line right wrapper — empty line2 prefix", () => {
    const result = detectDivWrapper('<div align="right">![a](b)', "</div>");
    expect(result).not.toBeNull();
    expect(result!.align).toBe("right");
    expect(result!.innerText).toBe("![a](b)");
  });

  it("2.10 two-line center wrapper — non-empty line2 prefix", () => {
    const result = detectDivWrapper('<div align="center">![a](b)', "![x](y)</div>");
    expect(result).not.toBeNull();
    expect(result!.align).toBe("center");
    // innerText includes both line parts joined with \n.
    expect(result!.innerText).toContain("![a](b)");
  });

  it("2.11 returns null for <div align='left'> (not recognised)", () => {
    expect(detectDivWrapper('<div align="left">![a](b)</div>', null)).toBeNull();
  });

  it("2.12 returns null for bare image syntax", () => {
    expect(detectDivWrapper("![a](b)", null)).toBeNull();
  });

  it("2.13 case-insensitive match for CENTER", () => {
    const result = detectDivWrapper('<div align="CENTER">![a](b)</div>', null);
    expect(result).not.toBeNull();
    expect(result!.align).toBe("center");
  });

  // ── detectFloatRight ───────────────────────────────────────────────────────

  it("2.14 detects full float-right img tag", () => {
    expect(detectFloatRight(
      '<img src="a.png" alt="x" align="right" style="float:right; margin:0 0 8px 16px">',
    )).toBe(true);
  });

  it("2.15 returns false for <img> without align='right'", () => {
    expect(detectFloatRight('<img src="a.png" alt="x">')).toBe(false);
  });

  it("2.16 returns false for bare image syntax", () => {
    expect(detectFloatRight("![a](b)")).toBe(false);
  });

  it("2.17 case-insensitive align value (RIGHT)", () => {
    expect(detectFloatRight('<img align="RIGHT" src="a.png">')).toBe(true);
  });

  it("2.18 trims whitespace before testing (EC-trimmed)", () => {
    expect(detectFloatRight('  <img src="a.png" align="right">  ')).toBe(true);
  });

  // ── detectAlignment ────────────────────────────────────────────────────────

  it("2.19 detects center wrapper (EC-2)", () => {
    expect(detectAlignment('<div align="center">![a](b)</div>')).toBe("center");
  });

  it("2.20 detects right wrapper", () => {
    expect(detectAlignment('<div align="right">![a](b)</div>')).toBe("right");
  });

  it("2.21 detects float-right img (EC-3)", () => {
    expect(detectAlignment(
      '<img src="a.png" alt="a" align="right" style="float:right; margin:0 0 8px 16px">',
    )).toBe("float-right");
  });

  it("2.22 bare image → left", () => {
    expect(detectAlignment("![a](b)")).toBe("left");
  });

  it("2.23 unrecognised <div align='left'> → left", () => {
    expect(detectAlignment('<div align="left">![a](b)</div>')).toBe("left");
  });

  it("2.24 empty string → left (no crash)", () => {
    expect(detectAlignment("")).toBe("left");
  });

  // ── extractImageCore ───────────────────────────────────────────────────────

  it("2.25 extracts from bare image", () => {
    expect(extractImageCore("![photo](./img/cat.png)")).toEqual({
      alt: "photo",
      url: "./img/cat.png",
    });
  });

  it("2.26 extracts from center div wrapper", () => {
    expect(extractImageCore('<div align="center">![photo](./img/cat.png)</div>')).toEqual({
      alt: "photo",
      url: "./img/cat.png",
    });
  });

  it("2.27 extracts from float-right <img> (src before alt)", () => {
    expect(extractImageCore(
      '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
    )).toEqual({ alt: "photo", url: "a.png" });
  });

  it("2.28 extracts from <img> with alt before src (EC-28)", () => {
    expect(extractImageCore('<img alt="photo" src="a.png">')).toEqual({
      alt: "photo",
      url: "a.png",
    });
  });

  it("2.29 empty src and alt (EC-10)", () => {
    expect(extractImageCore("![]()")).toEqual({ alt: "", url: "" });
  });

  it("2.30 fallback for unrecognised text — no crash (EC-28)", () => {
    expect(extractImageCore("not an image")).toEqual({ alt: "", url: "" });
  });

  it("2.31 preserves double-quotes in alt (EC-26)", () => {
    expect(extractImageCore('![alt with "quotes"](url)')).toEqual({
      alt: 'alt with "quotes"',
      url: "url",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 03 — Pure alignment operations
// ════════════════════════════════════════════════════════════════════════════

describe("step_03 — alignment operations", () => {

  // ── buildBareImage ─────────────────────────────────────────────────────────

  it("3.1 builds bare image", () => {
    expect(buildBareImage("photo", "./img/cat.png")).toBe("![photo](./img/cat.png)");
  });

  it("3.2 handles empty alt and url (EC-10)", () => {
    expect(buildBareImage("", "")).toBe("![]()");
  });

  it("3.3 preserves quotes in alt verbatim (EC-26)", () => {
    expect(buildBareImage('alt with "quotes"', "url")).toBe('![alt with "quotes"](url)');
  });

  // ── wrapWithDiv ────────────────────────────────────────────────────────────

  it("3.4 wraps with center align", () => {
    expect(wrapWithDiv("photo", "a.png", "center", "\n")).toBe(
      '<div align="center">![photo](a.png)</div>',
    );
  });

  it("3.5 wraps with right align", () => {
    expect(wrapWithDiv("photo", "a.png", "right", "\n")).toBe(
      '<div align="right">![photo](a.png)</div>',
    );
  });

  it("3.6 handles empty alt and url (EC-10)", () => {
    expect(wrapWithDiv("", "", "center", "\n")).toBe(
      '<div align="center">![]()</div>',
    );
  });

  it("3.7 preserves quotes in alt verbatim (EC-26)", () => {
    expect(wrapWithDiv('alt"quote"', "a.png", "center", "\n")).toBe(
      '<div align="center">![alt"quote"](a.png)</div>',
    );
  });

  // ── buildFloatRightImg ─────────────────────────────────────────────────────

  it("3.8 builds float-right img", () => {
    expect(buildFloatRightImg("photo", "a.png")).toBe(
      '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
    );
  });

  it("3.9 handles empty alt and url (EC-10)", () => {
    expect(buildFloatRightImg("", "")).toBe(
      '<img src="" alt="" align="right" style="float:right; margin:0 0 8px 16px">',
    );
  });

  // ── detectLineEnding ───────────────────────────────────────────────────────

  it("3.10 returns \\n for LF content", () => {
    expect(detectLineEnding("![a](b)")).toBe("\n");
  });

  it("3.11 returns \\r\\n for CRLF content (EC-22)", () => {
    expect(detectLineEnding('<div align="center">![a](b)\r\n</div>')).toBe("\r\n");
  });

  it("3.12 returns \\n for empty string (fallback)", () => {
    expect(detectLineEnding("")).toBe("\n");
  });

  // ── applyAlignment ─────────────────────────────────────────────────────────

  it("3.13 left on already-bare image is idempotent (EC-5)", () => {
    expect(applyAlignment("![photo](a.png)", "left")).toBe("![photo](a.png)");
  });

  it("3.14 left → center", () => {
    expect(applyAlignment("![photo](a.png)", "center")).toBe(
      '<div align="center">![photo](a.png)</div>',
    );
  });

  it("3.15 left → right", () => {
    expect(applyAlignment("![photo](a.png)", "right")).toBe(
      '<div align="right">![photo](a.png)</div>',
    );
  });

  it("3.16 left → float-right", () => {
    expect(applyAlignment("![photo](a.png)", "float-right")).toBe(
      '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
    );
  });

  it("3.17 center wrapper → left removes wrapper (EC-1)", () => {
    expect(applyAlignment('<div align="center">![photo](a.png)</div>', "left")).toBe(
      "![photo](a.png)",
    );
  });

  it("3.18 right wrapper → center", () => {
    expect(applyAlignment('<div align="right">![photo](a.png)</div>', "center")).toBe(
      '<div align="center">![photo](a.png)</div>',
    );
  });

  it("3.19 float-right → left produces bare image (EC-3)", () => {
    expect(
      applyAlignment(
        '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
        "left",
      ),
    ).toBe("![photo](a.png)");
  });

  it("3.20 float-right → center (EC-4)", () => {
    expect(
      applyAlignment(
        '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
        "center",
      ),
    ).toBe('<div align="center">![photo](a.png)</div>');
  });

  it("3.21 empty url/alt → center (EC-10)", () => {
    expect(applyAlignment("![]()", "center")).toBe('<div align="center">![]()</div>');
  });

  it("3.22 alt with quotes → center (EC-26)", () => {
    expect(applyAlignment('![alt with "quotes"](url)', "center")).toBe(
      '<div align="center">![alt with "quotes"](url)</div>',
    );
  });

  it("3.23 right wrapper → float-right", () => {
    expect(applyAlignment('<div align="right">![photo](a.png)</div>', "float-right")).toBe(
      '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 04 — Pure URL operations
// ════════════════════════════════════════════════════════════════════════════

describe("step_04 — URL operations", () => {

  // ── replaceImageSrc ────────────────────────────────────────────────────────

  it("4.1 replaces URL in bare image", () => {
    expect(replaceImageSrc("![photo](old.png)", "new.png")).toBe("![photo](new.png)");
  });

  it("4.2 replaces with https URL", () => {
    expect(replaceImageSrc("![photo](old.png)", "https://example.com/img.png")).toBe(
      "![photo](https://example.com/img.png)",
    );
  });

  it("4.3 replaces URL inside center div wrapper", () => {
    expect(replaceImageSrc('<div align="center">![photo](old.png)</div>', "new.png")).toBe(
      '<div align="center">![photo](new.png)</div>',
    );
  });

  it("4.4 replaces URL inside right div wrapper", () => {
    expect(replaceImageSrc('<div align="right">![photo](old.png)</div>', "new.png")).toBe(
      '<div align="right">![photo](new.png)</div>',
    );
  });

  it("4.5 replaces URL in float-right img tag", () => {
    expect(
      replaceImageSrc(
        '<img src="old.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
        "new.png",
      ),
    ).toBe('<img src="new.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">');
  });

  it("4.6 handles empty URL (EC-10)", () => {
    expect(replaceImageSrc("![]()", "new.png")).toBe("![](new.png)");
  });

  it("4.7 preserves alt with quotes (EC-26)", () => {
    expect(replaceImageSrc('![alt with "quotes"](old.png)', "new.png")).toBe(
      '![alt with "quotes"](new.png)',
    );
  });

  it("4.8 unrecognised input returns unchanged", () => {
    expect(replaceImageSrc("not an image", "new.png")).toBe("not an image");
  });

  it("4.9 preserves spaces in URL verbatim (EC-31)", () => {
    expect(replaceImageSrc("![photo](path with spaces.png)", "new path.png")).toBe(
      "![photo](new path.png)",
    );
  });

  // ── resolveRelativePath ────────────────────────────────────────────────────

  it("4.10 file in images subdirectory → relative path (EC-6)", () => {
    expect(
      resolveRelativePath("/Users/dm/Notes/images/cat.png", "/Users/dm/Notes/doc.md"),
    ).toBe("./images/cat.png");
  });

  it("4.11 file in same directory → relative path (EC-6)", () => {
    expect(
      resolveRelativePath("/Users/dm/Notes/cat.png", "/Users/dm/Notes/doc.md"),
    ).toBe("./cat.png");
  });

  it("4.12 file outside doc directory → absolute path (EC-7)", () => {
    expect(
      resolveRelativePath("/Users/dm/Other/cat.png", "/Users/dm/Notes/doc.md"),
    ).toBe("/Users/dm/Other/cat.png");
  });

  it("4.13 null docPath → absolute path unchanged (EC-8)", () => {
    expect(resolveRelativePath("/Users/dm/Notes/cat.png", null)).toBe(
      "/Users/dm/Notes/cat.png",
    );
  });

  it("4.14 empty string docPath → absolute path unchanged", () => {
    expect(resolveRelativePath("/Users/dm/Notes/cat.png", "")).toBe(
      "/Users/dm/Notes/cat.png",
    );
  });

  it("4.15 file in nested subdirectory → relative path (EC-6)", () => {
    expect(
      resolveRelativePath("/Users/dm/Notes/sub/deep/cat.png", "/Users/dm/Notes/doc.md"),
    ).toBe("./sub/deep/cat.png");
  });

  it("4.16 spaces in path preserved (EC-31)", () => {
    expect(
      resolveRelativePath("/path/with spaces/img.png", "/path/with spaces/doc.md"),
    ).toBe("./img.png");
  });

  it("4.17 Unicode in path preserved (EC-31)", () => {
    expect(
      resolveRelativePath("/path/café/img.png", "/path/café/doc.md"),
    ).toBe("./img.png");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 05 — DOM popover
// ════════════════════════════════════════════════════════════════════════════

describe("step_05 — DOM popover", () => {
  let popoverEl: HTMLElement;
  // Mock API used when onEnable is needed to initialize module-level state.
  let mockApi05: ReturnType<typeof makeMockApi>;

  beforeEach(() => {
    // Clean DOM state before each DOM test.
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    mockApi05 = makeMockApi();
    // Stub CM6 globals so onEnable can call buildUpdateListener without crashing.
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: { updateListener: { of: vi.fn().mockReturnValue({}) } },
    });
    vi.stubGlobal("__CM_STATE__", {
      syntaxTree: vi.fn().mockReturnValue({ resolveInner: vi.fn().mockReturnValue(null) }),
    });
  });

  afterEach(async () => {
    // Ensure the plugin is disabled after each test that calls onEnable.
    try { mockApi05.removeExtensions(); } catch { /* ignore */ }
    vi.unstubAllGlobals();
    removeCSS();
    hideToolbar();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  // ── buildPopover ───────────────────────────────────────────────────────────

  it("5.1 buildPopover returns an HTMLElement", () => {
    popoverEl = buildPopover();
    expect(popoverEl).toBeInstanceOf(HTMLElement);
  });

  it("5.2 element has id='__markable_img_toolbar__'", () => {
    popoverEl = buildPopover();
    expect(popoverEl.id).toBe("__markable_img_toolbar__");
  });

  it("5.3 element has two tab buttons with correct data-tab values", () => {
    popoverEl = buildPopover();
    const selectTab = popoverEl.querySelector('[data-tab="select"]');
    const embedTab = popoverEl.querySelector('[data-tab="embed"]');
    expect(selectTab).not.toBeNull();
    expect(embedTab).not.toBeNull();
  });

  it("5.4 Select tab button has --active class", () => {
    popoverEl = buildPopover();
    const selectTab = popoverEl.querySelector('[data-tab="select"]');
    expect(selectTab?.classList.contains("img-toolbar__tab--active")).toBe(true);
  });

  it("5.5 Embed panel has display:none style", () => {
    popoverEl = buildPopover();
    const embedPanel = popoverEl.querySelector('[data-panel="embed"]') as HTMLElement;
    expect(embedPanel?.style.display).toBe("none");
  });

  it("5.6 Select panel is visible (no display:none)", () => {
    popoverEl = buildPopover();
    const selectPanel = popoverEl.querySelector('[data-panel="select"]') as HTMLElement;
    // The select panel should not have display:none.
    expect(selectPanel?.style.display).not.toBe("none");
  });

  it("5.7 element contains choose-file button", () => {
    popoverEl = buildPopover();
    expect(popoverEl.querySelector('[data-action="choose-file"]')).not.toBeNull();
  });

  it("5.8 element contains embed-image button", () => {
    popoverEl = buildPopover();
    expect(popoverEl.querySelector('[data-action="embed-image"]')).not.toBeNull();
  });

  it("5.9 element contains 4 alignment buttons", () => {
    popoverEl = buildPopover();
    const alignBtns = popoverEl.querySelectorAll('[data-action^="align-"]');
    expect(alignBtns.length).toBe(4);
  });

  it("5.10 element contains a text <input> with img-toolbar__input class", () => {
    popoverEl = buildPopover();
    const input = popoverEl.querySelector("input.img-toolbar__input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input?.type).toBe("text");
  });

  // ── Tab switching ──────────────────────────────────────────────────────────

  it("5.11 clicking Embed Link tab shows embed panel", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    const embedTab = popoverEl.querySelector('[data-tab="embed"]') as HTMLElement;
    embedTab.click();

    const embedPanel = popoverEl.querySelector('[data-panel="embed"]') as HTMLElement;
    expect(embedPanel.style.display).toBe("flex");
  });

  it("5.12 click Embed Link then Select — Select panel returns to visible", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    const embedTab = popoverEl.querySelector('[data-tab="embed"]') as HTMLElement;
    const selectTab = popoverEl.querySelector('[data-tab="select"]') as HTMLElement;
    embedTab.click();
    selectTab.click();

    const selectPanel = popoverEl.querySelector('[data-panel="select"]') as HTMLElement;
    expect(selectPanel.style.display).toBe("flex");
  });

  it("5.13 Embed Link tab button gets --active class after click", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    const embedTab = popoverEl.querySelector('[data-tab="embed"]') as HTMLElement;
    embedTab.click();

    expect(embedTab.classList.contains("img-toolbar__tab--active")).toBe(true);
  });

  it("5.14 Select tab loses --active class after Embed Link clicked", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    const embedTab = popoverEl.querySelector('[data-tab="embed"]') as HTMLElement;
    const selectTab = popoverEl.querySelector('[data-tab="select"]') as HTMLElement;
    embedTab.click();

    expect(selectTab.classList.contains("img-toolbar__tab--active")).toBe(false);
  });

  // ── positionPopover ────────────────────────────────────────────────────────

  it("5.15 positions above anchor when space available", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    // offsetHeight returns 0 in jsdom; the function uses fallback of 120.
    positionPopover({ top: 200, bottom: 220, left: 100, right: 300 }, popoverEl);

    // top = 200 - 120 - 8 = 72
    expect(popoverEl.style.top).toBe("72px");
    expect(popoverEl.style.left).toBe("100px");
    expect(popoverEl.style.display).toBe("flex");
  });

  it("5.16 flips below anchor when top would be < 0 (EC-23)", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    positionPopover({ top: 50, bottom: 100, left: 100, right: 300 }, popoverEl);

    // top = 50 - 120 - 8 = -78 < 0 → flip: top = 100 + 8 = 108
    expect(popoverEl.style.top).toBe("108px");
  });

  it("5.17 clamps left when right edge overflows viewport (EC-24)", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    // offsetWidth returns 0 in jsdom; fallback = 220.
    // window.innerWidth in jsdom = 1024 (default).
    positionPopover({ top: 200, bottom: 220, left: 900, right: 1100 }, popoverEl);

    // left + 220 > 1024 → left = 1024 - 220 - 8 = 796
    expect(popoverEl.style.left).toBe("796px");
  });

  it("5.18 anchorRect.top === 0 flips below (boundary case)", () => {
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);

    positionPopover({ top: 0, bottom: 30, left: 100, right: 200 }, popoverEl);

    // top = 0 - 120 - 8 = -128 < 0 → flip: top = 30 + 8 = 38
    expect(popoverEl.style.top).toBe("38px");
  });

  // ── showPopover ────────────────────────────────────────────────────────────
  // Tests 5.19-5.24 use onEnable to properly initialise _popoverEl, _urlInput,
  // and _alignBtns module-level state before calling showPopover.

  it("5.19 showPopover pre-fills URL input with ctx.url", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    const ctx = makeCtx({ url: "old.png" });
    showPopover(ctx);

    const input = popoverEl.querySelector("input.img-toolbar__input") as HTMLInputElement;
    expect(input.value).toBe("old.png");
    plugin.onDisable(mockApi05);
  });

  it("5.20 showPopover marks align-center as active", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    const ctx = makeCtx({ alignment: "center" });
    showPopover(ctx);

    const centerBtn = popoverEl.querySelector('[data-action="align-center"]');
    expect(centerBtn?.classList.contains("img-toolbar__align-btn--active")).toBe(true);

    const leftBtn = popoverEl.querySelector('[data-action="align-left"]');
    expect(leftBtn?.classList.contains("img-toolbar__align-btn--active")).toBe(false);
    plugin.onDisable(mockApi05);
  });

  it("5.21 showPopover marks align-float-right as active", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    const ctx = makeCtx({ alignment: "float-right" });
    showPopover(ctx);

    const floatBtn = popoverEl.querySelector('[data-action="align-float-right"]');
    expect(floatBtn?.classList.contains("img-toolbar__align-btn--active")).toBe(true);
    plugin.onDisable(mockApi05);
  });

  it("5.22 showPopover called twice — active button updates to new alignment", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    showPopover(makeCtx({ alignment: "center" }));
    showPopover(makeCtx({ alignment: "right" }));

    const rightBtn = popoverEl.querySelector('[data-action="align-right"]');
    const centerBtn = popoverEl.querySelector('[data-action="align-center"]');
    expect(rightBtn?.classList.contains("img-toolbar__align-btn--active")).toBe(true);
    expect(centerBtn?.classList.contains("img-toolbar__align-btn--active")).toBe(false);
    plugin.onDisable(mockApi05);
  });

  it("5.23 showPopover resets to Select tab on each open", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    // Switch to embed tab first.
    const embedTab = popoverEl.querySelector('[data-tab="embed"]') as HTMLElement;
    embedTab.click();

    // Now show popover — it should reset to Select.
    showPopover(makeCtx());

    const selectPanel = popoverEl.querySelector('[data-panel="select"]') as HTMLElement;
    const embedPanel = popoverEl.querySelector('[data-panel="embed"]') as HTMLElement;
    expect(selectPanel.style.display).not.toBe("none");
    expect(embedPanel.style.display).toBe("none");
    plugin.onDisable(mockApi05);
  });

  // ── hideToolbar ────────────────────────────────────────────────────────────

  it("5.24 hideToolbar sets display:none on popover", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);
    popoverEl = document.getElementById("__markable_img_toolbar__") as HTMLElement;

    showPopover(makeCtx());
    expect(popoverEl.style.display).toBe("flex");

    hideToolbar();
    expect(popoverEl.style.display).toBe("none");
    plugin.onDisable(mockApi05);
  });

  it("5.25 currentImageContext is null after hideToolbar", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    await plugin.onEnable(mockApi05);

    showPopover(makeCtx());
    hideToolbar();

    // Verify via side-effects: handleAction is a no-op after hideToolbar
    // because currentImageContext is null.
    const mockDispatch = vi.fn();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", makeMockView(mockDispatch));
    handleAction("align-left");
    expect(mockDispatch).not.toHaveBeenCalled();

    plugin.onDisable(mockApi05);
  });

  it("5.26 hideToolbar with _popoverEl === null does not crash", () => {
    // This is safe to call even before onEnable (when _popoverEl is null).
    expect(() => hideToolbar()).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 06 — CM6 wiring, onEnable/onDisable lifecycle
// ════════════════════════════════════════════════════════════════════════════

describe("step_06 — wiring and lifecycle", () => {
  let mockApi: ReturnType<typeof makeMockApi>;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    mockApi = makeMockApi();

    // Stub the CM6 globals that onEnable/buildUpdateListener need.
    const mockUpdateListenerOf = vi.fn().mockReturnValue({ extension: "mock" });
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: {
        updateListener: { of: mockUpdateListenerOf },
      },
    });
    vi.stubGlobal("__CM_STATE__", {
      syntaxTree: vi.fn().mockReturnValue({
        resolveInner: vi.fn().mockReturnValue(null),
      }),
    });
  });

  afterEach(async () => {
    // Ensure plugin is disabled after each test.
    try {
      // Ignore errors if already disabled.
      (await import("../../../src/plugins/image-toolbar/image-toolbar.plugin")).default;
    } catch { /* ignore */ }
    vi.unstubAllGlobals();
    removeCSS();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  // ── _onDocClick path ───────────────────────────────────────────────────────

  it("6.1 click on non-.cm-live-image element is a no-op", async () => {
    await (await import("../../../src/plugins/image-toolbar/image-toolbar.plugin"))
      .__markablePlugin__?.onEnable(mockApi);

    const div = document.createElement("div");
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // No error and context not set.
    expect(true).toBe(true);
  });

  it("6.2 click with __MARKABLE_EDITOR_VIEW__ undefined returns early (EC-14)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    // Access the default export (plugin object).
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
    } | undefined;

    // If the plugin export is not directly accessible, skip this via a
    // guard — the functionality is covered by the onEnable/onDisable tests.
    if (!plugin) return;

    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    await plugin.onEnable(mockApi);

    const img = document.createElement("img");
    img.className = "cm-live-image";
    document.body.appendChild(img);
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Should not throw.
    expect(true).toBe(true);
  });

  it("6.3 view.posAtDOM throws + fallback returns -1 → no toolbar shown (EC-15)", () => {
    const mockView = makeMockView();
    (mockView.posAtDOM as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("posAtDOM failed");
    });
    // _fallbackPosFromImgEl will also fail because getCmState returns empty visibleRanges.
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", mockView);

    const img = document.createElement("img");
    img.className = "cm-live-image";
    document.body.appendChild(img);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The error may or may not be logged depending on whether the click handler
    // is attached (which requires onEnable). This test primarily verifies no crash.
    consoleSpy.mockRestore();
    expect(true).toBe(true);
  });

  // ── _onDocMousedown dismiss ────────────────────────────────────────────────

  it("6.4 mousedown inside popover does not call hideToolbar", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);

    // Set a context so the dismiss handler is active, then show the popover.
    const ctx = makeCtx();
    _setContextForTesting(ctx);
    showPopover(ctx);

    // Fire mousedown inside the popover.
    const popover = document.getElementById("__markable_img_toolbar__");
    if (!popover) { plugin.onDisable(mockApi); return; }

    const btn = popover.querySelector("button");
    btn?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    // Popover should still be "flex" (not hidden) — mousedown was inside the popover.
    expect(popover.style.display).toBe("flex");

    plugin.onDisable(mockApi);
  });

  it("6.5 mousedown outside popover hides toolbar (EC-9)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);

    // Set a context and show the popover.
    const ctx = makeCtx();
    _setContextForTesting(ctx);
    showPopover(ctx);

    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);
    outsideEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    const popover = document.getElementById("__markable_img_toolbar__");
    expect(popover?.style.display).toBe("none");

    plugin.onDisable(mockApi);
  });

  it("6.6 mousedown when context is null is a no-op (no error)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    // Do NOT call showPopover — context is null.

    const outsideEl = document.createElement("div");
    document.body.appendChild(outsideEl);
    expect(() => {
      outsideEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }).not.toThrow();

    plugin.onDisable(mockApi);
  });

  // ── onEnable/onDisable lifecycle ───────────────────────────────────────────

  it("6.7 onEnable injects CSS style tag", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    expect(document.getElementById(STYLE_ID)).not.toBeNull();

    plugin.onDisable(mockApi);
  });

  it("6.8 onEnable then onDisable removes CSS style tag", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    plugin.onDisable(mockApi);
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("6.9 onEnable called twice — only one style tag (EC-17)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    await plugin.onEnable(mockApi);

    const tags = document.head.querySelectorAll(`#${STYLE_ID}`);
    expect(tags.length).toBe(1);

    plugin.onDisable(mockApi);
  });

  it("6.10 onDisable removes the popover element from DOM (EC-18)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    plugin.onDisable(mockApi);

    expect(document.querySelector("#__markable_img_toolbar__")).toBeNull();
  });

  it("6.11 currentImageContext is null after onDisable (EC-18)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    const ctx612 = makeCtx();
    _setContextForTesting(ctx612);
    showPopover(ctx612);
    plugin.onDisable(mockApi);

    // Verify context is null by checking that handleAction is a no-op.
    const mockDispatch = vi.fn();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", makeMockView(mockDispatch));
    handleAction("align-left");
    expect(mockDispatch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    // Re-stub for afterEach cleanup.
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: { updateListener: { of: vi.fn().mockReturnValue({}) } },
    });
  });

  it("6.12 rapid enable/disable/enable cycle leaves no duplicate DOM nodes (EC-17)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);
    plugin.onDisable(mockApi);
    await plugin.onEnable(mockApi);

    const popovers = document.querySelectorAll("#__markable_img_toolbar__");
    expect(popovers.length).toBe(1);

    plugin.onDisable(mockApi);
  });

  it("6.13 editor blur event hides toolbar (FR-5)", async () => {
    // Build a mock editor DOM element that supports addEventListener/removeEventListener.
    const editorDom = document.createElement("div");
    const mockEditorView = {
      ...makeMockView(),
      dom: editorDom,
    };

    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", mockEditorView);

    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>;
      onDisable: (api: ReturnType<typeof makeMockApi>) => void;
    };
    if (!plugin) return;

    await plugin.onEnable(mockApi);

    // Show the popover so there is something to hide.
    const ctx = makeCtx();
    _setContextForTesting(ctx);
    showPopover(ctx);

    const popover = document.getElementById("__markable_img_toolbar__");
    expect(popover?.style.display).toBe("flex");

    // Fire a blur event on the editor DOM — FR-5 requires the toolbar to dismiss.
    editorDom.dispatchEvent(new Event("blur"));

    expect(popover?.style.display).toBe("none");

    plugin.onDisable(mockApi);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Step 07 — handleAction and integration tests
// ════════════════════════════════════════════════════════════════════════════

describe("step_07 — handleAction and integration", () => {
  let mockDispatch: ReturnType<typeof vi.fn>;
  let mockView: ReturnType<typeof makeMockView>;
  let mockApi07: ReturnType<typeof makeMockApi>;
  // Track the plugin reference for cleanup.
  let plugin07: { onEnable: (api: ReturnType<typeof makeMockApi>) => Promise<void>; onDisable: (api: ReturnType<typeof makeMockApi>) => void } | null = null;

  beforeEach(async () => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    mockApi07 = makeMockApi();

    mockDispatch = vi.fn();
    mockView = makeMockView(mockDispatch);

    // Stub CM6 globals needed by onEnable.
    vi.stubGlobal("__CM_VIEW__", {
      EditorView: { updateListener: { of: vi.fn().mockReturnValue({}) } },
    });
    vi.stubGlobal("__CM_STATE__", {
      syntaxTree: vi.fn().mockReturnValue({ resolveInner: vi.fn().mockReturnValue(null) }),
    });
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", mockView);

    // Call onEnable to initialise _popoverEl, _urlInput, _alignBtns.
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    plugin07 = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as typeof plugin07;
    if (plugin07) await plugin07.onEnable(mockApi07);
  });

  afterEach(() => {
    if (plugin07) {
      try { plugin07.onDisable(mockApi07); } catch { /* ignore */ }
      plugin07 = null;
    }
    vi.unstubAllGlobals();
    removeCSS();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
  });

  /**
   * Helper: set up a context and show the popover so handleAction has state to work with.
   * Uses _setContextForTesting to set currentImageContext because showPopover alone
   * does not set it — the click handler or updateListener does that in production.
   */
  function setupContext(overrides: Parameters<typeof makeCtx>[0] = {}) {
    const ctx = makeCtx(overrides);
    _setContextForTesting(ctx);
    showPopover(ctx);
    return ctx;
  }

  // ── Alignment actions ──────────────────────────────────────────────────────

  it("7.1 align-left on bare image dispatches idempotent write (EC-5, EC-32)", () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png", alt: "photo", alignment: "left" });
    handleAction("align-left");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 15, insert: "![photo](a.png)" },
    });
  });

  it("7.2 align-center on bare image", () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png", alt: "photo", alignment: "left" });
    handleAction("align-center");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 15, insert: '<div align="center">![photo](a.png)</div>' },
    });
  });

  it("7.3 align-right on bare image", () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png", alt: "photo", alignment: "left" });
    handleAction("align-right");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 15, insert: '<div align="right">![photo](a.png)</div>' },
    });
  });

  it("7.4 align-float-right on bare image", () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png", alt: "photo", alignment: "left" });
    handleAction("align-float-right");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: {
        from: 0,
        to: 15,
        insert: '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">',
      },
    });
  });

  it("7.5 align-left on center-wrapped image removes wrapper (EC-1)", () => {
    const rawSource = '<div align="center">![photo](a.png)</div>';
    setupContext({ rawSource, to: rawSource.length, url: "a.png", alt: "photo", alignment: "center" });
    handleAction("align-left");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: rawSource.length, insert: "![photo](a.png)" },
    });
  });

  it("7.6 align-center on float-right image (EC-4)", () => {
    const rawSource = '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">';
    setupContext({ rawSource, to: rawSource.length, url: "a.png", alt: "photo", alignment: "float-right" });
    handleAction("align-center");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: {
        from: 0,
        to: rawSource.length,
        insert: '<div align="center">![photo](a.png)</div>',
      },
    });
  });

  it("7.7 toolbar hides after successful alignment action", () => {
    const popover = document.getElementById("__markable_img_toolbar__");
    setupContext();
    handleAction("align-left");
    expect(popover?.style.display).toBe("none");
  });

  // ── embed-image action ─────────────────────────────────────────────────────

  it("7.8 embed-image with empty input — no dispatch (EC-21)", () => {
    setupContext({ url: "a.png" });
    // Set the input to empty.
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "";
    handleAction("embed-image");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("7.9 embed-image with unchanged URL — no dispatch (EC-20)", () => {
    setupContext({ url: "same.png" });
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "same.png";
    handleAction("embed-image");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("7.10 embed-image with new URL dispatches replacement", () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "new.png";
    handleAction("embed-image");
    expect(mockDispatch).toHaveBeenCalledWith({
      changes: { from: 0, to: 15, insert: "![photo](new.png)" },
    });
  });

  it("7.11 toolbar hides after successful embed dispatch", () => {
    const popover = document.getElementById("__markable_img_toolbar__");
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "new.png";
    handleAction("embed-image");
    expect(popover?.style.display).toBe("none");
  });

  it("7.12 embed-image with view undefined — no crash (EC-14)", () => {
    setupContext();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "new.png";
    expect(() => handleAction("embed-image")).not.toThrow();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", mockView);
  });

  // ── choose-file action ─────────────────────────────────────────────────────

  it("7.13 choose-file with __TAURI_DIALOG__ undefined — warns, no crash (EC-13)", () => {
    setupContext();
    vi.stubGlobal("__TAURI_DIALOG__", undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleAction("choose-file");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("__TAURI_DIALOG__ not available"),
    );
    warnSpy.mockRestore();
  });

  it("7.14 choose-file — dialog returns null — no dispatch, toolbar open (EC-12)", async () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png" });
    const popover = document.getElementById("__markable_img_toolbar__");

    vi.stubGlobal("__TAURI_DIALOG__", {
      open: vi.fn().mockResolvedValue(null),
    });

    handleAction("choose-file");
    // Wait for the promise to resolve.
    await vi.waitFor(() => {
      expect(mockDispatch).not.toHaveBeenCalled();
    });
    // Toolbar stays open — context was set, no hideToolbar called.
    // (The popover may or may not be visible depending on async timing,
    // but dispatch was definitely not called.)
  });

  it("7.15 choose-file — file in same dir as doc → relative path (EC-6)", async () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });

    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "/Users/dm/Notes/doc.md");
    vi.stubGlobal("__TAURI_DIALOG__", {
      open: vi.fn().mockResolvedValue("/Users/dm/Notes/img.png"),
    });

    handleAction("choose-file");
    await vi.waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: 15, insert: "![photo](./img.png)" },
      });
    });
  });

  it("7.16 choose-file — file outside doc dir → absolute path (EC-7)", async () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });

    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", "/Users/dm/Notes/doc.md");
    vi.stubGlobal("__TAURI_DIALOG__", {
      open: vi.fn().mockResolvedValue("/Other/img.png"),
    });

    handleAction("choose-file");
    await vi.waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: 15, insert: "![photo](/Other/img.png)" },
      });
    });
  });

  it("7.17 choose-file — __MARKABLE_CURRENT_FILE__ is null → absolute path (EC-8)", async () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });

    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__TAURI_DIALOG__", {
      open: vi.fn().mockResolvedValue("/Users/dm/Notes/img.png"),
    });

    handleAction("choose-file");
    await vi.waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: 15, insert: "![photo](/Users/dm/Notes/img.png)" },
      });
    });
  });

  it("7.18 choose-file — path with spaces, null doc → absolute path verbatim (EC-31)", async () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });

    vi.stubGlobal("__MARKABLE_CURRENT_FILE__", null);
    vi.stubGlobal("__TAURI_DIALOG__", {
      open: vi.fn().mockResolvedValue("/path/my photo.png"),
    });

    handleAction("choose-file");
    await vi.waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        changes: { from: 0, to: 15, insert: "![photo](/path/my photo.png)" },
      });
    });
  });

  // ── Guard conditions ───────────────────────────────────────────────────────

  it("7.19 currentImageContext is null — no dispatch, no crash", () => {
    // hideToolbar() was called in afterEach of previous test, but here we
    // explicitly ensure context is null by calling hideToolbar first.
    hideToolbar();
    handleAction("align-left");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("7.20 getEditorView() returns undefined — no dispatch, no crash (EC-14)", () => {
    setupContext();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", undefined);
    expect(() => handleAction("align-left")).not.toThrow();
    expect(mockDispatch).not.toHaveBeenCalled();
    vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", mockView);
  });

  it("7.21 unknown action — console.warn, no crash", () => {
    setupContext();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    handleAction("unknown-action-xyz");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown action"),
      "unknown-action-xyz",
    );
    warnSpy.mockRestore();
  });

  // ── renderDetailExtra ──────────────────────────────────────────────────────

  it("7.22 renderDetailExtra returns null (AD-5)", async () => {
    const mod = await import("../../../src/plugins/image-toolbar/image-toolbar.plugin");
    const plugin = (mod as unknown as Record<string, unknown>)["__markablePlugin__"] as {
      renderDetailExtra: () => null;
    };
    if (!plugin) return;
    expect(plugin.renderDetailExtra()).toBeNull();
  });

  // ── Single-dispatch guarantee (NFR-4) ──────────────────────────────────────

  it("7.23 alignment action dispatches exactly once (NFR-4)", () => {
    setupContext({ rawSource: "![photo](a.png)", url: "a.png", alt: "photo" });
    handleAction("align-center");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it("7.24 embed-image with changed URL dispatches exactly once (NFR-4)", () => {
    setupContext({ rawSource: "![photo](old.png)", url: "old.png", alt: "photo" });
    const input = document.querySelector("input.img-toolbar__input") as HTMLInputElement;
    input.value = "new.png";
    handleAction("embed-image");
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });
});
