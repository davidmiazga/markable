/**
 * Tests for Step 10: Wiki-Link Hover Preview Popover.
 *
 * Covers all test cases organized by functional area:
 *
 *   1-12  extractPopoverContent  — deterministic function, no DOM required
 *  13-15  positionPopover        — DOM function, uses jsdom
 *  16-18  computeWikiLinkDecorationRanges — data-wiki-target field
 *  19-21  CSS injection (injectWikiPopoverStyles / removeWikiPopoverStyles)
 *  22-25  Edge cases (EC-07, EC-01, EC-12, race-safety via _testing)
 *  26-27  EC-08 grace-period dismissal (CRITICAL-1)
 *  28-29  EC-04 fetch-race discard path (CRITICAL-2)
 *
 * Source: src/plugins/backlinks/backlinks.plugin.ts (Step 10 additions)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractPopoverContent,
  positionPopover,
  dismissWikiPopover,
  computeWikiLinkDecorationRanges,
  injectWikiPopoverStyles,
  removeWikiPopoverStyles,
  buildHoverHandler,
  buildDismissHandler,
  _testing,
} from "../../../src/plugins/backlinks/backlinks.plugin";

// showWikiPopover is exported for test-only access per step_05 recommendation
import { showWikiPopover } from "../../../src/plugins/backlinks/backlinks.plugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock span element with a pre-set getBoundingClientRect result.
 *
 * @param rect - The four edges of the span in viewport-relative coordinates.
 * @returns An HTMLElement span with a mocked getBoundingClientRect.
 */
function makeSpan(rect: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}): HTMLElement {
  const el = document.createElement("span");
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect);
  return el;
}

/**
 * Create a popover div appended to document.body so that positionPopover
 * can apply style properties to it.
 *
 * @returns A new HTMLElement div in the DOM.
 */
function makePopover(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Suite: extractPopoverContent
// ---------------------------------------------------------------------------

describe("extractPopoverContent", () => {
  beforeEach(() => {
    // Ensure no vault manager is present; tests verify the fallback path
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
  });

  it("extracts title from YAML front matter", () => {
    const raw = `---\ntitle: My Note\n---\n\nSome body text here.`;
    const { title } = extractPopoverContent(raw, "/vault/my-note.md");
    expect(title).toBe("My Note");
  });

  it("strips quotes from YAML front matter title", () => {
    const raw = `---\ntitle: "Quoted Title"\n---\n\nBody.`;
    const { title } = extractPopoverContent(raw, "/vault/x.md");
    expect(title).toBe("Quoted Title");
  });

  it("falls through to H1 heading when no front matter title", () => {
    const raw = `# My Heading\n\nSome body text.`;
    const { title } = extractPopoverContent(raw, "/vault/x.md");
    expect(title).toBe("My Heading");
  });

  it("falls through to filename stem when no front matter and no H1", () => {
    const raw = `Some body text without any heading.`;
    const { title } = extractPopoverContent(raw, "/vault/my-document.md");
    expect(title).toBe("my-document");
  });

  it("caps content at 2048 characters before processing", () => {
    // The word 'secret' only appears after the 2048-character boundary
    const prefix = "a".repeat(2048);
    const raw = prefix + " secret content";
    const { excerpt } = extractPopoverContent(raw, "/vault/large.md");
    expect(excerpt).not.toContain("secret");
  });

  it("returns empty excerpt for front-matter-only file (EC-18)", () => {
    const raw = `---\ntitle: Front Matter Only\nauthor: Test\n---\n`;
    const { excerpt } = extractPopoverContent(raw, "/vault/fm.md");
    expect(excerpt).toBe("");
  });

  it("returns filename stem as title and empty excerpt for empty file", () => {
    const { title, excerpt } = extractPopoverContent("", "/vault/empty-file.md");
    expect(title).toBe("empty-file");
    expect(excerpt).toBe("");
  });

  it("strips fenced code block contents from excerpt", () => {
    const raw = "Some text.\n```js\nconst x = 1;\n```\nMore text.";
    const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
    expect(excerpt).not.toContain("const x");
    expect(excerpt).toContain("Some text");
    expect(excerpt).toContain("More text");
  });

  it("strips heading markers from excerpt", () => {
    const raw = `## Section Header\n\nBody text.`;
    const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
    expect(excerpt).not.toContain("##");
    expect(excerpt).toContain("Section Header");
  });

  it("strips bold and italic markers from excerpt", () => {
    const raw = `This is **bold** and _italic_ text.`;
    const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
    // Should not contain asterisk or underscore characters
    expect(excerpt).not.toMatch(/[*_]/);
    expect(excerpt).toContain("bold");
    expect(excerpt).toContain("italic");
  });

  it("falls back to filename when no vault manager", () => {
    // window.__MARKABLE_VAULT_MANAGER__ is undefined in this test env
    const { pathLabel } = extractPopoverContent("Body", "/some/path/note.md");
    expect(pathLabel).toBe("note.md");
  });

  it("truncates excerpt at 200 words and adds ellipsis", () => {
    // Produce 250 distinct words so the 200-word cap is exercised
    const raw = Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ");
    const { excerpt } = extractPopoverContent(raw, "/vault/x.md");
    // Strip trailing ellipsis before counting words
    const wordCount = excerpt.replace(/\u2026$/, "").trim().split(/\s+/).length;
    expect(wordCount).toBe(200);
    expect(excerpt.endsWith("\u2026")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite: positionPopover
// ---------------------------------------------------------------------------

describe("positionPopover", () => {
  afterEach(() => {
    // Remove any popover divs created by makePopover
    document.body.innerHTML = "";
  });

  it("positions popover below span when span is in the viewport middle", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1200,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    const span = makeSpan({ left: 400, right: 500, top: 300, bottom: 320 });
    const popover = makePopover();

    positionPopover(span, popover);

    const top = parseFloat(popover.style.top);
    const left = parseFloat(popover.style.left);
    // Popover should appear below the span bottom (320) plus the 8px gap
    expect(top).toBeGreaterThanOrEqual(320 + 8);
    // Left-aligned with the span
    expect(left).toBe(400);
  });

  it("clamps popover left so it does not overflow right viewport edge", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    // Span at the far right edge; 320px popover would overflow
    const span = makeSpan({ left: 900, right: 950, top: 300, bottom: 320 });
    const popover = makePopover();

    positionPopover(span, popover);

    const left = parseFloat(popover.style.left);
    // left + 320 must not exceed viewport width minus 16px margin = 984
    expect(left + 320).toBeLessThanOrEqual(984);
  });

  it("flips popover above span when span is near the bottom of the viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 1200,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 600,
      configurable: true,
    });
    // Span near the bottom; bottom at 570, leaving only 30px below
    const span = makeSpan({ left: 400, right: 500, top: 550, bottom: 570 });
    const popover = makePopover();

    positionPopover(span, popover);

    const top = parseFloat(popover.style.top);
    // Popover must be positioned above the span (top < span.top)
    expect(top).toBeLessThan(550);
  });
});

// ---------------------------------------------------------------------------
// Suite: computeWikiLinkDecorationRanges — data-wiki-target attribute
// ---------------------------------------------------------------------------

describe("computeWikiLinkDecorationRanges — target field", () => {
  it("mark range for simple [[note]] has target === 'note'", () => {
    const ranges = computeWikiLinkDecorationRanges(
      "See [[note]] here",
      new Set<number>(),
      [{ from: 0, to: 17 }]
    );
    const markRange = ranges.find((r) => r.type === "mark");
    expect(markRange).toBeDefined();
    expect(markRange!.target).toBe("note");
  });

  it("mark range for [[target|display]] has target === 'target'", () => {
    const ranges = computeWikiLinkDecorationRanges(
      "[[target|display text]]",
      new Set<number>(),
      [{ from: 0, to: 23 }]
    );
    const markRange = ranges.find((r) => r.type === "mark");
    expect(markRange).toBeDefined();
    expect(markRange!.target).toBe("target");
  });

  it("mark range for [[a|b|c]] has target === 'a' (EC-11)", () => {
    const ranges = computeWikiLinkDecorationRanges(
      "[[a|b|c]]",
      new Set<number>(),
      [{ from: 0, to: 9 }]
    );
    const markRange = ranges.find((r) => r.type === "mark");
    expect(markRange).toBeDefined();
    expect(markRange!.target).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Suite: CSS Injection
// ---------------------------------------------------------------------------

describe("injectWikiPopoverStyles / removeWikiPopoverStyles", () => {
  beforeEach(() => {
    // Start each test with a clean slate
    removeWikiPopoverStyles();
  });

  afterEach(() => {
    removeWikiPopoverStyles();
  });

  it("injectWikiPopoverStyles inserts exactly one style tag (idempotent)", () => {
    removeWikiPopoverStyles(); // clean slate
    injectWikiPopoverStyles();
    injectWikiPopoverStyles(); // second call must be a no-op
    const tags = document.querySelectorAll("[data-markable-wiki-popover-styles]");
    expect(tags).toHaveLength(1);
  });

  it("removeWikiPopoverStyles removes the injected style tag", () => {
    injectWikiPopoverStyles();
    removeWikiPopoverStyles();
    const tags = document.querySelectorAll("[data-markable-wiki-popover-styles]");
    expect(tags).toHaveLength(0);
  });

  it("removeWikiPopoverStyles is safe to call when no tag exists", () => {
    removeWikiPopoverStyles(); // ensure absent
    expect(() => removeWikiPopoverStyles()).not.toThrow();
  });

  it("injected CSS contains z-index: 10000", () => {
    injectWikiPopoverStyles();
    const tag = document.querySelector(
      "[data-markable-wiki-popover-styles]"
    ) as HTMLStyleElement;
    expect(tag.textContent).toContain("z-index: 10000");
  });

  it("injected CSS contains user-select: none", () => {
    injectWikiPopoverStyles();
    const tag = document.querySelector(
      "[data-markable-wiki-popover-styles]"
    ) as HTMLStyleElement;
    expect(tag.textContent).toContain("user-select: none");
  });

  it("injected CSS contains transform: translate(0, 4px) base offset", () => {
    /*
     * LOW-2 (WebKit fix): the CSS transition is now applied imperatively in
     * showWikiPopover rather than via the `.wl-popover-visible` class, so the
     * CSS constant itself no longer contains an `opacity 100ms` declaration.
     * What the CSS DOES provide is the base hidden state with the 4px offset.
     * Verify that the base transform is present.
     */
    injectWikiPopoverStyles();
    const tag = document.querySelector(
      "[data-markable-wiki-popover-styles]"
    ) as HTMLStyleElement;
    expect(tag.textContent).toContain("translate(0, 4px)");
  });
});

// ---------------------------------------------------------------------------
// Suite: Edge Cases (using _testing accessor extensions and showWikiPopover)
// ---------------------------------------------------------------------------

describe("hover popover — edge cases", () => {
  beforeEach(() => {
    // Reset _enabled to false after each test to avoid state leaking
    _testing.setEnabled(false);
    document.body.innerHTML = "";
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    _testing.setEnabled(false);
    document.body.innerHTML = "";
  });

  it("EC-07: shows nothing when __MARKABLE_CURRENT_FILE__ is null", async () => {
    _testing.setEnabled(true);
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__TAURI_INTERNALS__ = undefined;
    const span = document.createElement("span");
    document.body.appendChild(span);
    await showWikiPopover(span, "some-target");
    expect(_testing.getActivePopoverEl()).toBeNull();
  });

  it("EC-01: shows nothing when invokeReadFile returns ok: false", async () => {
    _testing.setEnabled(true);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(new Error("File not found")),
    };
    const span = document.createElement("span");
    document.body.appendChild(span);
    await showWikiPopover(span, "nonexistent");
    expect(_testing.getActivePopoverEl()).toBeNull();
  });

  it("EC-12: empty target string does not crash", async () => {
    _testing.setEnabled(true);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockRejectedValue(new Error("invalid path")),
    };
    const span = document.createElement("span");
    document.body.appendChild(span);
    // Must not throw; result is undefined (Promise resolves to void)
    await expect(showWikiPopover(span, "")).resolves.toBeUndefined();
    expect(_testing.getActivePopoverEl()).toBeNull();
  });

  it("dismissWikiPopover increments _hoverFetchVersion (race safety)", () => {
    const before = _testing.getHoverFetchVersion();
    dismissWikiPopover();
    const after = _testing.getHoverFetchVersion();
    expect(after).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// Suite: EC-08 grace-period dismissal (CRITICAL-1)
//
// Verifies that moving the mouse from a wiki-link span INTO the active popover
// cancels the 60 ms dismiss timer (grace period), keeping the popover alive.
// Also verifies that leaving the popover itself starts its own 60 ms timer and
// ultimately dismisses the popover when that timer fires.
// ---------------------------------------------------------------------------

describe("EC-08 grace-period dismissal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _testing.setEnabled(true);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    vi.useRealTimers();
    _testing.setEnabled(false);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
  });

  it(
    "EC-08a: mouseover on popover cancels dismiss timer and keeps popover alive",
    () => {
      /*
       * Scenario:
       *  1. A popover element is "active" (set via _testing.setActivePopoverEl).
       *  2. mouseleave on the wiki-link span starts the 60 ms dismiss timer.
       *  3. Before 60 ms elapse, mouseover fires on the popover element itself,
       *     cancelling the timer.
       *  4. After advancing fake timers past 60 ms the popover is still present.
       */

      // Create a fake popover element and register it as active.
      const popoverEl = document.createElement("div");
      popoverEl.setAttribute("data-markable-wiki-popover", "true");
      document.body.appendChild(popoverEl);
      _testing.setActivePopoverEl(popoverEl);

      // Create a fake wiki-link span.
      const span = document.createElement("span");
      span.setAttribute("data-wiki-target", "some-note");
      document.body.appendChild(span);

      // Build the handlers (these are the same closures onEnable would create).
      const hoverHandler = buildHoverHandler();
      const dismissHandler = buildDismissHandler();

      // Step 1: mouseleave on the span → starts the 60 ms dismiss timer.
      const leaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(leaveEvent, "target", { value: span, writable: false });
      dismissHandler(leaveEvent as any);

      // Step 2: before the timer fires, mouseover fires on the popover.
      const overEvent = new MouseEvent("mouseover", { bubbles: true });
      Object.defineProperty(overEvent, "target", { value: popoverEl, writable: false });
      hoverHandler(overEvent);

      // Step 3: advance timers well past 60 ms.
      vi.advanceTimersByTime(200);

      // The popover must still be registered as active (dismiss was cancelled).
      expect(_testing.getActivePopoverEl()).not.toBeNull();
    }
  );

  it(
    "EC-08b: mouseleave on the popover starts the 60 ms dismiss timer which fires",
    () => {
      /*
       * Scenario:
       *  1. A popover element is "active".
       *  2. mouseleave on the popover starts the 60 ms dismiss timer.
       *  3. No mouseover on the popover → timer fires → dismissWikiPopover runs.
       *  4. _activePopoverEl is null after the timer fires.
       */

      // Create a fake popover element and register it as active.
      const popoverEl = document.createElement("div");
      popoverEl.setAttribute("data-markable-wiki-popover", "true");
      document.body.appendChild(popoverEl);
      _testing.setActivePopoverEl(popoverEl);

      const dismissHandler = buildDismissHandler();

      // mouseleave fires on the popover element.
      const leaveEvent = new MouseEvent("mouseleave", { bubbles: false });
      Object.defineProperty(leaveEvent, "target", { value: popoverEl, writable: false });
      dismissHandler(leaveEvent as any);

      // Advance past the 60 ms grace period — dismiss timer should fire.
      vi.advanceTimersByTime(200);

      // The popover should have been dismissed.
      expect(_testing.getActivePopoverEl()).toBeNull();
    }
  );
});

// ---------------------------------------------------------------------------
// Suite: EC-04 fetch-race discard path (CRITICAL-2)
//
// Verifies that when two overlapping showWikiPopover calls are made, the
// content from the FIRST (slower) fetch is discarded and only the SECOND
// (faster) fetch's content is rendered.
// ---------------------------------------------------------------------------

describe("EC-04 fetch-race discard — only second call's content renders", () => {
  beforeEach(() => {
    _testing.setEnabled(true);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
    (window as any).__MARKABLE_CURRENT_FILE__ = "/vault/current.md";
  });

  afterEach(() => {
    _testing.setEnabled(false);
    _testing.setActivePopoverEl(null);
    document.body.innerHTML = "";
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  it(
    "EC-04: second overlapping fetch wins; first fetch result is discarded",
    async () => {
      /*
       * Scenario:
       *  1. Call showWikiPopover(spanA, "noteA") — the invoke for noteA returns
       *     a deferred promise that we hold open.
       *  2. Call showWikiPopover(spanB, "noteB") — the invoke for noteB returns
       *     immediately with known content.
       *  3. Await the noteB call to let it fully render.
       *  4. Resolve the noteA deferred promise.
       *  5. Assert the rendered popover contains noteB's content, not noteA's.
       *     (noteA's result is stale because _hoverFetchVersion incremented when
       *     noteB's showWikiPopover ran, so the version guard discards noteA.)
       */

      // Deferred promise for the "slow" first fetch (noteA).
      let resolveNoteA!: (value: { ok: true; value: string }) => void;
      const noteAPromise = new Promise<{ ok: true; value: string }>(
        (resolve) => { resolveNoteA = resolve; }
      );

      // invoke mock: first call (noteA) is deferred; second call (noteB) resolves immediately.
      let invokeCallCount = 0;
      const invokeMock = vi.fn().mockImplementation(() => {
        invokeCallCount++;
        if (invokeCallCount === 1) {
          /*
           * Return a pending promise for noteA. We cast to the raw string return
           * that invokeReadFile expects from __TAURI_INTERNALS__.invoke. The
           * invokeReadFile wrapper wraps the result in { ok: true, value }.
           */
          return noteAPromise.then((r) => r.value);
        }
        // noteB resolves immediately with its content.
        return Promise.resolve("# Note B\n\nThis is note B content.");
      });

      (window as any).__TAURI_INTERNALS__ = { invoke: invokeMock };

      const spanA = document.createElement("span");
      spanA.setAttribute("data-wiki-target", "noteA");
      document.body.appendChild(spanA);

      const spanB = document.createElement("span");
      spanB.setAttribute("data-wiki-target", "noteB");
      document.body.appendChild(spanB);

      // Call 1: noteA (slow) — do not await; it hangs on the deferred promise.
      const callA = showWikiPopover(spanA, "noteA");

      // Call 2: noteB (fast) — await this one so it fully renders.
      await showWikiPopover(spanB, "noteB");

      // Now resolve noteA's deferred fetch — its result must be discarded.
      resolveNoteA({ ok: true, value: "# Note A\n\nThis is note A STALE content." });
      await callA;

      // The active popover must show noteB's content, not noteA's stale content.
      const activeEl = _testing.getActivePopoverEl();
      expect(activeEl).not.toBeNull();
      // The title element should contain "Note B" (from the H1 in noteB's content).
      expect(activeEl!.textContent).toContain("Note B");
      // Crucially, noteA's stale text must NOT appear.
      expect(activeEl!.textContent).not.toContain("STALE");
    }
  );
});
