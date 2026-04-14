---
title: "Step 03 — Format Toggle Engine"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 03 — Format Toggle Engine

**Prerequisite:** step_02 complete and passing.
**Produces:** `computeWrap`, `computeUnwrap`, `computeErase`, `resolveUrl`; tests covering all toggle and erase cases.

---

## Goal

Implement the pure functions that compute the document changes for applying and removing inline formats. These functions return plain data structures (no CM6, no DOM). The dispatch glue (step_07) will call these and then call `view.dispatch(...)`.

Also implement `resolveUrl`, which is async (clipboard access) but otherwise pure in its logic — fully mockable in tests.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Add: `WrapResult`, `UnwrapResult`, `EraseResult`, `computeWrap`, `computeUnwrap`, `computeErase`, `resolveUrl` |
| `tests/markdown-toolbar.test.ts` | Add: toggle engine test suite |

---

## Detailed Specification

### 1. Result types

```typescript
export interface WrapResult {
  insert: string;         // text to replace the selection with
  selFrom: number;        // new selection anchor, RELATIVE to the start of the selection range
  selTo: number;          // new selection head,   RELATIVE to the start of the selection range
}

export interface UnwrapResult {
  changeFrom: number;     // absolute doc offset where the replacement starts
  changeTo: number;       // absolute doc offset where the replacement ends
  insert: string;         // the inner text (markers removed)
  selFrom: number;        // absolute selection anchor after unwrap
  selTo: number;          // absolute selection head after unwrap
}

export interface EraseResult {
  insert: string;         // stripped text
  changed: boolean;       // false means no wrappers were present; caller should skip dispatch
}
```

### 2. computeWrap

```typescript
export function computeWrap(
  selectedText: string,
  fmt: FormatDef,
  url?: string
): WrapResult
```

Cases:

**Standard format (has `open`, not link/image):**
```
open  = fmt.open!
close = fmt.close ?? fmt.open!
insert = open + selectedText + close
selFrom = open.length
selTo   = open.length + selectedText.length
```

**Link (`fmt.isLink === true`):**
```
resolvedUrl = url ?? ""
insert  = "[" + selectedText + "](" + resolvedUrl + ")"
selFrom = 1                              // after "["
selTo   = 1 + selectedText.length       // before "]"
```

**Image (`fmt.isImage === true`):**
```
resolvedUrl = url ?? ""
insert  = "![" + selectedText + "](" + resolvedUrl + ")"
selFrom = 2                              // after "!["
selTo   = 2 + selectedText.length       // before "]"
```

**Note:** `computeWrap` does NOT call `resolveUrl`. The URL is passed in by the caller (step_07 calls `resolveUrl` first, then calls `computeWrap`). This keeps `computeWrap` synchronous and pure.

**EC-21 note:** Do NOT escape backticks in `selectedText`. The content is inserted verbatim. If the selection contains backticks and the format is `inlineCode`, the result is simply `` ` `` + selectedText + `` ` ``. This is intentional per EC-21.

### 3. computeUnwrap

```typescript
export function computeUnwrap(
  docText: string,
  from: number,
  to: number,
  fmt: FormatDef
): UnwrapResult | null
```

Returns `null` if the markers cannot be found (should not happen if `detectFormats` returned `true`, but defensive).

**Standard format algorithm:**
```
open  = fmt.open!
close = fmt.close ?? fmt.open!

// Search backward from `from` for the opening marker
leftContext  = docText.slice(Math.max(0, from - 128), from)
openIdx      = leftContext.lastIndexOf(open)
if openIdx === -1: return null
openAbsStart = Math.max(0, from - 128) + openIdx
openAbsEnd   = openAbsStart + open.length

// Search forward from `to` for the closing marker
rightContext = docText.slice(to, Math.min(docText.length, to + 128))
closeIdx     = rightContext.indexOf(close)
if closeIdx === -1: return null
closeAbsStart = to + closeIdx
closeAbsEnd   = closeAbsStart + close.length

// Inner text (what remains after stripping the markers)
innerText = docText.slice(openAbsEnd, closeAbsStart)

return {
  changeFrom: openAbsStart,
  changeTo:   closeAbsEnd,
  insert:     innerText,
  selFrom:    openAbsStart,
  selTo:      openAbsStart + innerText.length,
}
```

**Bold/italic ambiguity for unwrap:** When unwrapping italic (`*`), the `lastIndexOf("*")` search may land on a `**` bold marker. Guard: after finding `openIdx`, check that the character at `leftContext[openIdx - 1]` is not `*` and `leftContext[openIdx + 1]` is not `*`. If it is, decrement `openIdx` and retry (walk further left). A simpler approach: search for a lone `*` using the same regex from step_02 — find all lone-`*` positions in `leftContext`, take the last one.

**HTML underline (`fmt.isHtml === true`):**
- Regex: `/<u>([\s\S]*?)<\/u>/g` applied to a context window around `from..to`.
- Find the match that contains the selection.
- `changeFrom = match.index + ctxStart`, `changeTo = match.index + match[0].length + ctxStart`.
- `insert = match[1]` (the inner text captured by group 1).
- `selFrom = changeFrom`, `selTo = changeFrom + insert.length`.

**Link (`fmt.isLink === true`):**
- Regex: `/\[([^\]]*)\]\(([^)]*)\)/g` applied to context.
- Find the match that overlaps `from..to`.
- `insert = match[1]` (the visible text, without URL).
- `changeFrom/To` = full match bounds.
- `selFrom = changeFrom`, `selTo = changeFrom + insert.length`.

**Image (`fmt.isImage === true`):**
- Regex: `/!\[([^\]]*)\]\(([^)]*)\)/g` applied to context.
- Same logic as link. `insert = match[1]`.

### 4. computeErase

```typescript
export function computeErase(
  docText: string,
  from: number,
  to: number
): EraseResult
```

**Algorithm:**

```
original = docText.slice(from, to)
text     = original

loop:
  prev = text
  text = text.replace(/\*\*([\s\S]*?)\*\*/g, "$1")     // bold
  text = text.replace(/(?<!\*)\*([\s\S]*?)(?<!\*)\*/g, "$1")  // italic (lone *)
  text = text.replace(/<u>([\s\S]*?)<\/u>/g, "$1")     // underline
  text = text.replace(/~~([\s\S]*?)~~/g, "$1")          // strikethrough
  text = text.replace(/==([\s\S]*?)==/g, "$1")          // highlight
  text = text.replace(/`([\s\S]*?)`/g, "$1")            // inline code
  text = text.replace(/\^([\s\S]*?)\^/g, "$1")          // superscript
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // link → text
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")  // image → alt
  if text === prev: break

return { insert: text, changed: text !== original }
```

The loop handles nested formats (EC-12). In practice, one or two iterations are sufficient.

**EC-11:** If the selection has no recognised wrappers, `text === original`, `changed = false`. The caller (step_07) checks `changed` and skips `view.dispatch` entirely — no document modification, no undo entry created.

**EC-13:** Link `[text](https://url)` is stripped to `text` by the link regex. Image `![alt](url)` is stripped to `alt`.

### 5. resolveUrl

```typescript
export async function resolveUrl(): Promise<string | null>
```

```
1. try:
     clipText = await navigator.clipboard.readText()
     if isUrlLike(clipText.trim()): return clipText.trim()
   catch:
     // clipboard read denied or unavailable — fall through to prompt

2. result = window.prompt("Enter URL:")
   if result === null: return null          // user cancelled (EC-9)
   return result
```

This function is async. It is called by the button click handler in step_07 (not by `computeWrap` which is synchronous). Test it by mocking `navigator.clipboard` and `window.prompt`.

---

## Acceptance Criteria

### AC-3.1: computeWrap — bold
`computeWrap("hello", FORMATS.find(f => f.id === "bold")!)` returns:
```
{ insert: "**hello**", selFrom: 2, selTo: 7 }
```

### AC-3.2: computeWrap — italic
`computeWrap("world", italic_fmt)` returns `{ insert: "*world*", selFrom: 1, selTo: 6 }`.

### AC-3.3: computeWrap — inline code (EC-21)
`computeWrap("a`b`c", inlineCode_fmt)` returns `{ insert: "\`a\`b\`c\`", selFrom: 1, selTo: 6 }`.
Backticks inside the selection are NOT escaped.

### AC-3.4: computeWrap — link
`computeWrap("click here", link_fmt, "https://example.com")` returns:
```
{ insert: "[click here](https://example.com)", selFrom: 1, selTo: 11 }
```

### AC-3.5: computeWrap — image
`computeWrap("photo", image_fmt, "https://img.com/x.png")` returns:
```
{ insert: "![photo](https://img.com/x.png)", selFrom: 2, selTo: 7 }
```

### AC-3.6: computeUnwrap — bold (EC-5)
```
doc = "**hello**"
result = computeUnwrap(doc, 2, 7, bold_fmt)
result !== null
result.changeFrom === 0
result.changeTo   === 9
result.insert     === "hello"
result.selFrom    === 0
result.selTo      === 5
```

### AC-3.7: computeUnwrap — link
```
doc = "[click here](https://example.com)"
result = computeUnwrap(doc, 1, 11, link_fmt)
result.insert     === "click here"
result.changeFrom === 0
result.changeTo   === doc.length
```

### AC-3.8: computeUnwrap — image
```
doc = "![photo](https://img.com/x.png)"
result = computeUnwrap(doc, 2, 7, image_fmt)
result.insert === "photo"
```

### AC-3.9: computeUnwrap returns null when markers not found
`computeUnwrap("hello", 1, 4, bold_fmt)` returns `null`.

### AC-3.10: computeErase — mixed formats (EC-12)
```
computeErase("**bold** and *italic*", 0, 21)
→ { insert: "bold and italic", changed: true }
```

### AC-3.11: computeErase — link (EC-13)
```
computeErase("[text](https://url)", 0, 19)
→ { insert: "text", changed: true }
```

### AC-3.12: computeErase — image
```
computeErase("![alt](https://img.com/x.png)", 0, 30)
→ { insert: "alt", changed: true }
```

### AC-3.13: computeErase — no wrappers (EC-11)
```
computeErase("plain text", 0, 10)
→ { insert: "plain text", changed: false }
```

### AC-3.14: computeErase — nested formats
```
computeErase("**~~nested~~**", 0, 14)
→ { insert: "nested", changed: true }
```

### AC-3.15: resolveUrl — clipboard contains URL (EC-7)
Mock `navigator.clipboard.readText` to return `"https://example.com"`.
`await resolveUrl()` returns `"https://example.com"` without calling `window.prompt`.

### AC-3.16: resolveUrl — clipboard contains non-URL text (EC-8)
Mock `navigator.clipboard.readText` to return `"some random text"`.
Mock `window.prompt` to return `"https://custom.com"`.
`await resolveUrl()` returns `"https://custom.com"`.

### AC-3.17: resolveUrl — user cancels prompt (EC-9)
Mock `navigator.clipboard.readText` to return `""`.
Mock `window.prompt` to return `null`.
`await resolveUrl()` returns `null`.

### AC-3.18: computeWrap is synchronous and pure
All calls return deterministic results. No side effects.

### AC-3.19: computeErase handles underline HTML tag
```
computeErase("<u>underlined</u>", 0, 17)
→ { insert: "underlined", changed: true }
```

---

## Notes for the Developer

**Italic/bold disambiguation in computeUnwrap** is the trickiest part of this step. When the selection is inside italic text, `computeUnwrap` must find a lone `*`, not part of `**`. Recommended: search `leftContext` for the rightmost single `*` that is not adjacent to another `*`. One reliable way is to collect all indices of `*` in `leftContext`, then filter out those where `leftContext[idx-1] === "*"` or `leftContext[idx+1] === "*"`, and take the last remaining index.

**computeUnwrap context window.** A search radius of 128 characters is used (doubled vs detection) because `computeUnwrap` needs to find the full markers at the boundary of the selection, not just confirm their presence.

**resolveUrl is not a pure function** (it calls DOM APIs). Mock both `navigator.clipboard` and `window.prompt` in tests using Vitest's `vi.stubGlobal` or direct property assignment on `global`.

**computeWrap receives `url` as an optional string parameter** — the caller is responsible for awaiting `resolveUrl()` and aborting if it returns `null`. `computeWrap` itself never calls `resolveUrl`.
