/**
 * tests/folder-icons/svg-validator.test.ts — step_06b
 *
 * Asserts the pure-TS validator used to gate "Add custom SVG…" in the picker.
 *
 *   - Happy path: well-formed SVG returns `{ ok: true }`.
 *   - EC-19: files larger than SVG_MAX_BYTES (32 KB) → `{ ok: false, reason: "too_large" }`.
 *   - EC-18: empty content → `"empty"`, parser errors → `"parse_error"`,
 *            non-SVG root element → `"not_svg"`.
 *   - Sanitisation is render-time, not validate-time — an SVG containing
 *     `<script>` is still accepted (the cache strips it before injection).
 */

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

  it("EC-18 — rejects content that produces a parsererror (unclosed tag)", () => {
    // An unclosed root tag forces the XML parser to surface a parsererror.
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

  it("EC-18 — rejects a PNG header (binary that fails XML parse or is non-svg)", () => {
    // PNG magic bytes + garbage. Should NOT parse cleanly as SVG; reason is
    // either parse_error or not_svg depending on the parser implementation —
    // both are acceptable for the EC-18 contract.
    const png = "\x89PNG\r\n\x1a\n" + "garbage";
    const r = validateSvgFile(png, png.length);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(["parse_error", "not_svg"]).toContain(r.reason);
    }
  });

  it("accepts an SVG containing <script> — sanitisation is render-time", () => {
    // FR-15 / FR-16 split: the validator does NOT mutate. Even unsafe SVG
    // content is accepted; the render-time sanitiser strips scripts when
    // the file is later resolved via folder-icon-custom-cache.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`;
    expect(validateSvgFile(svg, svg.length)).toEqual({ ok: true });
  });

  it("EC-19 — rejects multibyte UTF-8 SVG whose byte length exceeds 32 KB even though its JS string length does not", () => {
    // Issue 3 (Reviewer): the picker previously passed `content.length` (UTF-16
    // code units in JS) to `validateSvgFile(content, byteLength)`, but the
    // validator's contract is BYTES. A multibyte character (e.g. the Linear B
    // syllable "𐂀", which is one astral codepoint = 4 UTF-8 bytes = 2 UTF-16
    // code units) lets us craft an SVG whose `.length` < cap but whose true
    // UTF-8 byte length > cap. The validator must reject it as `too_large`
    // when the caller passes the correct byte length.
    //
    // 4-byte UTF-8 chars: each `"𐂀"` contributes 4 bytes but only 2 JS chars,
    // so we can build a payload where bytes > 32 KB and chars < 32 KB.
    const astral = "\u{10080}"; // U+10080, 4 bytes UTF-8, 2 UTF-16 code units.
    // Pick a count that overflows the byte cap but stays under the char cap.
    // count * 4 must be > 32768; count * 2 must be < 32768.
    // count = 9000 → 36000 bytes, 18000 chars. Safely between the two limits.
    const filler = astral.repeat(9000);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><desc>${filler}</desc></svg>`;
    const byteLength = new TextEncoder().encode(svg).length;

    // Sanity: confirm the test setup actually exposes the bug condition.
    expect(svg.length).toBeLessThan(SVG_MAX_BYTES); // would have passed pre-fix
    expect(byteLength).toBeGreaterThan(SVG_MAX_BYTES); // must fail post-fix

    const r = validateSvgFile(svg, byteLength);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_large");
  });
});
