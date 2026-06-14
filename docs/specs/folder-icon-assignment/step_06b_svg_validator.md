---
title: "Step 06b — SVG Validator (pure TS)"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 06b — SVG Validator (pure TS)

## Goal

Build a small, pure-TS validator that gates the "Add custom SVG…"
flow. The validator answers one question: "Is this file content
safe to add to the user's `customFolderIcons` list?" with a
typed `ValidationResult`. It does **not** mutate or sanitise. It
does **not** touch disk or settings — the caller (step_06 picker)
reads the file via `readFile()` and calls this synchronous function
with the text and byte length.

Sanitisation lives in `folder-icon-custom-cache.ts` (step_05 §C2) and
runs at **render time**, on the same path before injection. The
validator's job is to refuse-add early, before the path enters
settings. FR-15 (sanitise at render) and FR-16 (validate at add) are
deliberately split.

## Inputs

- Requirements: FR-16 (size cap 32 KB, DOMParser validation, root must
  be `<svg>`), EC-18 (invalid SVG / PNG / corrupt file / parsererror),
  EC-19 (>32 KB rejected).
- Constraint: C-10 (no DOMPurify; reuse what we have), C-12 (validator
  is pure — no disk I/O, no settings access).
- Project memory: `feedback_look_first` — DOMParser is already
  available in the renderer; no new dependency.

## Files

| Action | File |
|---|---|
| Create | `src/plugins/file-browser/svg-validator.ts` |
| Create | `tests/folder-icons/svg-validator.test.ts` |

## API Contract

```typescript
// src/plugins/file-browser/svg-validator.ts

/** Hard limit on accepted SVG size. FR-16. */
export const SVG_MAX_BYTES = 32 * 1024;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_large" | "parse_error" | "not_svg" | "empty" };

/**
 * Validate a candidate SVG file. Pure: no disk I/O, no DOMParser
 * mutation, no side effects. The caller has already read the file
 * via `readFile()` and is passing the raw text + byte length here.
 *
 * Validation passes (returns `{ ok: true }`) when:
 *   1. byteLength > 0 and byteLength <= SVG_MAX_BYTES (FR-16);
 *   2. content parses as an XML document via DOMParser with NO
 *      `<parsererror>` node anywhere in the result;
 *   3. the document's root element is `<svg>` (any namespace).
 *
 * On failure, returns `{ ok: false, reason }` where reason is:
 *   - "empty"       — byteLength === 0 (defensive)
 *   - "too_large"   — byteLength > SVG_MAX_BYTES (EC-19)
 *   - "parse_error" — DOMParser produced a parsererror node
 *   - "not_svg"     — parses cleanly but the root is not <svg>
 *                     (e.g. user picked a `.html` file, a `.png`
 *                     binary that happens to UTF-8-decode without
 *                     throwing, or an SVG-shaped file rooted in
 *                     something other than <svg>).
 *
 * The picker surfaces the user-visible error string mapped from the
 * reason — see step_06 picker's "Add custom SVG…" handler. This
 * function does not produce localised strings.
 */
export function validateSvgFile(
  svgText: string,
  byteLength: number,
): ValidationResult;
```

## Implementation (Green)

```typescript
export const SVG_MAX_BYTES = 32 * 1024;

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: "too_large" | "parse_error" | "not_svg" | "empty" };

export function validateSvgFile(
  svgText: string,
  byteLength: number,
): ValidationResult {
  if (byteLength === 0) return { ok: false, reason: "empty" };
  if (byteLength > SVG_MAX_BYTES) return { ok: false, reason: "too_large" };

  // DOMParser is available in the renderer (Tauri WebView). The
  // "image/svg+xml" mime causes the parser to apply XML rules; on
  // parse failure it inserts a <parsererror> node into the result
  // document.
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");

  // Walk the document for any parsererror node (it may be nested
  // inside the root in some implementations).
  if (doc.querySelector("parsererror")) {
    return { ok: false, reason: "parse_error" };
  }

  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return { ok: false, reason: "not_svg" };
  }

  return { ok: true };
}
```

## Failing tests (write FIRST — Red)

```typescript
// tests/folder-icons/svg-validator.test.ts
import { describe, it, expect } from "vitest";
import {
  validateSvgFile,
  SVG_MAX_BYTES,
} from "../../src/plugins/file-browser/svg-validator";

describe("validateSvgFile (step_06b)", () => {
  it("accepts a minimal well-formed SVG", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>`;
    expect(validateSvgFile(svg, svg.length)).toEqual({ ok: true });
  });

  it("EC-19 — rejects a file larger than 32 KB", () => {
    const svg = `<svg>${"x".repeat(SVG_MAX_BYTES + 100)}</svg>`;
    const r = validateSvgFile(svg, svg.length);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_large");
  });

  it("accepts exactly 32 KB (cap is inclusive)", () => {
    // Pad to exactly SVG_MAX_BYTES with a valid SVG prefix.
    const prefix = `<svg xmlns="http://www.w3.org/2000/svg"><desc>`;
    const suffix = `</desc></svg>`;
    const filler = "x".repeat(SVG_MAX_BYTES - prefix.length - suffix.length);
    const svg = prefix + filler + suffix;
    expect(svg.length).toBe(SVG_MAX_BYTES);
    expect(validateSvgFile(svg, svg.length)).toEqual({ ok: true });
  });

  it("EC-18 — rejects empty content", () => {
    const r = validateSvgFile("", 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("EC-18 — rejects content that produces a parsererror", () => {
    // Unclosed tag → parser inserts a <parsererror>.
    const broken = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="3"`;
    const r = validateSvgFile(broken, broken.length);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_error");
  });

  it("EC-18 — rejects non-SVG XML (root is not <svg>)", () => {
    const xml = `<?xml version="1.0"?><html><body/></html>`;
    const r = validateSvgFile(xml, xml.length);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_svg");
  });

  it("EC-18 — rejects a PNG header (binary that decodes as garbage)", () => {
    // PNG magic bytes + a few more — won't parse as XML cleanly.
    const png = "\x89PNG\r\n\x1a\n" + "garbage";
    const r = validateSvgFile(png, png.length);
    expect(r.ok).toBe(false);
    // Either parse_error or not_svg depending on platform behavior;
    // both are acceptable for the EC-18 contract.
    if (!r.ok) {
      expect(["parse_error", "not_svg"]).toContain(r.reason);
    }
  });

  it("accepts an SVG that includes <script> — sanitisation is at render-time", () => {
    // FR-15/FR-16 split: the validator does NOT mutate, so even
    // unsafe SVG content is accepted. The sanitiser strips scripts
    // when the file is later rendered by folder-icon-custom-cache.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`;
    expect(validateSvgFile(svg, svg.length)).toEqual({ ok: true });
  });
});
```

## Green

1. Write the failing tests above.
2. Implement `svg-validator.ts` exactly as the contract describes.
3. `npm run test:run -- tests/folder-icons/svg-validator.test.ts` —
   all pass.
4. `npm run build:plugins && npm run sync:plugins` (C-8).

## Refactor

- The reason codes are deliberately machine-readable enums, not user-
  visible strings. The picker maps them to localisable strings.
- If `DOMParser` is somehow unavailable in the test environment,
  consider adding a regex pre-check (`/<svg[\s>]/i.test(svgText)`)
  as a fast path — but only after measuring; the JSDOM-based vitest
  environment includes DOMParser.
- Do NOT add more validation rules unless a real attack vector
  surfaces. The validator's contract is intentionally narrow.

## Definition of Done

- [ ] `tests/folder-icons/svg-validator.test.ts` passes.
- [ ] No I/O performed by the validator (audit by inspection — no
      imports of `bridge`, `dialogs`, `settings`).
- [ ] `tests/settings/window-defaults.test.ts` still passes.
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).

## Sanitisation responsibility split (recap)

| Phase | Responsibility | Location |
|---|---|---|
| Add-time | Reject the file if unsafe to even keep (size, parse, root tag) | `svg-validator.ts` (this step) |
| Render-time | Strip dangerous content from accepted files before injection | `folder-icon-custom-cache.ts` (step_05 §C2) |

The render-time sanitiser is the **security guarantee**. The validator
is a UX gate: a 50 MB binary should not even enter settings. An SVG
with a `<script>` block can be accepted at add-time because the
sanitiser will neutralise it at render-time.
