/**
 * tests/folder-icons/custom-render.test.ts — step_05 (amendment 2026-06-05)
 *
 * Asserts the custom-SVG render pipeline in folder-icon-custom-cache.ts:
 *   - EC-16: missing path → null + one-time toast registry.
 *   - EC-17: sanitisation strips <script>, on*= attributes, javascript:
 *            URLs, and <foreignObject> blocks.
 *   - FR-17: cache hit/miss behaviour keyed by (path, mtimeMs).
 *   - Defensive sniff: non-SVG content is rejected → null.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

import * as bridge from "../../src/lib/bridge";
import {
  getCustomSvg,
  hasReportedMissingPath,
  markPathReported,
  __clearCustomSvgCache,
} from "../../src/plugins/file-browser/folder-icon-custom-cache";

beforeEach(() => {
  __clearCustomSvgCache();
  vi.restoreAllMocks();
});

describe("getCustomSvg — EC-16 / EC-17 + FR-17 cache (step_05)", () => {
  it("EC-16 — returns null when statFile fails (file missing)", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: false,
      error: { message: "ENOENT", command: "stat_file" },
    });
    const r = await getCustomSvg("/does/not/exist.svg");
    expect(r).toBeNull();
  });

  it("EC-16 — missing-path toast registry: hasReportedMissingPath() flips on markPathReported()", () => {
    expect(hasReportedMissingPath("/x.svg")).toBe(false);
    markPathReported("/x.svg");
    expect(hasReportedMissingPath("/x.svg")).toBe(true);
  });

  it("EC-17 — strips <script> tags from custom SVG", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("<script");
    expect(r!).toContain("<circle");
  });

  it("EC-17 — strips inline onclick attribute", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle r="5" onclick="alert(1)"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("onclick");
  });

  // ── stripScripts whitespace + unquoted-value bypass coverage ──────────────
  // The pre-fix implementation matched only a literal ASCII space before the
  // event-handler name and required a quoted attribute value. Real HTML allows
  // any whitespace (tab/newline) AND unquoted values, both of which an attacker
  // can craft to slip past the sanitiser. These tests pin the post-fix
  // behaviour: every form must be stripped.

  it("EC-17 — strips event handler separated by newline (was bypass)", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle\nonclick="alert(1)"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("onclick");
    expect(r!.toLowerCase()).not.toContain("alert");
  });

  it("EC-17 — strips event handler separated by tab (was bypass)", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle\tonclick="alert(1)"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("onclick");
    expect(r!.toLowerCase()).not.toContain("alert");
  });

  it("EC-17 — strips unquoted event handler value (was bypass)", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle onclick=alert(1)/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("onclick");
    expect(r!.toLowerCase()).not.toContain("alert");
  });

  it("EC-17 — strips multiple whitespace + quoting forms in one document", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      // Three handlers: newline+tab/double-quoted, space/unquoted, space/single-quoted.
      value: `<svg><a\n\tonmouseover="x" onclick=y onload='z'><circle r="5"/></a></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    const lower = r!.toLowerCase();
    expect(lower).not.toContain("onmouseover");
    expect(lower).not.toContain("onclick");
    expect(lower).not.toContain("onload");
    expect(r!).toContain("<circle");
  });

  it("EC-17 — strips javascript: URL schemes", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><a href="javascript:alert(1)"><circle r="5"/></a></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("javascript:");
  });

  it("EC-17 — strips unquoted javascript: URL scheme (href=javascript:...) ", async () => {
    // Issue 2 (Reviewer): the pre-fix regex required a quote or whitespace
    // before `javascript:`. An attribute like `href=javascript:alert(1)` has
    // `=` before the scheme and survived sanitization. The post-fix regex
    // also matches `=` and `>` as leading delimiters.
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><a href=javascript:alert(1)><circle r="5"/></a></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("javascript:");
  });

  it("EC-17 — removes <foreignObject> blocks entirely", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><foreignObject><div onclick="x()">hi</div></foreignObject><circle r="5"/></svg>`,
    });
    const r = await getCustomSvg("/x.svg");
    expect(r).not.toBeNull();
    expect(r!.toLowerCase()).not.toContain("<foreignobject");
    expect(r!.toLowerCase()).not.toContain("<div");
    expect(r!).toContain("<circle");
  });

  it("returns null when the file does not look like SVG", async () => {
    vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `not an svg`,
    });
    expect(await getCustomSvg("/x.svg")).toBeNull();
  });

  it("FR-17 — cache hit avoids re-reading when mtime is unchanged", async () => {
    const statSpy = vi.spyOn(bridge, "statFile").mockResolvedValue({
      ok: true,
      value: { mtimeMs: 1, size: 100 },
    });
    const readSpy = vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle r="5"/></svg>`,
    });
    await getCustomSvg("/x.svg");
    await getCustomSvg("/x.svg");
    expect(statSpy).toHaveBeenCalledTimes(2); // mtime checked each call
    expect(readSpy).toHaveBeenCalledTimes(1); // body read once
  });

  it("FR-17 — cache invalidates on mtime change", async () => {
    let m = 1;
    vi.spyOn(bridge, "statFile").mockImplementation(
      async () =>
        ({
          ok: true,
          value: { mtimeMs: m, size: 100 },
        }) as never,
    );
    const readSpy = vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: `<svg><circle r="5"/></svg>`,
    });
    await getCustomSvg("/x.svg");
    m = 2;
    await getCustomSvg("/x.svg");
    expect(readSpy).toHaveBeenCalledTimes(2);
  });
});
