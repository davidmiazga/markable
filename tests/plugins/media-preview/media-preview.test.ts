/**
 * Vitest unit test suite for the media-preview plugin.
 *
 * Covers all unit-testable exported functions:
 *   - parseAltAnnotations() — alt text annotation parsing
 *   - resolveImageSrc()     — URL category resolution + edge cases
 *   - isCursorInsideRange() — cursor/selection overlap formula
 *   - renderBrokenImage()   — broken-image placeholder DOM structure
 *   - injectPluginCSS() / removePluginCSS() — CSS injection idempotency (EC-30)
 *
 * WHY THIS FILE USES DYNAMIC IMPORTS:
 * media-preview.plugin.ts destructures window.__CM_VIEW__, window.__CM_STATE__, and
 * window.__CM_LANGUAGE__ at module evaluation time (top-level const destructure).
 * Static import statements are hoisted before any code in the file runs — including
 * beforeAll() callbacks — so setting globals in beforeAll is too late for static imports.
 *
 * Solution: in beforeAll, set the CM6 globals, then dynamically import the plugin module.
 * Dynamic import() is not hoisted; it runs at the point of the await expression, which
 * is after the globals have been assigned.
 *
 * Runtime-only behaviors (actual image loading, onerror in WebView, CM6 rendering)
 * are documented as it.skip with explanatory comments.
 *
 * See: docs/specs/media-preview/step_06_tests.md
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmLanguage from "@codemirror/language";

// ── Module-level references populated in beforeAll ────────────────────────────
//
// Declared with let (not statically imported) because the module must not be
// evaluated until after the CM6 globals are set on window.

/* eslint-disable @typescript-eslint/no-explicit-any */
let parseAltAnnotations: (rawAlt: string) => any;
let resolveImageSrc: (src: string, currentFile: string | null) => string;
let isCursorInsideRange: (anchor: number, head: number, from: number, to: number) => boolean;
let renderBrokenImage: (container: HTMLElement, cleanAlt: string, originalSrc: string) => void;
let injectPluginCSS: () => void;
let removePluginCSS: () => void;
let extractYouTubeId: (url: string) => string | null;
// ImageWidget / YouTubeWidget used to test toDOM() (AC-9, AC-11, EC-16).
let ImageWidget: any;
let YouTubeWidget: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Global setup: set CM6 globals then dynamically import the plugin ──────────
//
// This beforeAll runs once before all tests in this file. By the time any it()
// callback executes, the globals are set and the plugin module is loaded.

beforeAll(async () => {
  // Mirror what src/lib/cm-globals.ts does in the running app so media-preview.plugin.ts
  // can destructure window.__CM_VIEW__, __CM_STATE__, and __CM_LANGUAGE__ at evaluation time.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (window as any).__CM_STATE__    = cmState;
  (window as any).__CM_VIEW__     = cmView;
  (window as any).__CM_LANGUAGE__ = cmLanguage;
  // Tests run with preview enabled — source-mode guard must not suppress decorations.
  (window as any).__MARKABLE_PREVIEW_ENABLED__ = true;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Dynamic import runs AFTER the globals assignment above — media-preview.plugin.ts is
  // evaluated here and the destructure at the top of that module finds the globals.
  const mod = await import("../../../src/plugins/media-preview/media-preview.plugin");

  // Capture named exports for use in all test groups below.
  parseAltAnnotations  = mod.parseAltAnnotations;
  resolveImageSrc      = mod.resolveImageSrc;
  isCursorInsideRange  = mod.isCursorInsideRange;
  renderBrokenImage    = mod.renderBrokenImage;
  injectPluginCSS      = mod.injectPluginCSS;
  removePluginCSS      = mod.removePluginCSS;
  extractYouTubeId     = mod.extractYouTubeId;
  ImageWidget          = mod.ImageWidget;
  YouTubeWidget        = mod.YouTubeWidget;
});

// ── resolveImageSrc mock setup ────────────────────────────────────────────────

// resolveImageSrc reads window.__MARKABLE_CONVERT_FILE_SRC__ to convert local paths.
// In jsdom, we provide a mock that simulates Tauri's convertFileSrc by prepending
// "asset://" and stripping the leading "/" from absolute paths — matching how
// the real Tauri implementation works for the local filesystem protocol.
beforeEach(() => {
  (window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"] =
    (path: string) => `asset://${path.replace(/^\//, "")}`;
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"];
});

// ── parseAltAnnotations ───────────────────────────────────────────────────────

describe("media-preview — parseAltAnnotations", () => {
  // EC-04: Empty alt text — all fields default to empty/undefined.
  it("handles empty alt text", () => {
    const result = parseAltAnnotations("");
    expect(result.cleanAlt).toBe("");
    expect(result.cssClasses).toEqual([]);
    expect(result.cssStyle).toBeUndefined();
    expect(result.displayWidth).toBeUndefined();
    expect(result.displayHeight).toBeUndefined();
  });

  // Plain alt text with no annotations is returned unchanged.
  it("returns plain alt text unchanged", () => {
    const result = parseAltAnnotations("photo");
    expect(result.cleanAlt).toBe("photo");
    expect(result.cssClasses).toEqual([]);
    expect(result.cssStyle).toBeUndefined();
    expect(result.displayWidth).toBeUndefined();
    expect(result.displayHeight).toBeUndefined();
  });

  // FR-2.1: WxH dimension annotation — both dimensions extracted.
  it("parses width x height annotation", () => {
    const result = parseAltAnnotations("photo|400x300");
    expect(result.cleanAlt).toBe("photo");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // EC-17: Width-only annotation — height remains undefined.
  it("parses width-only annotation", () => {
    const result = parseAltAnnotations("photo|400");
    expect(result.cleanAlt).toBe("photo");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBeUndefined();
  });

  // FR-2.2: Unicode multiply × accepted as dimension separator.
  it("accepts Unicode multiply × as dimension separator", () => {
    const result = parseAltAnnotations("photo|400×300");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.2: Tolerates spaces around | separator and around x.
  it("tolerates spaces around | separator", () => {
    const result = parseAltAnnotations("photo | 400 x 300");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.5: Zero width is treated as undefined (invalid dimension).
  it("ignores zero width", () => {
    const result = parseAltAnnotations("photo|0x300");
    expect(result.displayWidth).toBeUndefined();
    // Height is still parsed even when width is zero.
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.5: The \d+ regex only matches non-negative integers, so negative
  // values cannot appear in output. Document this for clarity.
  it("does not produce negative dimensions (regex prevents this)", () => {
    const result = parseAltAnnotations("photo|-400x300");
    // The negative sign breaks the dimension match — no dimensions extracted.
    expect(result.displayWidth).toBeUndefined();
    expect(result.displayHeight).toBeUndefined();
  });

  // FR-2.4: Single CSS class extracted, removed from alt text.
  it("extracts single CSS class from alt text", () => {
    const result = parseAltAnnotations("photo.center");
    expect(result.cssClasses).toEqual(["center"]);
    expect(result.cleanAlt).toBe("photo");
  });

  // Multiple dot-prefixed classes extracted.
  it("extracts multiple CSS classes", () => {
    const result = parseAltAnnotations("photo.center.shadow");
    expect(result.cssClasses).toContain("center");
    expect(result.cssClasses).toContain("shadow");
    expect(result.cleanAlt).toBe("photo");
  });

  // EC-33: Class tokens with invalid characters are silently discarded.
  // ".my!" — the "!" character makes the token invalid; it must be dropped.
  it("discards class tokens with invalid characters (EC-33)", () => {
    const result = parseAltAnnotations("photo.my!");
    expect(result.cssClasses).toEqual([]);
  });

  // Valid class name: letters, digits, hyphens, underscores — all accepted.
  it("accepts valid class name characters (letters, digits, hyphen, underscore)", () => {
    const result = parseAltAnnotations("photo.valid-name_1");
    expect(result.cssClasses).toEqual(["valid-name_1"]);
  });

  // FR-2.4: Inline CSS block extracted and trimmed.
  it("extracts inline CSS from {braces}", () => {
    const result = parseAltAnnotations("photo{opacity:0.8}");
    expect(result.cssStyle).toBe("opacity:0.8");
    expect(result.cleanAlt).toBe("photo");
  });

  // Whitespace inside the CSS block is trimmed.
  it("trims whitespace inside inline CSS", () => {
    const result = parseAltAnnotations("photo{ opacity: 0.8 }");
    expect(result.cssStyle).toBe("opacity: 0.8");
  });

  // EC-34: All three annotations combined — all extracted, cleanAlt contains only text.
  it("handles all three annotations together (EC-34)", () => {
    const result = parseAltAnnotations("photo.center|400x300{opacity:0.8}");
    expect(result.cleanAlt).toBe("photo");
    expect(result.cssClasses).toContain("center");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
    expect(result.cssStyle).toBe("opacity:0.8");
  });

  // Class shorthand before dimension annotation.
  it("handles class shorthand before dimension annotation", () => {
    const result = parseAltAnnotations("photo.center|400x300");
    expect(result.cssClasses).toContain("center");
    expect(result.displayWidth).toBe(400);
    expect(result.cleanAlt).toBe("photo");
  });

  // Empty CSS block {} produces undefined cssStyle (not an empty string).
  it("treats empty CSS block {} as no CSS style", () => {
    const result = parseAltAnnotations("photo{}");
    expect(result.cssStyle).toBeUndefined();
  });
});

// ── resolveImageSrc ───────────────────────────────────────────────────────────

describe("media-preview — resolveImageSrc", () => {
  // EC-03: Empty URL — broken-image signal.
  it("returns empty string for empty src", () => {
    expect(resolveImageSrc("", null)).toBe("");
  });

  // EC-03: Whitespace-only URL — treated as empty.
  it("returns empty string for whitespace-only src", () => {
    expect(resolveImageSrc("   ", null)).toBe("");
  });

  // EC-09: file:// protocol rejected — Tauri's asset protocol does not accept it.
  it("rejects file:// protocol (EC-09)", () => {
    expect(resolveImageSrc("file:///Users/x/img.png", null)).toBe("");
  });

  // FR-3.1: http:// URLs pass through unchanged.
  it("passes through http:// URLs unchanged", () => {
    const url = "http://example.com/img.png";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  // FR-3.1: https:// URLs pass through unchanged.
  it("passes through https:// URLs unchanged", () => {
    const url = "https://example.com/img.png";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  // FR-3.4: data: URIs pass through unchanged.
  it("passes through data: URIs unchanged", () => {
    const url = "data:image/png;base64,abc123";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  // FR-3.1: Absolute path converted via mock __MARKABLE_CONVERT_FILE_SRC__.
  it("converts absolute path via __MARKABLE_CONVERT_FILE_SRC__", () => {
    const result = resolveImageSrc("/Users/x/img.png", null);
    expect(result).toBe("asset://Users/x/img.png");
  });

  // FR-3.1: Relative path resolved against current file directory, then converted.
  it("resolves relative path against current file directory", () => {
    const result = resolveImageSrc("img.png", "/Users/x/doc.md");
    expect(result).toBe("asset://Users/x/img.png");
  });

  // FR-3.1: ./relative path — URL normalization resolves the dot segment.
  it("resolves ./relative path against current file directory", () => {
    const result = resolveImageSrc("./img.png", "/Users/x/doc.md");
    expect(result).toBe("asset://Users/x/img.png");
  });

  // FR-3.1: ../relative path — URL normalization resolves the parent segment.
  // Previously broke because string concatenation left "../" unresolved.
  it("resolves ../relative path by traversing up one directory", () => {
    const result = resolveImageSrc("../images/photo.png", "/Users/x/notes/doc.md");
    expect(result).toBe("asset://Users/x/images/photo.png");
  });

  // FR-3.1: ../../ traversal — multiple parent segments normalized correctly.
  it("resolves ../../relative path by traversing up two directories", () => {
    const result = resolveImageSrc("../../assets/img.png", "/Users/x/a/b/doc.md");
    expect(result).toBe("asset://Users/x/assets/img.png");
  });

  // EC-07: No current file path for relative URL — pass through as-is.
  it("returns raw src when currentFile is null for relative path (EC-07)", () => {
    const result = resolveImageSrc("img.png", null);
    // Falls through to pass-through (will fail to load; onerror fires).
    expect(result).toBe("img.png");
  });

  // EC-05: URL with spaces — URL constructor percent-encodes spaces before
  // convertFileSrc is called. This is correct: asset:// URLs require encoding.
  it("percent-encodes spaces in relative paths (EC-05)", () => {
    const result = resolveImageSrc("my photo.png", "/Users/x/doc.md");
    expect(result).toBe("asset://Users/x/my%20photo.png");
  });

  // EC-35: __MARKABLE_CONVERT_FILE_SRC__ not defined — pass src as-is with console.warn.
  it("returns src as-is when __MARKABLE_CONVERT_FILE_SRC__ is undefined (EC-35)", () => {
    delete (window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"];
    const result = resolveImageSrc("/Users/x/img.png", null);
    // Falls through to pass-through with a console.warn.
    expect(result).toBe("/Users/x/img.png");
  });
});

// ── extractYouTubeId ──────────────────────────────────────────────────────────

describe("media-preview — extractYouTubeId", () => {
  it("extracts ID from watch?v= URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from youtu.be short URL", () => {
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from /embed/ URL", () => {
    expect(extractYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("ignores extra query params after the video ID", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for a non-YouTube URL", () => {
    expect(extractYouTubeId("https://vimeo.com/123456")).toBeNull();
  });

  it("returns null for a local image path", () => {
    expect(extractYouTubeId("./images/photo.png")).toBeNull();
  });
});

// ── YouTubeWidget.toDOM() ─────────────────────────────────────────────────────

describe("media-preview — YouTubeWidget.toDOM()", () => {
  const make = (overrides: Partial<{
    videoId: string; cleanAlt: string; cssClasses: string[];
    cssStyle: string; displayWidth: number; displayHeight: number; maxDisplayWidth: number;
  }> = {}) => new YouTubeWidget(
    overrides.videoId ?? "dQw4w9WgXcQ",
    overrides.cleanAlt ?? "",
    overrides.cssClasses ?? [],
    overrides.cssStyle,
    overrides.displayWidth,
    overrides.displayHeight,
    overrides.maxDisplayWidth ?? 600,
  );

  it("renders an iframe with the nocookie embed URL", () => {
    const iframe = make().toDOM().querySelector("iframe")!;
    expect(iframe.src).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("uses 16:9 aspect ratio based on maxDisplayWidth", () => {
    const iframe = make({ maxDisplayWidth: 640 }).toDOM().querySelector("iframe")!;
    expect(Number(iframe.width)).toBe(640);
    expect(Number(iframe.height)).toBe(360); // 640 * 9/16
  });

  it("falls back to 600px width when maxDisplayWidth is 0", () => {
    const iframe = make({ maxDisplayWidth: 0 }).toDOM().querySelector("iframe")!;
    expect(Number(iframe.width)).toBe(600);
  });

  it("sets title from cleanAlt for accessibility", () => {
    const iframe = make({ cleanAlt: "My video" }).toDOM().querySelector("iframe")!;
    expect(iframe.title).toBe("My video");
  });

  it("respects annotated displayWidth (|200) — caps at maxDisplayWidth", () => {
    const iframe = make({ displayWidth: 200, maxDisplayWidth: 600 }).toDOM().querySelector("iframe")!;
    expect(Number(iframe.width)).toBe(200);
    expect(Number(iframe.height)).toBe(113); // 200 * 9/16 = 112.5 → Math.round → 113
  });

  it("annotated displayWidth capped by maxDisplayWidth when it exceeds cap", () => {
    const iframe = make({ displayWidth: 800, maxDisplayWidth: 600 }).toDOM().querySelector("iframe")!;
    expect(Number(iframe.width)).toBe(600);
  });

  it("annotated displayHeight overrides 16:9 default", () => {
    const iframe = make({ displayWidth: 400, displayHeight: 300, maxDisplayWidth: 600 }).toDOM().querySelector("iframe")!;
    expect(Number(iframe.width)).toBe(400);
    expect(Number(iframe.height)).toBe(300);
  });

  it("applies CSS classes to the container div", () => {
    const container = make({ cssClasses: ["right"] }).toDOM();
    expect(container.className).toContain("cm-media-youtube");
    expect(container.className).toContain("right");
  });

  it("applies inline CSS style to the container div", () => {
    const container = make({ cssStyle: "opacity:0.5" }).toDOM();
    expect(container.style.opacity).toBe("0.5");
  });
});

// ── isCursorInsideRange ───────────────────────────────────────────────────────

describe("media-preview — isCursorInsideRange", () => {
  // EC-01: Cursor exactly at `from` (opening character) counts as inside.
  it("treats cursor at `from` as inside (EC-01)", () => {
    expect(isCursorInsideRange(10, 10, 10, 20)).toBe(true);
  });

  // EC-02: Cursor at `to - 1` (closing character) counts as inside.
  it("treats cursor at `to - 1` as inside (EC-02)", () => {
    expect(isCursorInsideRange(19, 19, 10, 20)).toBe(true);
  });

  // Cursor exactly at `to` is OUTSIDE — the image is rendered as a widget.
  it("treats cursor at `to` as outside", () => {
    expect(isCursorInsideRange(20, 20, 10, 20)).toBe(false);
  });

  // Cursor before range — outside.
  it("treats cursor before range as outside", () => {
    expect(isCursorInsideRange(5, 5, 10, 20)).toBe(false);
  });

  // Cursor after range — outside.
  it("treats cursor after range as outside", () => {
    expect(isCursorInsideRange(25, 25, 10, 20)).toBe(false);
  });

  // Cursor in the middle of the range — inside.
  it("treats cursor in middle of range as inside", () => {
    expect(isCursorInsideRange(15, 15, 10, 20)).toBe(true);
  });

  // Selection spanning the entire range — inside.
  it("treats selection spanning the entire range as inside", () => {
    expect(isCursorInsideRange(10, 20, 10, 20)).toBe(true);
  });

  // Selection starting before the range and ending inside — inside.
  it("treats selection starting before and ending inside as inside", () => {
    expect(isCursorInsideRange(5, 15, 10, 20)).toBe(true);
  });

  // Selection starting inside the range and ending after — inside.
  it("treats selection starting inside and ending after as inside", () => {
    expect(isCursorInsideRange(15, 25, 10, 20)).toBe(true);
  });

  // Reversed selection (anchor > head) — normalised correctly.
  it("handles reversed selection (anchor > head)", () => {
    expect(isCursorInsideRange(15, 5, 10, 20)).toBe(true);
  });

  // Selection entirely before range — outside.
  it("treats selection entirely before range as outside", () => {
    expect(isCursorInsideRange(1, 8, 10, 20)).toBe(false);
  });

  // Selection entirely after range — outside.
  it("treats selection entirely after range as outside", () => {
    expect(isCursorInsideRange(21, 30, 10, 20)).toBe(false);
  });
});

// ── renderBrokenImage ─────────────────────────────────────────────────────────

describe("media-preview — renderBrokenImage", () => {
  // Container gets both cm-media-container and cm-media-broken classes.
  it("sets cm-media-broken class on container", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt text", "broken.png");
    expect(container.className).toContain("cm-media-broken");
  });

  // Title attribute is set to the original src URL for hover inspection (FR-5.3).
  it("sets title to the original src URL", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt text", "/path/to/image.png");
    expect(container.title).toBe("/path/to/image.png");
  });

  // EC-03: Empty src shows a fallback title string (not empty title).
  it("shows fallback title for empty src (EC-03)", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "", "");
    expect(container.title).toBe("(empty URL)");
  });

  // SVG icon child element is present.
  it("renders an SVG icon child element", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt", "broken.png");
    const icon = container.querySelector(".cm-media-broken-icon");
    expect(icon).not.toBeNull();
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  // Caption is shown when cleanAlt is non-empty.
  it("shows caption when cleanAlt is non-empty", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "My Image", "broken.png");
    const caption = container.querySelector(".cm-media-broken-caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe("My Image");
  });

  // EC-04: No caption element when cleanAlt is empty.
  it("omits caption when cleanAlt is empty (EC-04)", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "", "broken.png");
    const caption = container.querySelector(".cm-media-broken-caption");
    expect(caption).toBeNull();
  });
});

// ── CSS injection idempotency (EC-30) ─────────────────────────────────────────

describe("media-preview — CSS injection idempotency (EC-30)", () => {
  afterEach(() => {
    // Clean up any injected style tags between tests.
    document.getElementById("__markable_media_preview_css__")?.remove();
  });

  // Calling injectPluginCSS() twice must produce only one <style> tag.
  it("does not inject duplicate style tags on repeated calls", () => {
    injectPluginCSS();
    injectPluginCSS();
    const tags = document.querySelectorAll("#__markable_media_preview_css__");
    expect(tags.length).toBe(1);
  });

  // removePluginCSS() removes the injected <style> tag.
  it("removes the style tag on removePluginCSS()", () => {
    injectPluginCSS();
    removePluginCSS();
    expect(document.getElementById("__markable_media_preview_css__")).toBeNull();
  });

  // removePluginCSS() is safe when the tag does not exist (no errors).
  it("removePluginCSS is safe when tag does not exist", () => {
    expect(() => removePluginCSS()).not.toThrow();
  });
});

// ── EC-31 XSS guard ───────────────────────────────────────────────────────────

describe("media-preview — EC-31 CSS XSS guard", () => {
  // jsdom's CSS engine strips dangerous values from style.cssText the same way
  // browser engines do. The assignment goes through the CSS value sanitizer,
  // which rejects javascript: protocol values.
  it("style.cssText assignment does not execute javascript: protocol values", () => {
    const img = document.createElement("img");
    img.style.cssText = "background:url(javascript:alert(1))";
    // After assignment, the property must NOT contain 'javascript:'.
    // jsdom (like browsers) strips the dangerous value silently.
    expect(img.style.cssText).not.toContain("javascript:");
  });

  // Valid CSS values are preserved correctly after style.cssText assignment.
  it("style.cssText allows valid CSS values", () => {
    const img = document.createElement("img");
    img.style.cssText = "opacity: 0.5; border: 1px solid red;";
    expect(img.style.opacity).toBe("0.5");
  });
});

// ── ImageWidget.toDOM() — dimension application ───────────────────────────────

describe("ImageWidget.toDOM() — dimension application", () => {
  // Helper: construct an ImageWidget using the full 8-argument constructor signature.
  // resolvedSrc must be non-empty so the <img> code path runs (not broken-image path).
  // Signature: (resolvedSrc, cleanAlt, cssClasses, cssStyle, displayWidth, displayHeight,
  //             maxDisplayWidth, originalSrc)

  // AC-9: Annotated dimensions within cap — explicit width and height are applied.
  it("applies annotated width and height when within maxDisplayWidth cap (AC-9)", () => {
    // displayWidth=400, displayHeight=300, maxDisplayWidth=600: 400 < 600 so no capping.
    const widget = new ImageWidget(
      "asset://test.png", // resolvedSrc — non-empty triggers the <img> path
      "alt",
      [],
      undefined,
      400,   // displayWidth
      300,   // displayHeight
      600,   // maxDisplayWidth
      "test.png",
    );
    const container = widget.toDOM();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("400px");
    expect(img.style.height).toBe("300px");
  });

  // EC-16: Annotated width exceeds cap — width is capped at maxDisplayWidth.
  it("caps annotated width to maxDisplayWidth when annotation exceeds cap (EC-16)", () => {
    // displayWidth=800 > maxDisplayWidth=600: effective width must be capped at 600.
    const widget = new ImageWidget(
      "asset://test.png",
      "alt",
      [],
      undefined,
      800,       // displayWidth — exceeds cap
      undefined, // displayHeight — absent (guard is !== undefined, not falsy)
      600,       // maxDisplayWidth — cap
      "test.png",
    );
    const container = widget.toDOM();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("600px");
  });

  // AC-11: No annotation, maxDisplayWidth > 0 — maxDisplayWidth used as default width.
  it("uses maxDisplayWidth as default width when no annotation is provided (AC-11)", () => {
    // No displayWidth, no displayHeight, maxDisplayWidth=600 → img gets width=600px.
    const widget = new ImageWidget(
      "asset://test.png",
      "alt",
      [],
      undefined,
      undefined, // displayWidth — absent
      undefined, // displayHeight — absent
      600,       // maxDisplayWidth
      "test.png",
    );
    const container = widget.toDOM();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("600px");
    // Height must be "auto" so the image scales proportionally (FR-2.1).
    expect(img.style.height).toBe("auto");
  });

  // Natural size: no annotation and maxDisplayWidth=0 — no explicit dimension constraint.
  it("leaves width unset when no annotation and maxDisplayWidth is 0", () => {
    // maxDisplayWidth=0 means "no constraint" (AD-5). Neither width nor height must
    // be set on the img element; CSS max-width: 100% on .cm-media-image handles overflow.
    const widget = new ImageWidget(
      "asset://test.png",
      "alt",
      [],
      undefined,
      undefined, // displayWidth
      undefined, // displayHeight
      0,         // maxDisplayWidth = 0 → no constraint
      "test.png",
    );
    const container = widget.toDOM();
    const img = container.querySelector("img") as HTMLImageElement;
    // style.width must be empty ("") or not set — natural browser sizing applies.
    expect(img.style.width).toBe("");
  });
});

// ── Runtime-only test cases (skipped) ────────────────────────────────────────

describe("media-preview — runtime-only (requires live WebView)", () => {
  // Requires Tauri WebView and the asset:// protocol; cannot run in jsdom.
  it.skip("loads a real local image file via asset:// protocol (EC-11 GIF, EC-12 SVG)", () => {
    // Requires Tauri WebView; cannot test in jsdom.
  });

  // onerror is not triggered by jsdom — only fires in a real browser with a failed network/fs request.
  it.skip("onerror handler fires for a 404 image and shows broken-image placeholder (FR-5.2)", () => {
    // Requires network or filesystem; onerror is not triggered by jsdom.
  });

  // Requires live EditorView and DOM event system for cursor movement.
  it.skip("cursor-on-reveal: clicking a rendered widget moves cursor inside range (FR-1.5)", () => {
    // Requires live EditorView and DOM event system.
  });

  // Requires live EditorView to test StateField recomputation on cursor changes.
  it.skip("StateField recomputes correctly when cursor enters/exits image range (EC-01, EC-02)", () => {
    // Requires live EditorView.
  });

  // Requires live EditorView and multiple image decorations on the same line.
  it.skip("two images on the same line both render correctly (EC-19)", () => {
    // Requires live EditorView.
  });

  // Requires live EditorView with lezer parse context for blockquote nesting.
  it.skip("image inside blockquote renders (EC-22)", () => {
    // Requires live EditorView with lezer parse.
  });

  // lezer handles code block exclusion natively; verified manually in the app.
  it.skip("image inside fenced code block produces no widget (EC-13)", () => {
    // Handled by lezer; verified manually.
  });

  // EC-16 full rendering in WebView: the unit test above (ImageWidget.toDOM()) verifies
  // the _applyDimensions capping logic. This skip documents the WebView-only portion.
  it.skip("wide annotated image is capped by maxDisplayWidth when widget renders in WebView (EC-16 runtime)", () => {
    // _applyDimensions capping verified by ImageWidget.toDOM() unit test above.
    // Full rendering in a live WebView is a runtime-only verification.
  });

  // EC-28: Absolute paths with special characters go through convertFileSrc.
  // The relative-path variant (EC-05) is verified by the resolveImageSrc unit tests.
  it.skip("image with special characters in absolute path resolves via convertFileSrc (EC-28 runtime)", () => {
    // Relative-path special-char handling verified by EC-05 test.
    // Absolute-path variant with convertFileSrc requires a live WebView.
  });
});
