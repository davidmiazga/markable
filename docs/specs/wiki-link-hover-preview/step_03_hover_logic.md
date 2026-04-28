---
title: "Step 03 — Hover Logic: State, Content Extraction, Positioning, Show/Dismiss"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 03: Hover Logic

## Requirement Traceability

- FR-1 — Show delay (180 ms) and cancellation on early leave.
- FR-2 — File fetch pipeline with race safety.
- FR-3 — Content extraction: title priority chain, excerpt stripping, path label.
- FR-5 — Positioning: below by default, right-clamp, flip-above.
- FR-6 — Dismissal: grace period timer (60 ms), click-anywhere rule.
- EC-01 through EC-19 — see individual function notes below.

## Section Placement

Continue the `// Step 10: Wiki-Link Hover Popover` section started in step_02.
Add sub-section comments to keep the code organized:

```
// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Module-Level State
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Content Extraction
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Positioning
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Step 10: Wiki-Link Hover Popover — Show / Dismiss
// ---------------------------------------------------------------------------
```

---

## Part A: Module-Level State Variables

Place these after the `WIKI_POPOVER_CSS` constant and before any functions.
They are module-level (not exported). Follow the exact documentation style used
for `_linkIndex`, `_rebuildTimer`, etc.

```typescript
/** Document-level hover handler reference, stored for cleanup in onDisable. */
let _wikiLinkHoverHandler: ((e: MouseEvent) => void) | null = null;

/**
 * Document-level mouseleave/click handler for dismissal.
 * A single handler is registered for both mouseleave (on the popover)
 * and click (anywhere), stored here for cleanup.
 */
let _wikiLinkHoverLeaveHandler: ((e: MouseEvent) => void) | null = null;

/** Timer handle for the 180 ms show-delay (FR-1.1). */
let _hoverShowTimer: ReturnType<typeof setTimeout> | null = null;

/** Timer handle for the 60 ms grace-period dismiss timer (FR-6.1). */
let _hoverDismissTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Monotonically incrementing counter for fetch race safety (FR-2.4, EC-04).
 * Incremented before each fetch. On fetch completion, the captured value
 * is compared against the current counter; a mismatch means the fetch is stale.
 * Also incremented by dismissWikiPopover() so a dismissed popover's in-flight
 * fetch is always discarded.
 */
let _hoverFetchVersion = 0;

/** The currently visible popover element, or null when no popover is shown. */
let _activePopoverEl: HTMLElement | null = null;
```

---

## Part B: `extractPopoverContent`

This is a **pure function** (no DOM, no globals except string processing).
Export it so tests can call it directly.

### Signature

```typescript
export function extractPopoverContent(
  raw: string,
  resolvedPath: string
): { title: string; pathLabel: string; excerpt: string }
```

### Implementation Steps

**Step B.1 — Byte-slice to 2048 bytes (FR-2.5, EC-03).**

JavaScript strings are UTF-16; slicing by character index at 2048 is an
acceptable approximation for UTF-8 byte limiting (slightly conservative for
multi-byte chars, never over-reads). Use:

```typescript
const content = raw.length > 2048 ? raw.slice(0, 2048) : raw;
```

**Step B.2 — Extract title (FR-3.1), priority chain.**

Priority 1: YAML front matter `title:` field.

```typescript
let title: string | null = null;

// Check for YAML front matter (opening --- block)
if (content.startsWith("---")) {
  const endMarker = content.indexOf("\n---", 3);
  const dotMarker = content.indexOf("\n...", 3);
  const fmEnd = endMarker !== -1 && dotMarker !== -1
    ? Math.min(endMarker, dotMarker)
    : endMarker !== -1 ? endMarker : dotMarker;
  if (fmEnd !== -1) {
    const frontMatter = content.slice(3, fmEnd);
    const titleMatch = frontMatter.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) title = titleMatch[1].trim();
  }
}
```

Priority 2: First `# H1` heading (only if title not yet found).

```typescript
if (!title) {
  const h1Match = content.match(/^#\s+(.+)/m);
  if (h1Match) title = h1Match[1].replace(/[*_~`]/g, "").trim();
}
```

Priority 3: Filename stem (only if title not yet found).

```typescript
if (!title) {
  const filename = filenameFromPath(resolvedPath);
  title = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}
```

**Step B.3 — Compute vault-relative path label (FR-3.3).**

```typescript
let pathLabel: string;
const vaultRoot: string | undefined =
  (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVault?.()?.rootPaths?.[0];
if (vaultRoot && resolvedPath.startsWith(vaultRoot + "/")) {
  pathLabel = resolvedPath.slice(vaultRoot.length + 1);
} else {
  pathLabel = filenameFromPath(resolvedPath);
}
```

Note: `window` is not available in unit tests. The test for `pathLabel` must
mock `window.__MARKABLE_VAULT_MANAGER__` or accept that `pathLabel` falls
through to `filenameFromPath`. The `if (typeof window === "undefined")` guard
is NOT needed in an IIFE plugin context; however, for unit test compatibility,
use optional chaining (`?.`) throughout so the function does not throw when
`window.__MARKABLE_VAULT_MANAGER__` is undefined.

**Step B.4 — Strip front matter from body (FR-3.2).**

```typescript
let body = content;
if (content.startsWith("---")) {
  const endMarker = content.indexOf("\n---", 3);
  const dotMarker = content.indexOf("\n...", 3);
  const fmEnd = endMarker !== -1 && dotMarker !== -1
    ? Math.min(endMarker, dotMarker)
    : endMarker !== -1 ? endMarker : dotMarker;
  if (fmEnd !== -1) {
    body = content.slice(fmEnd + 4); // skip past "\n---"
  }
}
```

**Step B.5 — Strip fenced code blocks from body (FR-3.2).**

```typescript
// Remove fenced code blocks (``` or ~~~ fences)
body = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, "");
```

Note: The regex uses the backreference `\1` to match the same fence character.
`[\s\S]*?` is lazy so it stops at the first matching close fence.

**Step B.6 — Strip Markdown syntax characters (FR-3.2).**

```typescript
// Remove heading markers, bold/italic, link/image syntax, inline code
body = body
  .replace(/^#{1,6}\s+/gm, "")           // heading markers
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image alt text only
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")  // link text only
  .replace(/[*_~`]/g, "")                // bold/italic/strike/code chars
  .replace(/^[-*_]{3,}\s*$/gm, "")       // horizontal rules
  .replace(/\n{2,}/g, " ");              // collapse blank lines to space
```

**Step B.7 — Extract excerpt (first ~200 words, FR-3.2).**

```typescript
const words = body.trim().split(/\s+/).filter(Boolean);
let excerpt = "";
if (words.length > 0) {
  const truncated = words.length > 200;
  excerpt = words.slice(0, 200).join(" ");
  if (truncated) excerpt += "\u2026"; // ellipsis character
}
```

**Step B.8 — Handle empty excerpt (EC-18).**

```typescript
// excerpt remains "" if body was empty after all stripping
```

The caller (`showWikiPopover`) will set `excerptEl.textContent = excerpt` and
can check `if (!excerpt) excerptEl.style.display = "none"` but this is a
presentation concern handled in step_03 Part D, not in `extractPopoverContent`.
The function simply returns `excerpt: ""` for empty bodies.

### Return Value

```typescript
return { title, pathLabel, excerpt };
```

where `title` is always a non-empty string (guaranteed by priority 3 fallback),
`pathLabel` is always a non-empty string, and `excerpt` may be `""`.

---

## Part C: `positionPopover`

Not pure (reads `getBoundingClientRect` and `window` dimensions).
Export it for testability.

### Signature

```typescript
export function positionPopover(
  spanEl: HTMLElement,
  popoverEl: HTMLElement
): void
```

### Implementation

```typescript
export function positionPopover(spanEl: HTMLElement, popoverEl: HTMLElement): void {
  const rect = spanEl.getBoundingClientRect();
  const popoverWidth = 320;   // max-width from CSS
  const margin = 16;          // viewport edge margin (FR-5.2, FR-5.3)
  const gap = 8;              // gap between span and popover (FR-5.1)

  // Default: below the span, left-aligned with it
  let top = rect.bottom + gap;
  let left = rect.left;

  // Right-clamp (FR-5.2): if popover would overflow the right edge
  if (left + popoverWidth > window.innerWidth - margin) {
    left = window.innerWidth - popoverWidth - margin;
    if (left < margin) left = margin;
  }

  // Flip above (FR-5.3): measure popover height after positioning,
  // use max-height as a conservative estimate before the element has rendered.
  // We apply position first, then check if it fits.
  popoverEl.style.top = top + "px";
  popoverEl.style.left = left + "px";

  // After setting initial position, check if popover bottom exceeds viewport.
  // Use scrollHeight if available (element is in DOM but hidden), else max-height.
  const estimatedHeight = popoverEl.scrollHeight || 240;
  if (top + estimatedHeight > window.innerHeight - margin) {
    // Flip: show above the span instead
    top = rect.top - estimatedHeight - gap;
    if (top < margin) top = margin; // clamp to top of viewport
    popoverEl.style.top = top + "px";
  }

  popoverEl.style.left = left + "px";
}
```

### Implementation Note on Height Estimation

The popover is appended to the DOM in `showWikiPopover` BEFORE `positionPopover`
is called, but with `display: none` (the `wl-popover-visible` class is not yet
added). `scrollHeight` on a `display: none` element returns 0 in most browsers.
Use `offsetHeight` instead, which also returns 0. The only reliable option is to
set `visibility: hidden; display: block` temporarily, measure, then revert.

To keep the implementation simple, use the CSS `max-height` (240px) as the
conservative flip threshold:

```typescript
const estimatedHeight = 240; // CSS max-height
if (top + estimatedHeight > window.innerHeight - margin) {
  top = rect.top - estimatedHeight - gap;
  if (top < margin) top = margin;
  popoverEl.style.top = top + "px";
}
```

This is the recommended approach. The popover will never be taller than 240px,
so this conservative estimate never causes a false flip for a short popover.

---

## Part D: `showWikiPopover`

### Signature

```typescript
async function showWikiPopover(
  spanEl: HTMLElement,
  target: string
): Promise<void>
```

This is NOT exported (it is an internal orchestration function called only by
the hover handler in step_04). Keep it unexported to minimize test surface for
this function — the individual steps are tested via `extractPopoverContent` and
`positionPopover`.

### Implementation

```typescript
async function showWikiPopover(spanEl: HTMLElement, target: string): Promise<void> {
  // Guard: must be enabled (async callback safety)
  if (!_enabled) return;

  // EC-07: untitled document has no file path
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return;

  // Race safety: increment version and capture local copy (FR-2.4, EC-04)
  _hoverFetchVersion++;
  const myVersion = _hoverFetchVersion;

  // Resolve path
  const resolvedPath = resolveWikiLinkPath(currentFile, target);

  // Fetch file content
  const result = await invokeReadFile(resolvedPath);

  // Discard stale results (EC-04, EC-15)
  if (myVersion !== _hoverFetchVersion) return;

  // Must still be enabled after await
  if (!_enabled) return;

  // EC-01: file not found
  if (!result.ok) {
    console.debug("[backlinks] hover-popover: file not found:", resolvedPath);
    return;
  }

  // Extract content
  const { title, pathLabel, excerpt } = extractPopoverContent(result.value, resolvedPath);

  // Dismiss any previously visible popover (FR-4.4)
  dismissWikiPopover();

  // Build popover DOM (FR-4.2, FR-4.3)
  const popoverEl = document.createElement("div");
  popoverEl.setAttribute("data-markable-wiki-popover", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "wl-popover-title";
  titleEl.textContent = title;

  const pathEl = document.createElement("div");
  pathEl.className = "wl-popover-path";
  pathEl.textContent = pathLabel;

  const excerptEl = document.createElement("div");
  excerptEl.className = "wl-popover-excerpt";
  excerptEl.textContent = excerpt;
  if (!excerpt) excerptEl.style.display = "none"; // EC-18

  popoverEl.appendChild(titleEl);
  popoverEl.appendChild(pathEl);
  popoverEl.appendChild(excerptEl);
  document.body.appendChild(popoverEl);
  _activePopoverEl = popoverEl;

  // Position before making visible (FR-5)
  positionPopover(spanEl, popoverEl);

  // Make visible with CSS transition (FR-9.4)
  // Force reflow so the browser registers the initial opacity:0 state
  void popoverEl.offsetHeight;
  popoverEl.classList.add("wl-popover-visible");
}
```

---

## Part E: `dismissWikiPopover`

### Signature

```typescript
export function dismissWikiPopover(): void
```

Export for testability and for cleanup calls in `onDisable`.

### Implementation

```typescript
export function dismissWikiPopover(): void {
  // Cancel pending timers
  if (_hoverShowTimer !== null) {
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = null;
  }
  if (_hoverDismissTimer !== null) {
    clearTimeout(_hoverDismissTimer);
    _hoverDismissTimer = null;
  }

  // Increment version so any in-flight fetch result is discarded (FR-2.4)
  _hoverFetchVersion++;

  // Remove popover from DOM
  if (_activePopoverEl) {
    _activePopoverEl.remove();
    _activePopoverEl = null;
  }
}
```

---

## State Machine Summary

```
IDLE
  |
  | mouseover on [data-wiki-target] span
  v
WAITING (180 ms show timer running)
  |         |
  | timer   | mouseleave from span (before timer fires)
  | fires   +---> cancel timer → IDLE
  v
FETCHING (async invokeReadFile in flight)
  |         |
  | result  | dismissWikiPopover() called
  | arrives +---> _hoverFetchVersion mismatch → discard → IDLE
  v
VISIBLE (popover in DOM, mouseenter/leave handlers active)
  |
  | mouseleave from span → start 60 ms dismiss timer
  |   |
  |   | mouseenter on popover (within 60 ms) → cancel dismiss timer → stay VISIBLE
  |   | 60 ms elapses without mouseenter on popover → dismissWikiPopover() → IDLE
  |
  | mouseleave from popover → start 60 ms dismiss timer
  |   |
  |   | (no re-entry possible from popover back to span that would cancel)
  |   | 60 ms elapses → dismissWikiPopover() → IDLE
  |
  | click anywhere → dismissWikiPopover() → IDLE
```

---

## Acceptance Criteria

1. `extractPopoverContent` with a normal file returns `title` from front matter `title:` field when present.
2. `extractPopoverContent` falls through to H1 when no front matter title.
3. `extractPopoverContent` falls through to filename stem when no front matter and no H1.
4. `extractPopoverContent` with a file > 2048 chars: excerpt does not include chars from beyond the 2048 slice.
5. `extractPopoverContent` with front-matter-only file (no body): `excerpt` is `""`.
6. `extractPopoverContent` with an empty file: `title` is the filename stem (from `resolvedPath`), `excerpt` is `""`.
7. `extractPopoverContent` correctly strips fenced code blocks, heading markers, bold/italic chars, and link syntax from excerpt.
8. `positionPopover` with span near right edge: `popoverEl.style.left` is clamped so popover does not overflow viewport right edge.
9. `positionPopover` with span near bottom edge: `popoverEl.style.top` is set to above the span.
10. `positionPopover` with span in the middle of the viewport: popover is positioned below the span.
11. `dismissWikiPopover` removes `_activePopoverEl` from the DOM.
12. `dismissWikiPopover` increments `_hoverFetchVersion`.
13. `dismissWikiPopover` cancels `_hoverShowTimer` and `_hoverDismissTimer`.
14. `dismissWikiPopover` called when `_activePopoverEl` is null does not throw.
15. Race condition: two calls to `showWikiPopover` in quick succession — only the second result renders a popover (first is discarded).

## Implementation Notes

- `extractPopoverContent` must NOT call `resolveWikiLinkPath` or `invokeReadFile`. It receives already-resolved content and path as arguments.
- The YAML front matter end detection must handle both `\n---` and `\n...` as closing markers. The regex scan of only the leading content block (between `---` and the first closing marker) is sufficient.
- The front matter `title:` regex must handle optional quotes: `title: My Note`, `title: "My Note"`, `title: 'My Note'` are all valid.
- The excerpt word-count approach (split on whitespace) is intentionally approximate per FR-3.2.
- `positionPopover` reads `window.innerWidth` and `window.innerHeight` directly. Tests must mock these (or use jsdom defaults).
- Do not use `requestAnimationFrame` for the reflow trick. `void popoverEl.offsetHeight` is synchronous and sufficient.
