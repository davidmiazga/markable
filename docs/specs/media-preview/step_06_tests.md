---
title: "step_06 — Tests"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_06 — Tests

## Goal

Write the complete Vitest test suite for `media-preview.plugin.ts`. All unit-testable
exported functions must be covered. Runtime-only behaviors (actual image loading, `onerror`
in a real WebView, CM6 decoration rendering) are documented as skipped tests with
explanatory comments.

---

## File

`tests/plugins/media-preview/media-preview.test.ts`

---

## Test Setup

### Imports

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseAltAnnotations,
  resolveImageSrc,
  isCursorInsideRange,
  renderBrokenImage,
} from "../../../src/plugins/media-preview/media-preview.plugin";
```

`scanImageRanges` and `buildImageDecorations` are not directly importable in Vitest
without a live CM6 EditorState. They are tested via integration in the running app
(see "Runtime-Only Cases" below). The scanner logic is entirely delegated to lezer —
all annotation and URL logic is covered by testing `parseAltAnnotations` and
`resolveImageSrc` directly.

### Mock setup for `resolveImageSrc`

`resolveImageSrc` accesses `window.__MARKABLE_CONVERT_FILE_SRC__`. In Vitest (jsdom
environment), set this up in `beforeEach`:

```typescript
beforeEach(() => {
  // Mock window.__MARKABLE_CONVERT_FILE_SRC__ as a simple identity wrapper
  // that prepends "asset://" to simulate what Tauri's convertFileSrc does.
  (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (path: string) =>
    `asset://${path.replace(/^\//, "")}`;
});

afterEach(() => {
  delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
});
```

---

## Test Suite Structure

```
describe("media-preview — parseAltAnnotations", () => { ... })
describe("media-preview — resolveImageSrc", () => { ... })
describe("media-preview — isCursorInsideRange", () => { ... })
describe("media-preview — renderBrokenImage", () => { ... })
describe("media-preview — CSS injection idempotency", () => { ... })
```

---

## `parseAltAnnotations` Tests

```typescript
describe("media-preview — parseAltAnnotations", () => {
  // EC-04: Empty alt text
  it("handles empty alt text", () => {
    const result = parseAltAnnotations("");
    expect(result.cleanAlt).toBe("");
    expect(result.cssClasses).toEqual([]);
    expect(result.cssStyle).toBeUndefined();
    expect(result.displayWidth).toBeUndefined();
    expect(result.displayHeight).toBeUndefined();
  });

  // Plain alt text, no annotations
  it("returns plain alt text unchanged", () => {
    const result = parseAltAnnotations("photo");
    expect(result.cleanAlt).toBe("photo");
    expect(result.cssClasses).toEqual([]);
  });

  // FR-2.1: WxH dimension annotation
  it("parses width x height annotation", () => {
    const result = parseAltAnnotations("photo|400x300");
    expect(result.cleanAlt).toBe("photo");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // EC-17: Width only
  it("parses width-only annotation", () => {
    const result = parseAltAnnotations("photo|400");
    expect(result.cleanAlt).toBe("photo");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBeUndefined();
  });

  // FR-2.2: Unicode multiply × as separator
  it("accepts Unicode multiply × as dimension separator", () => {
    const result = parseAltAnnotations("photo|400×300");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.2: Spaces around |
  it("tolerates spaces around | separator", () => {
    const result = parseAltAnnotations("photo | 400 x 300");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.5: Zero width treated as undefined
  it("ignores zero width", () => {
    const result = parseAltAnnotations("photo|0x300");
    expect(result.displayWidth).toBeUndefined();
    // Height is still parsed even when width is zero
    expect(result.displayHeight).toBe(300);
  });

  // FR-2.5: Negative values — regex only matches \d+, so negatives cannot occur
  // but document this for clarity
  it("does not produce negative dimensions (regex prevents this)", () => {
    const result = parseAltAnnotations("photo|-400x300");
    // The negative sign breaks the dimension match; no dimensions extracted
    expect(result.displayWidth).toBeUndefined();
    expect(result.displayHeight).toBeUndefined();
  });

  // FR-2.4: Class shorthand
  it("extracts single CSS class from alt text", () => {
    const result = parseAltAnnotations("photo.center");
    expect(result.cssClasses).toEqual(["center"]);
    expect(result.cleanAlt).toBe("photo");
  });

  it("extracts multiple CSS classes", () => {
    const result = parseAltAnnotations("photo.center.shadow");
    expect(result.cssClasses).toContain("center");
    expect(result.cssClasses).toContain("shadow");
    expect(result.cleanAlt).toBe("photo");
  });

  // EC-33: Invalid class name characters — silently discarded
  it("discards class tokens with invalid characters (EC-33)", () => {
    // "my class" has a space — invalid token
    const result = parseAltAnnotations("photo.my class!");
    expect(result.cssClasses).toEqual([]);
  });

  it("accepts valid class name characters (letters, digits, hyphen, underscore)", () => {
    const result = parseAltAnnotations("photo.valid-name_1");
    expect(result.cssClasses).toEqual(["valid-name_1"]);
  });

  // FR-2.4: Inline CSS
  it("extracts inline CSS from {braces}", () => {
    const result = parseAltAnnotations("photo{opacity:0.8}");
    expect(result.cssStyle).toBe("opacity:0.8");
    expect(result.cleanAlt).toBe("photo");
  });

  it("trims whitespace inside inline CSS", () => {
    const result = parseAltAnnotations("photo{ opacity: 0.8 }");
    expect(result.cssStyle).toBe("opacity: 0.8");
  });

  // EC-34: All three annotations combined
  it("handles all three annotations together (EC-34)", () => {
    const result = parseAltAnnotations("photo.center|400x300{opacity:0.8}");
    expect(result.cleanAlt).toBe("photo");
    expect(result.cssClasses).toContain("center");
    expect(result.displayWidth).toBe(400);
    expect(result.displayHeight).toBe(300);
    expect(result.cssStyle).toBe("opacity:0.8");
  });

  // Class before dimension annotation
  it("handles class shorthand before dimension annotation", () => {
    const result = parseAltAnnotations("photo.center|400x300");
    expect(result.cssClasses).toContain("center");
    expect(result.displayWidth).toBe(400);
  });

  // Empty CSS block
  it("treats empty CSS block {} as no CSS style", () => {
    const result = parseAltAnnotations("photo{}");
    expect(result.cssStyle).toBeUndefined();
  });
});
```

---

## `resolveImageSrc` Tests

```typescript
describe("media-preview — resolveImageSrc", () => {
  // EC-03: Empty URL
  it("returns empty string for empty src", () => {
    expect(resolveImageSrc("", null)).toBe("");
  });

  it("returns empty string for whitespace-only src", () => {
    expect(resolveImageSrc("   ", null)).toBe("");
  });

  // EC-09: file:// rejected
  it("rejects file:// protocol (EC-09)", () => {
    expect(resolveImageSrc("file:///Users/x/img.png", null)).toBe("");
  });

  // FR-3.1: Remote URLs passed through
  it("passes through http:// URLs unchanged", () => {
    const url = "http://example.com/img.png";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  it("passes through https:// URLs unchanged", () => {
    const url = "https://example.com/img.png";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  // FR-3.4: data: URIs passed through
  it("passes through data: URIs unchanged", () => {
    const url = "data:image/png;base64,abc123";
    expect(resolveImageSrc(url, null)).toBe(url);
  });

  // FR-3.1: Absolute path → convertFileSrc
  it("converts absolute path via __MARKABLE_CONVERT_FILE_SRC__", () => {
    const result = resolveImageSrc("/Users/x/img.png", null);
    expect(result).toBe("asset://Users/x/img.png");
  });

  // FR-3.1: Relative path → resolved against current file dir → convertFileSrc
  it("resolves relative path against current file directory", () => {
    const result = resolveImageSrc("img.png", "/Users/x/doc.md");
    expect(result).toBe("asset://Users/x/img.png");
  });

  it("resolves ./relative path against current file directory", () => {
    const result = resolveImageSrc("./img.png", "/Users/x/doc.md");
    // The raw join is "/Users/x/./img.png" — convertFileSrc receives this
    expect(result).toContain("Users/x");
  });

  // EC-07: No current file path for relative URL
  it("returns raw src when currentFile is null for relative path (EC-07)", () => {
    const result = resolveImageSrc("img.png", null);
    // Falls through to pass-through (will fail to load; onerror fires)
    expect(result).toBe("img.png");
  });

  // EC-05: URL with spaces
  it("passes URL with spaces through as-is for convertFileSrc (EC-05)", () => {
    const result = resolveImageSrc("my photo.png", "/Users/x/doc.md");
    expect(result).toContain("my photo.png");
  });

  // EC-35: __MARKABLE_CONVERT_FILE_SRC__ not defined
  it("returns src as-is when __MARKABLE_CONVERT_FILE_SRC__ is undefined (EC-35)", () => {
    delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
    const result = resolveImageSrc("/Users/x/img.png", null);
    // Falls through to pass-through with a console.warn
    expect(result).toBe("/Users/x/img.png");
  });
});
```

---

## `isCursorInsideRange` Tests

```typescript
describe("media-preview — isCursorInsideRange", () => {
  // EC-01: Cursor exactly on opening character (at `from`)
  it("treats cursor at `from` as inside (EC-01)", () => {
    expect(isCursorInsideRange(10, 10, 10, 20)).toBe(true);
  });

  // EC-02: Cursor exactly on closing character (at `to - 1`)
  it("treats cursor at `to - 1` as inside (EC-02)", () => {
    expect(isCursorInsideRange(19, 19, 10, 20)).toBe(true);
  });

  // Cursor exactly at `to` is OUTSIDE
  it("treats cursor at `to` as outside", () => {
    expect(isCursorInsideRange(20, 20, 10, 20)).toBe(false);
  });

  // Cursor before range
  it("treats cursor before range as outside", () => {
    expect(isCursorInsideRange(5, 5, 10, 20)).toBe(false);
  });

  // Cursor after range
  it("treats cursor after range as outside", () => {
    expect(isCursorInsideRange(25, 25, 10, 20)).toBe(false);
  });

  // Cursor in middle of range
  it("treats cursor in middle of range as inside", () => {
    expect(isCursorInsideRange(15, 15, 10, 20)).toBe(true);
  });

  // Selection spanning entire range
  it("treats selection spanning the entire range as inside", () => {
    expect(isCursorInsideRange(10, 20, 10, 20)).toBe(true);
  });

  // Selection starting before, ending inside
  it("treats selection starting before and ending inside as inside", () => {
    expect(isCursorInsideRange(5, 15, 10, 20)).toBe(true);
  });

  // Selection starting inside, ending after
  it("treats selection starting inside and ending after as inside", () => {
    expect(isCursorInsideRange(15, 25, 10, 20)).toBe(true);
  });

  // Reversed selection (anchor > head)
  it("handles reversed selection (anchor > head)", () => {
    expect(isCursorInsideRange(15, 5, 10, 20)).toBe(true);
  });

  // Selection entirely before range
  it("treats selection entirely before range as outside", () => {
    expect(isCursorInsideRange(1, 8, 10, 20)).toBe(false);
  });

  // Selection entirely after range
  it("treats selection entirely after range as outside", () => {
    expect(isCursorInsideRange(21, 30, 10, 20)).toBe(false);
  });
});
```

---

## `renderBrokenImage` Tests

```typescript
describe("media-preview — renderBrokenImage", () => {
  it("sets cm-media-broken class on container", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt text", "broken.png");
    expect(container.className).toContain("cm-media-broken");
  });

  it("sets title to the original src URL", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt text", "/path/to/image.png");
    expect(container.title).toBe("/path/to/image.png");
  });

  it("shows fallback title for empty src (EC-03)", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "", "");
    expect(container.title).toBe("(empty URL)");
  });

  it("renders an SVG icon child element", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "alt", "broken.png");
    const icon = container.querySelector(".cm-media-broken-icon");
    expect(icon).not.toBeNull();
    expect(icon?.querySelector("svg")).not.toBeNull();
  });

  it("shows caption when cleanAlt is non-empty", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "My Image", "broken.png");
    const caption = container.querySelector(".cm-media-broken-caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent).toBe("My Image");
  });

  it("omits caption when cleanAlt is empty (EC-04)", () => {
    const container = document.createElement("span");
    renderBrokenImage(container, "", "broken.png");
    const caption = container.querySelector(".cm-media-broken-caption");
    expect(caption).toBeNull();
  });
});
```

---

## CSS Injection Idempotency Test

```typescript
describe("media-preview — CSS injection idempotency (EC-30)", () => {
  afterEach(() => {
    // Clean up any injected style tags between tests
    document.getElementById("__markable_media_preview_css__")?.remove();
  });

  it("does not inject duplicate style tags on repeated calls", () => {
    // Import the injection functions — they are exported from the plugin file
    // This test requires importing the CSS helpers; if the plugin has side effects
    // at import time, adjust accordingly.
    // For isolation, call injectPluginCSS twice and verify only one tag exists.
    injectPluginCSS();
    injectPluginCSS();
    const tags = document.querySelectorAll("#__markable_media_preview_css__");
    expect(tags.length).toBe(1);
  });

  it("removes the style tag on removePluginCSS()", () => {
    injectPluginCSS();
    removePluginCSS();
    expect(document.getElementById("__markable_media_preview_css__")).toBeNull();
  });

  it("removePluginCSS is safe when tag does not exist", () => {
    expect(() => removePluginCSS()).not.toThrow();
  });
});
```

Note: `injectPluginCSS` and `removePluginCSS` must be imported in this test block. Add
them to the import statement at the top of the test file.

---

## EC-31 XSS Guard Test

```typescript
describe("media-preview — EC-31 CSS XSS guard", () => {
  it("style.cssText assignment does not execute javascript: protocol values", () => {
    // jsdom's CSS engine strips dangerous values from style.cssText the same
    // way browser engines do. Verify by assigning and reading back.
    const img = document.createElement("img");
    img.style.cssText = "background:url(javascript:alert(1))";
    // After assignment, the value should either be empty or stripped of the
    // javascript: reference. It must NOT contain 'javascript:'.
    expect(img.style.cssText).not.toContain("javascript:");
  });

  it("style.cssText allows valid CSS values", () => {
    const img = document.createElement("img");
    img.style.cssText = "opacity: 0.5; border: 1px solid red;";
    expect(img.style.opacity).toBe("0.5");
  });
});
```

---

## Runtime-Only Test Cases (Skipped)

Document these as `it.skip` with explanatory comments so the test file captures the
full requirement coverage picture:

```typescript
describe("media-preview — runtime-only (requires live WebView)", () => {
  it.skip("loads a real local image file via asset:// protocol (EC-11 GIF, EC-12 SVG)", () => {
    // Requires Tauri WebView; cannot test in jsdom.
  });

  it.skip("onerror handler fires for a 404 image and shows broken-image placeholder (FR-5.2)", () => {
    // Requires network or filesystem; onerror is not triggered by jsdom.
  });

  it.skip("cursor-on-reveal: clicking a rendered widget moves cursor inside range (FR-1.5)", () => {
    // Requires live EditorView and DOM event system.
  });

  it.skip("StateField recomputes correctly when cursor enters/exits image range (EC-01, EC-02)", () => {
    // Requires live EditorView.
  });

  it.skip("two images on the same line both render correctly (EC-19)", () => {
    // Requires live EditorView.
  });

  it.skip("image inside blockquote renders (EC-22)", () => {
    // Requires live EditorView with lezer parse.
  });

  it.skip("image inside fenced code block produces no widget (EC-13)", () => {
    // Handled by lezer; verified manually.
  });
});
```

---

## Vitest Configuration

No new Vitest configuration is required. The existing `vitest.config.ts` (if present)
already runs `tests/**/*.test.ts` with a jsdom environment. Confirm the configuration
includes:

```typescript
environment: "jsdom"
```

If the configuration does not exist or does not include jsdom, check the existing math
test setup (`tests/plugins/math/math.test.ts`) and mirror its configuration.

---

## Running Tests

```bash
npm test                             # Run all tests
npm test -- media-preview            # Run only media-preview tests
npm test -- --coverage               # With coverage report
```

---

## Expected Test Count

Based on the test cases above:
- `parseAltAnnotations`: ~15 test cases
- `resolveImageSrc`: ~12 test cases
- `isCursorInsideRange`: ~12 test cases
- `renderBrokenImage`: ~6 test cases
- CSS idempotency: ~3 test cases
- EC-31 XSS guard: ~2 test cases

**Total: ~50 passing tests, ~7 skipped (runtime-only)**

---

## Definition of Done

- [ ] `tests/plugins/media-preview/media-preview.test.ts` file exists and passes.
- [ ] All `parseAltAnnotations` cases from step_02 design checklist covered.
- [ ] All `resolveImageSrc` URL category cases covered.
- [ ] All `isCursorInsideRange` boundary cases covered (EC-01, EC-02).
- [ ] `renderBrokenImage` DOM structure verified.
- [ ] CSS idempotency (EC-30) verified.
- [ ] EC-31 XSS guard verified via jsdom `style.cssText`.
- [ ] Runtime-only cases documented as `it.skip` with comments.
- [ ] `npm test` passes with 0 new failures (existing tests unaffected).
- [ ] No TODO comments in test file.
