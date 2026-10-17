/**
 * Page preview: Ctrl/Cmd hover on an internal link, including markdown links.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  _testing,
  buildHoverHandler,
  buildPreviewKeyHandler,
  computeMarkdownPreviewMarks,
  injectWikiPopoverStyles,
  previewTargetFromHref,
  showWikiPopover,
} from "../../../src/plugins/backlinks/backlinks.plugin";

function linkSpan(target: string): HTMLElement {
  const span = document.createElement("span");
  span.setAttribute("data-wiki-target", target);
  span.textContent = "Other";
  document.body.appendChild(span);
  return span;
}

function over(el: HTMLElement, ctrlKey: boolean): MouseEvent {
  const event = new MouseEvent("mouseover", { bubbles: true, ctrlKey });
  Object.defineProperty(event, "target", { value: el });
  return event;
}

describe("page preview targets", () => {
  it("keeps internal note paths and drops web or hash-only links", () => {
    expect(previewTargetFromHref("other.md")).toBe("other.md");
    expect(previewTargetFromHref("../notes/other.md#Title")).toBe("../notes/other.md");
    expect(previewTargetFromHref("https://example.com")).toBeNull();
    expect(previewTargetFromHref("mailto:a@b.c")).toBeNull();
    expect(previewTargetFromHref("#Heading")).toBeNull();
  });

  it("marks the label of an internal markdown link and skips images and the web", () => {
    const text = [
      "See [Other](other.md) and [Web](https://example.com).",
      "![pic](pic.png)",
      "```",
      "[Hidden](hidden.md)",
      "```",
    ].join("\n");
    expect(computeMarkdownPreviewMarks(text)).toEqual([
      { from: text.indexOf("Other"), to: text.indexOf("Other") + "Other".length, target: "other.md" },
    ]);
  });
});

describe("page preview hover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _testing.setEnabled(true);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
    document.head.querySelector("[data-markable-wiki-popover-styles]")?.remove();
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue("# Other note\n\nBody text that should be readable."),
    };
    injectWikiPopoverStyles();
  });

  afterEach(() => {
    vi.useRealTimers();
    _testing.setEnabled(false);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it("does not open a preview on hover until Ctrl or Cmd is held", async () => {
    const span = linkSpan("other.md");
    const hover = buildHoverHandler();

    hover(over(span, false));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector("[data-markable-wiki-popover]")).toBeNull();

    hover(over(span, true));
    await vi.advanceTimersByTimeAsync(200);
    const popover = document.querySelector("[data-markable-wiki-popover]");
    expect(popover).not.toBeNull();
    expect(popover!.textContent).toContain("Other note");

    const title = popover!.querySelector(".wl-popover-title") as HTMLElement;
    expect(getComputedStyle(title).fontSize).toBe("16px");
    const box = getComputedStyle(popover as HTMLElement);
    expect(box.maxWidth).toBe("440px");
    expect(box.minWidth).toBe("280px");
  });

  it("opens the preview when Ctrl is pressed while the pointer is already on the link", async () => {
    const span = linkSpan("other.md");
    buildHoverHandler()(over(span, false));
    const key = new KeyboardEvent("keydown", { ctrlKey: true, key: "Control" });
    buildPreviewKeyHandler()(key);
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector("[data-markable-wiki-popover]")?.textContent).toContain("Other note");
  });

  it("renders a readable title from the linked note", async () => {
    const span = linkSpan("other.md");
    await showWikiPopover(span, "other.md");
    const title = document.querySelector(".wl-popover-title");
    expect(title?.textContent).toBe("Other note");
    expect(getComputedStyle(title as HTMLElement).fontSize).toBe("16px");
  });
});
