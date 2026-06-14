/**
 * tests/collections/breadcrumb.test.ts — step_07
 *
 * Asserts the stateless breadcrumb component:
 *   - renders one segment per input + (N−1) separators
 *   - segment with onClick=null is a span ("current"); others are buttons
 *   - click → callback fires
 *   - labels are textContent (no innerHTML injection)
 *   - aria-label = "Breadcrumb"
 *   - re-render yields independent elements (stateless)
 *   - 5-segment input renders 5 + 4 separators (phase-2 ready)
 */

import { describe, it, expect, vi } from "vitest";
import { renderBreadcrumb } from "../../src/plugins/file-browser/collections/breadcrumb";

describe("breadcrumb: structure (step_07)", () => {
  it("renders one segment + zero separators for a 1-segment input", () => {
    const el = renderBreadcrumb([{ label: "Home", onClick: null }]);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-seg").length).toBe(1);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-sep").length).toBe(0);
  });

  it("FR-30 — renders 3 segments + 2 separators for the MVP case", () => {
    const el = renderBreadcrumb([
      { label: "Home", onClick: vi.fn() },
      { label: "Stack 01", onClick: vi.fn() },
      { label: "Note.md", onClick: null },
    ]);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-seg").length).toBe(3);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-sep").length).toBe(2);
  });

  it("C-11 — renders 5 segments + 4 separators (phase-2 readiness)", () => {
    const el = renderBreadcrumb([
      { label: "Home", onClick: vi.fn() },
      { label: "Book", onClick: vi.fn() },
      { label: "Chapter", onClick: vi.fn() },
      { label: "Stack", onClick: vi.fn() },
      { label: "Note.md", onClick: null },
    ]);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-seg").length).toBe(5);
    expect(el.querySelectorAll(".fv-collection-breadcrumb-sep").length).toBe(4);
  });

  it("FR-31 — last segment with onClick=null renders as span (is-current), not button", () => {
    const el = renderBreadcrumb([
      { label: "Home", onClick: vi.fn() },
      { label: "Note.md", onClick: null },
    ]);
    const segs = el.querySelectorAll(".fv-collection-breadcrumb-seg");
    expect(segs[0].tagName).toBe("BUTTON");
    expect(segs[1].tagName).toBe("SPAN");
    expect(segs[1].classList.contains("is-current")).toBe(true);
  });

  it("FR-31 — non-current segment with onClick=null renders as span (not button) regardless of position", () => {
    const el = renderBreadcrumb([
      { label: "Home", onClick: null },
      { label: "Note.md", onClick: vi.fn() },
    ]);
    const segs = el.querySelectorAll(".fv-collection-breadcrumb-seg");
    expect(segs[0].tagName).toBe("SPAN");
    expect(segs[1].tagName).toBe("BUTTON");
  });
});

describe("breadcrumb: behaviour (step_07)", () => {
  it("FR-31 — clicking a segment fires its onClick", () => {
    const spy = vi.fn();
    const el = renderBreadcrumb([
      { label: "Home", onClick: spy },
      { label: "Note.md", onClick: null },
    ]);
    document.body.appendChild(el);
    (el.querySelectorAll(".fv-collection-breadcrumb-seg")[0] as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalled();
    el.remove();
  });

  it("XSS — label text is rendered as textContent (not parsed as HTML)", () => {
    const el = renderBreadcrumb([
      { label: "<script>x</script>", onClick: null },
    ]);
    // textContent on the segment matches the literal label; no <script>
    // element is created inside.
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector(".fv-collection-breadcrumb-seg")?.textContent).toBe(
      "<script>x</script>",
    );
  });

  it("a11y — aria-label equals 'Breadcrumb'", () => {
    const el = renderBreadcrumb([{ label: "Home", onClick: null }]);
    expect(el.getAttribute("aria-label")).toBe("Breadcrumb");
  });

  it("stateless — render twice yields two independent elements", () => {
    const segments = [{ label: "Home", onClick: null }];
    const a = renderBreadcrumb(segments);
    const b = renderBreadcrumb(segments);
    expect(a).not.toBe(b);
    // Mutating a does not affect b.
    a.classList.add("test-mutation");
    expect(b.classList.contains("test-mutation")).toBe(false);
  });

  it("EC-24 — re-render after a Stack rename updates middle segment without navigation", () => {
    const click = vi.fn();
    const first = renderBreadcrumb([
      { label: "Home", onClick: vi.fn() },
      { label: "Stack 01", onClick: click },
      { label: "Note.md", onClick: null },
    ]);
    expect(first.querySelectorAll(".fv-collection-breadcrumb-seg")[1].textContent).toBe(
      "Stack 01",
    );
    const second = renderBreadcrumb([
      { label: "Home", onClick: vi.fn() },
      { label: "Stack 99 Renamed", onClick: click },
      { label: "Note.md", onClick: null },
    ]);
    expect(second.querySelectorAll(".fv-collection-breadcrumb-seg")[1].textContent).toBe(
      "Stack 99 Renamed",
    );
  });
});
