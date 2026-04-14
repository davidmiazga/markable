/**
 * Unit tests for the Markdown Toolbar plugin — pure function layer.
 *
 * Tests cover:
 *   - Step 01: mergeWithDefaults (AC-1.2 – AC-1.5)
 *   - Step 02: detectFormats, isUrlLike (AC-2.1 – AC-2.18)
 *   - Step 03: computeWrap, computeUnwrap, computeErase, resolveUrl (AC-3.1 – AC-3.19)
 *   - Step 07: updateActiveButtons (AC-7.1 – AC-7.5)
 *   - CSS lifecycle: injectCSS idempotency (EC-15 / L-1)
 *   - updateDisabledState (L-2)
 *   - H-1 regression: italic detection does not fire on * bullet lists
 *
 * All imported symbols are pure functions or plain data — no CM6 globals,
 * no DOM beyond what JSDOM provides for the updateActiveButtons helper,
 * and no Tauri bridge calls are exercised here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  // Step 01
  mergeWithDefaults,
  DEFAULT_SETTINGS,

  // Step 02
  detectFormats,
  isUrlLike,
  FORMATS,

  // Step 03
  computeWrap,
  computeUnwrap,
  computeErase,
  resolveUrl,

  // Step 07
  updateActiveButtons,

  // CSS lifecycle (L-1)
  injectCSS,
  removeCSS,
  STYLE_ID,

  // Disabled state (L-2)
  updateDisabledState,
} from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin";

import type {
  ToolbarSettings,
  FormatId,
  FormatFlags,
} from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin";

// ── Helper: build a JSDOM-backed NodeList of buttons for updateActiveButtons tests ──

/**
 * Build a synthetic NodeList of <button> elements for use in updateActiveButtons
 * tests. Uses the JSDOM document provided by Vitest so querySelectorAll returns
 * a real NodeListOf<HTMLButtonElement>.
 *
 * @param ids - FormatId values to assign to each button's data-format attribute.
 * @returns   NodeListOf<HTMLButtonElement> wired with data-format.
 */
function makeButtons(ids: FormatId[]): NodeListOf<HTMLButtonElement> {
  const frag = document.createElement("div");
  for (const id of ids) {
    const btn = document.createElement("button");
    btn.dataset["format"] = id;
    frag.appendChild(btn);
  }
  return frag.querySelectorAll<HTMLButtonElement>("button");
}

/**
 * Build a FormatFlags object with all flags set to false.
 * Used as a starting baseline for updateActiveButtons tests.
 */
function allFalseFlags(): FormatFlags {
  return Object.fromEntries(
    FORMATS.map((f) => [f.id, false]),
  ) as FormatFlags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 01 — mergeWithDefaults
// ─────────────────────────────────────────────────────────────────────────────

describe("mergeWithDefaults", () => {
  // AC-1.2: null input → DEFAULT_SETTINGS copy
  it("returns defaults when given null (EC-18)", () => {
    const result = mergeWithDefaults(null);
    expect(result).toEqual({ toolbarMode: "floating", sidebarSide: "left" });
  });

  // AC-1.3a: partial object — toolbarMode present, sidebarSide absent
  it("fills missing sidebarSide from defaults (EC-19)", () => {
    const result = mergeWithDefaults({ toolbarMode: "sidebar" });
    expect(result).toEqual({ toolbarMode: "sidebar", sidebarSide: "left" });
  });

  // AC-1.3b: partial object — sidebarSide present, toolbarMode absent
  it("fills missing toolbarMode from defaults (EC-19)", () => {
    const result = mergeWithDefaults({ sidebarSide: "right" });
    expect(result).toEqual({ toolbarMode: "floating", sidebarSide: "right" });
  });

  // AC-1.4: invalid toolbarMode value → fall back to default
  it("falls back to default toolbarMode for invalid value (EC-19)", () => {
    const result = mergeWithDefaults({ toolbarMode: "invalid" });
    expect(result).toEqual({ toolbarMode: "floating", sidebarSide: "left" });
  });

  // AC-1.5a: pure function — same input produces equal output
  it("is pure: same input produces equal output", () => {
    const a = mergeWithDefaults({ toolbarMode: "sidebar", sidebarSide: "right" });
    const b = mergeWithDefaults({ toolbarMode: "sidebar", sidebarSide: "right" });
    expect(a).toEqual(b);
  });

  // AC-1.5b: pure function — does not mutate DEFAULT_SETTINGS
  it("does not mutate DEFAULT_SETTINGS", () => {
    const before: ToolbarSettings = { ...DEFAULT_SETTINGS };
    mergeWithDefaults(null);
    mergeWithDefaults({ toolbarMode: "sidebar" });
    expect(DEFAULT_SETTINGS).toEqual(before);
  });

  // Full valid object passes through unchanged
  it("accepts a complete valid object unchanged", () => {
    const result = mergeWithDefaults({ toolbarMode: "sidebar", sidebarSide: "right" });
    expect(result).toEqual({ toolbarMode: "sidebar", sidebarSide: "right" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 02 — detectFormats
// ─────────────────────────────────────────────────────────────────────────────

describe("detectFormats", () => {
  // AC-2.1: bold — cursor inside
  it("detects bold when cursor is inside ** markers (AC-2.1)", () => {
    expect(detectFormats("**hello**", 2, 2).bold).toBe(true);
  });

  // AC-2.2: bold — cursor before opening marker
  it("returns false for bold when cursor is outside ** markers (AC-2.2)", () => {
    expect(detectFormats("**hello**", 0, 0).bold).toBe(false);
  });

  // AC-2.3: italic — cursor inside
  it("detects italic when cursor is inside * markers (AC-2.3)", () => {
    expect(detectFormats("*hello*", 1, 1).italic).toBe(true);
  });

  // AC-2.4: italic NOT triggered inside bold markers
  it("does not trigger italic detection for ** bold markers (AC-2.4)", () => {
    // Selection spans 'hello' inside **hello** — italic should be false
    expect(detectFormats("**hello**", 2, 7).italic).toBe(false);
  });

  // AC-2.5: bold AND italic simultaneously (EC-3)
  it("detects both bold and italic for *** markers (AC-2.5)", () => {
    const doc = "***hello***";
    const flags = detectFormats(doc, 3, 8);
    expect(flags.bold).toBe(true);
    expect(flags.italic).toBe(true);
  });

  // AC-2.6: nested italic inside bold
  it("detects bold inside **_nested_** even when inner _ not in registry (AC-2.6)", () => {
    const doc = "**_nested_**";
    const flags = detectFormats(doc, 3, 9);
    expect(flags.bold).toBe(true);
    // Italic with * markers is not present here — should be false.
    expect(flags.italic).toBe(false);
  });

  // AC-2.7: underline
  it("detects underline inside <u> tags (AC-2.7)", () => {
    expect(detectFormats("<u>hello</u>", 3, 8).underline).toBe(true);
  });

  // AC-2.8: strikethrough
  it("detects strikethrough inside ~~ markers (AC-2.8)", () => {
    expect(detectFormats("~~hello~~", 2, 7).strikethrough).toBe(true);
  });

  // AC-2.9: highlight
  it("detects highlight inside == markers (AC-2.9)", () => {
    expect(detectFormats("==hello==", 2, 7).highlight).toBe(true);
  });

  // AC-2.10: inline code
  it("detects inlineCode inside backtick markers (AC-2.10)", () => {
    expect(detectFormats("`hello`", 1, 6).inlineCode).toBe(true);
  });

  // AC-2.11: superscript
  it("detects superscript inside ^ markers (AC-2.11)", () => {
    expect(detectFormats("^hello^", 1, 6).superscript).toBe(true);
  });

  // AC-2.12: link
  it("detects link inside [text](url) syntax (AC-2.12)", () => {
    expect(detectFormats("[text](https://example.com)", 1, 5).link).toBe(true);
  });

  // AC-2.13: image
  it("detects image inside ![alt](url) syntax (AC-2.13)", () => {
    expect(detectFormats("![alt](https://img.com/x.png)", 2, 5).image).toBe(true);
  });

  // AC-2.14: erase is always false
  it("always returns false for erase (AC-2.14)", () => {
    expect(detectFormats("**hello**", 2, 7).erase).toBe(false);
  });

  // AC-2.15: empty document
  it("returns all false for empty document (AC-2.15)", () => {
    const flags = detectFormats("", 0, 0);
    for (const fmt of FORMATS) {
      expect(flags[fmt.id]).toBe(false);
    }
  });

  // AC-2.16: multi-line selection (EC-20)
  it("detects bold across newlines (AC-2.16 / EC-20)", () => {
    const doc = "Some text\n**bold across\nlines**\nMore text";
    const from = 10; // start of **
    const to   = 30; // end of **
    expect(detectFormats(doc, from, to).bold).toBe(true);
  });

  // AC-2.18: pure function — calling twice returns equal objects, docText not mutated
  it("is pure: same input returns equal results, input not mutated (AC-2.18)", () => {
    const doc = "**hello**";
    const a   = detectFormats(doc, 2, 7);
    const b   = detectFormats(doc, 2, 7);
    expect(a).toEqual(b);
    expect(doc).toBe("**hello**"); // input unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 02 — isUrlLike
// ─────────────────────────────────────────────────────────────────────────────

describe("isUrlLike", () => {
  it("returns true for https:// URLs (AC-2.17)", () => {
    expect(isUrlLike("https://example.com")).toBe(true);
  });

  it("returns true for http:// URLs", () => {
    expect(isUrlLike("http://x.com")).toBe(true);
  });

  it("returns true for ftp:// URLs", () => {
    expect(isUrlLike("ftp://files.com")).toBe(true);
  });

  it("returns true for root-relative paths", () => {
    expect(isUrlLike("/relative/path")).toBe(true);
  });

  it("returns false for bare domain names", () => {
    expect(isUrlLike("example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isUrlLike("")).toBe(false);
  });

  it("returns false for plain text", () => {
    expect(isUrlLike("not a url")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 03 — computeWrap
// ─────────────────────────────────────────────────────────────────────────────

describe("computeWrap", () => {
  const boldFmt    = FORMATS.find((f) => f.id === "bold")!;
  const italicFmt  = FORMATS.find((f) => f.id === "italic")!;
  const codeFmt    = FORMATS.find((f) => f.id === "inlineCode")!;
  const linkFmt    = FORMATS.find((f) => f.id === "link")!;
  const imageFmt   = FORMATS.find((f) => f.id === "image")!;

  // AC-3.1: bold
  it("wraps bold correctly (AC-3.1)", () => {
    const result = computeWrap("hello", boldFmt);
    expect(result).toEqual({ insert: "**hello**", selFrom: 2, selTo: 7 });
  });

  // AC-3.2: italic
  it("wraps italic correctly (AC-3.2)", () => {
    const result = computeWrap("world", italicFmt);
    expect(result).toEqual({ insert: "*world*", selFrom: 1, selTo: 6 });
  });

  // AC-3.3: inline code with backticks inside (EC-21 — no escaping)
  it("wraps inline code without escaping inner backticks (AC-3.3 / EC-21)", () => {
    const result = computeWrap("a`b`c", codeFmt);
    expect(result).toEqual({ insert: "`a`b`c`", selFrom: 1, selTo: 6 });
  });

  // AC-3.4: link
  it("wraps link with resolved URL (AC-3.4)", () => {
    const result = computeWrap("click here", linkFmt, "https://example.com");
    expect(result).toEqual({
      insert:  "[click here](https://example.com)",
      selFrom: 1,
      selTo:   11,
    });
  });

  // AC-3.5: image
  it("wraps image with resolved URL (AC-3.5)", () => {
    const result = computeWrap("photo", imageFmt, "https://img.com/x.png");
    expect(result).toEqual({
      insert:  "![photo](https://img.com/x.png)",
      selFrom: 2,
      selTo:   7,
    });
  });

  // AC-3.18: pure function
  it("is synchronous and pure — deterministic results (AC-3.18)", () => {
    const a = computeWrap("test", boldFmt);
    const b = computeWrap("test", boldFmt);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 03 — computeUnwrap
// ─────────────────────────────────────────────────────────────────────────────

describe("computeUnwrap", () => {
  const boldFmt  = FORMATS.find((f) => f.id === "bold")!;
  const linkFmt  = FORMATS.find((f) => f.id === "link")!;
  const imageFmt = FORMATS.find((f) => f.id === "image")!;

  // AC-3.6: bold unwrap (EC-5)
  it("unwraps bold markers (AC-3.6 / EC-5)", () => {
    const doc    = "**hello**";
    const result = computeUnwrap(doc, 2, 7, boldFmt);
    expect(result).not.toBeNull();
    expect(result!.changeFrom).toBe(0);
    expect(result!.changeTo).toBe(9);
    expect(result!.insert).toBe("hello");
    expect(result!.selFrom).toBe(0);
    expect(result!.selTo).toBe(5);
  });

  // AC-3.7: link unwrap
  it("unwraps link to visible text only (AC-3.7)", () => {
    const doc    = "[click here](https://example.com)";
    const result = computeUnwrap(doc, 1, 11, linkFmt);
    expect(result).not.toBeNull();
    expect(result!.insert).toBe("click here");
    expect(result!.changeFrom).toBe(0);
    expect(result!.changeTo).toBe(doc.length);
  });

  // AC-3.8: image unwrap
  it("unwraps image to alt text only (AC-3.8)", () => {
    const doc    = "![photo](https://img.com/x.png)";
    const result = computeUnwrap(doc, 2, 7, imageFmt);
    expect(result).not.toBeNull();
    expect(result!.insert).toBe("photo");
  });

  // AC-3.9: returns null when markers not found
  it("returns null when opening marker is absent (AC-3.9)", () => {
    expect(computeUnwrap("hello", 1, 4, boldFmt)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 03 — computeErase
// ─────────────────────────────────────────────────────────────────────────────

describe("computeErase", () => {
  // AC-3.10: mixed formats (EC-12)
  it("strips bold and italic in one pass (AC-3.10 / EC-12)", () => {
    const doc    = "**bold** and *italic*";
    const result = computeErase(doc, 0, doc.length);
    expect(result).toEqual({ insert: "bold and italic", changed: true });
  });

  // AC-3.11: link stripped to text (EC-13)
  it("strips link syntax to visible text (AC-3.11 / EC-13)", () => {
    const doc    = "[text](https://url)";
    const result = computeErase(doc, 0, doc.length);
    expect(result).toEqual({ insert: "text", changed: true });
  });

  // AC-3.12: image stripped to alt text
  it("strips image syntax to alt text (AC-3.12)", () => {
    const doc    = "![alt](https://img.com/x.png)";
    const result = computeErase(doc, 0, doc.length);
    expect(result).toEqual({ insert: "alt", changed: true });
  });

  // AC-3.13: plain text — no wrappers found (EC-11)
  it("returns changed:false for plain text with no wrappers (AC-3.13 / EC-11)", () => {
    const result = computeErase("plain text", 0, 10);
    expect(result).toEqual({ insert: "plain text", changed: false });
  });

  // AC-3.14: nested formats (EC-12) — bold wrapping strikethrough
  it("handles nested formats via iterative stripping (AC-3.14 / EC-12)", () => {
    const doc    = "**~~nested~~**";
    const result = computeErase(doc, 0, doc.length);
    expect(result).toEqual({ insert: "nested", changed: true });
  });

  // AC-3.19: underline HTML tag
  it("strips underline HTML tags (AC-3.19)", () => {
    const doc    = "<u>underlined</u>";
    const result = computeErase(doc, 0, doc.length);
    expect(result).toEqual({ insert: "underlined", changed: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 03 — resolveUrl
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // AC-3.15: clipboard contains a valid URL — return it without showing prompt
  it("returns clipboard URL silently when clipboard has URL (AC-3.15 / EC-7)", async () => {
    // Track prompt calls by stubbing with a spy function that should NOT be called.
    const promptMock = vi.fn();
    vi.stubGlobal("prompt", promptMock);
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("https://example.com") },
      writable:     true,
      configurable: true,
    });

    const result = await resolveUrl();
    expect(result).toBe("https://example.com");
    expect(promptMock).not.toHaveBeenCalled();
  });

  // AC-3.16: clipboard has non-URL text — fall back to prompt
  it("falls back to prompt when clipboard has non-URL text (AC-3.16 / EC-8)", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("https://custom.com"));
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("some random text") },
      writable:     true,
      configurable: true,
    });

    const result = await resolveUrl();
    expect(result).toBe("https://custom.com");
  });

  // AC-3.17: user cancels prompt — return null (EC-9)
  it("returns null when user cancels the prompt (AC-3.17 / EC-9)", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue(null));
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("") },
      writable:     true,
      configurable: true,
    });

    const result = await resolveUrl();
    expect(result).toBeNull();
  });

  // Clipboard read error — fall through to prompt
  it("falls through to prompt when clipboard read throws", async () => {
    vi.stubGlobal("prompt", vi.fn().mockReturnValue("https://fallback.com"));
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
      writable:     true,
      configurable: true,
    });

    const result = await resolveUrl();
    expect(result).toBe("https://fallback.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 07 — updateActiveButtons
// ─────────────────────────────────────────────────────────────────────────────

describe("updateActiveButtons", () => {
  const ALL_FORMAT_IDS = FORMATS.map((f) => f.id);

  // AC-7.1: bold button gets active class when bold flag is true
  it("adds active class to bold button when bold flag is true (AC-7.1)", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    const flags   = allFalseFlags();
    flags.bold    = true;
    updateActiveButtons(flags, buttons);
    const boldBtn = [...buttons].find((b) => b.dataset["format"] === "bold")!;
    expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(true);
  });

  // AC-7.2: active class removed when flag turns false
  it("removes active class when flag changes to false (AC-7.2)", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    const flags   = allFalseFlags();

    // First call: set bold active.
    flags.bold = true;
    updateActiveButtons(flags, buttons);
    const boldBtn = [...buttons].find((b) => b.dataset["format"] === "bold")!;
    expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(true);

    // Second call: clear bold.
    flags.bold = false;
    updateActiveButtons(flags, buttons);
    expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(false);
  });

  // AC-7.3: multiple buttons active simultaneously (EC-3)
  it("activates multiple buttons simultaneously (AC-7.3 / EC-3)", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    const flags   = allFalseFlags();
    flags.bold    = true;
    flags.italic  = true;
    updateActiveButtons(flags, buttons);

    const boldBtn   = [...buttons].find((b) => b.dataset["format"] === "bold")!;
    const italicBtn = [...buttons].find((b) => b.dataset["format"] === "italic")!;
    expect(boldBtn.classList.contains("md-toolbar__btn--active")).toBe(true);
    expect(italicBtn.classList.contains("md-toolbar__btn--active")).toBe(true);
  });

  // AC-7.4: erase button never receives active class
  it("never gives the erase button an active class (AC-7.4)", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    // detectFormats always returns false for erase; we replicate that here.
    const flags   = allFalseFlags();
    flags.erase   = false;
    updateActiveButtons(flags, buttons);
    const eraseBtn = [...buttons].find((b) => b.dataset["format"] === "erase")!;
    expect(eraseBtn.classList.contains("md-toolbar__btn--active")).toBe(false);
  });

  // AC-7.5: null buttons — no crash
  it("does not throw when buttons is null (AC-7.5)", () => {
    expect(() => updateActiveButtons(allFalseFlags(), null)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-1 regression — italic detection must not fire on * bullet lists
// ─────────────────────────────────────────────────────────────────────────────

describe("detectFormats — italic / bullet-list disambiguation (H-1 regression)", () => {
  /**
   * Regression guard for H-1: the parity heuristic incorrectly fired italic
   * for `*`-bulleted lists because a 2-item list has one `*` on each side of
   * any mid-selection, satisfying the old odd/odd condition.
   *
   * The corrected algorithm treats a `*` as a list bullet (and excludes it
   * from italic detection) only when it is BOTH at the start of a line AND
   * immediately followed by a space or tab character.
   */

  // A two-item * bullet list — cursor on "item1" (position 2–6).
  it("does NOT detect italic on a * bullet list (H-1 regression)", () => {
    const doc = "* item1\n* item2";
    // Position 2 is 'i' in "item1"; position 6 is '1'.
    const result = detectFormats(doc, 2, 6);
    expect(result.italic).toBe(false);
  });

  // A single * bullet item — cursor somewhere inside the text.
  it("does NOT detect italic on a single-item * bullet (H-1 regression)", () => {
    const doc = "* hello world";
    const result = detectFormats(doc, 2, 7);
    expect(result.italic).toBe(false);
  });

  // Italic DOES fire when the * is not a list bullet (inline italic marker).
  it("still detects italic on *inline* italic markers (H-1 non-regression)", () => {
    const doc = "some *italic* text";
    // "italic" runs from 6 to 12; cursor at (6, 12) overlaps the italic span.
    const result = detectFormats(doc, 6, 12);
    expect(result.italic).toBe(true);
  });

  // Italic marker at position 0 with no space after — NOT a bullet.
  it("detects italic when * is at start-of-doc but not followed by space (H-1)", () => {
    const doc = "*word*";
    const result = detectFormats(doc, 1, 5);
    expect(result.italic).toBe(true);
  });

  // Bullet list on multiple lines — none should trigger italic.
  it("does NOT detect italic on a multi-item * bullet list (H-1 regression)", () => {
    const doc = "* alpha\n* beta\n* gamma";
    // Cursor inside "beta" (positions 10–13).
    const result = detectFormats(doc, 10, 13);
    expect(result.italic).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS lifecycle — injectCSS idempotency (EC-15 / L-1)
// ─────────────────────────────────────────────────────────────────────────────

describe("injectCSS / removeCSS (CSS lifecycle — EC-15 / L-1)", () => {
  /**
   * Clean up after each test so style tags do not leak between test cases.
   * JSDOM persists its document between tests in the same file.
   */
  afterEach(() => {
    removeCSS();
  });

  // EC-15: injecting CSS twice must not create a duplicate <style> element.
  it("injectCSS is idempotent — no duplicate style tags on double call (EC-15)", () => {
    injectCSS();
    injectCSS(); // second call must be a no-op
    const tags = document.querySelectorAll(`#${STYLE_ID}`);
    expect(tags.length).toBe(1);
  });

  // removeCSS removes the tag inserted by injectCSS.
  it("removeCSS removes the injected style tag", () => {
    injectCSS();
    removeCSS();
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  // removeCSS is a no-op when no tag is present.
  it("removeCSS does not throw when tag is absent", () => {
    expect(() => removeCSS()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateDisabledState (L-2)
// ─────────────────────────────────────────────────────────────────────────────

describe("updateDisabledState (L-2)", () => {
  const ALL_FORMAT_IDS = FORMATS.map((f) => f.id);

  /**
   * Build a JSDOM-backed NodeList for updateDisabledState tests.
   * Reuses the makeButtons helper defined at module scope.
   */

  it("adds disabled class to all buttons when isEmpty is true", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    updateDisabledState(true, buttons);
    for (const btn of buttons) {
      expect(btn.classList.contains("md-toolbar__btn--disabled")).toBe(true);
    }
  });

  it("removes disabled class from all buttons when isEmpty is false", () => {
    const buttons = makeButtons(ALL_FORMAT_IDS);
    // First disable, then re-enable.
    updateDisabledState(true, buttons);
    updateDisabledState(false, buttons);
    for (const btn of buttons) {
      expect(btn.classList.contains("md-toolbar__btn--disabled")).toBe(false);
    }
  });

  it("does not throw when buttons is null", () => {
    expect(() => updateDisabledState(true, null)).not.toThrow();
  });
});
