---
title: "Step 04 — Wire Checkboxes into Cards Layout"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 04 — Wire Checkboxes into Cards Layout

**Goal**: Add a checkbox to every card (files and directories). Checkboxes are
absolutely positioned in the top-left corner of the card. Each section gets a
master checkbox. Checkbox changes wire into `SelectionState` and `syncToolbar`
via the existing layout-agnostic helpers in `bulk-selection.ts`. Lazy-loaded
cards register into the same per-section arrays as immediately-rendered cards.

This is the critical lazy-load threading step (C-6). The
`IntersectionObserver` closure must capture per-section arrays by reference so
late-registering checkboxes participate in master-checkbox state calculations
correctly.

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/renderer.ts` | Add `CheckboxContext` type; modify `buildCard`, `appendCardsToGrid`, `buildSection`, and `renderFolderCards` |

---

## 1. New Local Type: `CheckboxContext`

This is a **module-internal** type (not exported, not added to `types.ts`).
It groups the per-section arrays and callbacks that `buildCard` needs to wire
the checkbox.

```typescript
/** Per-section bulk-selection wiring threaded through card builders. */
interface CheckboxContext {
  selectionState: import("./types").SelectionState;
  syncToolbar:    () => void;
  masterInput:    HTMLInputElement;
  rowCheckboxes:  HTMLInputElement[];
  sectionRows:    HTMLElement[];  // HTMLElement (cards, not <tr>)
  sectionPaths:   string[];
}
```

Note: `sectionRows` is typed as `HTMLElement[]` here (not `HTMLTableRowElement[]`)
because `buildMasterCheckboxTh` accepts `HTMLTableRowElement[]`. We need a
small adaptation — see section 3 below.

---

## 2. `buildMasterCheckboxTh` Compatibility

`buildMasterCheckboxTh` in `bulk-selection.ts` is typed to accept
`HTMLTableRowElement[]` for the `rows` parameter (for the `classList.toggle`
call). Cards are `HTMLDivElement` not `HTMLTableRowElement`.

**Solution**: Cast the card element array to `HTMLTableRowElement[]` at the
call site. TypeScript structural typing means the cast is safe because
`buildMasterCheckboxTh` only calls `.classList.toggle` on the rows — a method
present on all `HTMLElement` subclasses.

```typescript
const { th: _unused, masterInput } = buildMasterCheckboxTh(
  sectionLabel,
  sectionPaths,
  selectionState,
  syncToolbar,
  rowCheckboxes,
  sectionRows as unknown as HTMLTableRowElement[],  // safe: only classList.toggle is used
);
```

The `th` return value (a `<th>` element) is not used in the cards layout — we
only need `masterInput` for passing to `buildCheckboxTd`.

**Master checkbox DOM placement for cards**: Instead of a `<th>`, the cards
master checkbox is placed in the section heading area. Build a
`<div class="fv-master-checkbox-wrap">` containing the master `<input>` and
append it alongside the section heading `<h3>` (or in its place when the
section has no heading). See the DOM structure in section 4 below.

Because `buildMasterCheckboxTh` returns a `<th>` element that is not used in
the cards layout, the master checkbox `<input>` is wired manually in
`buildSection` using the returned `masterInput` reference without appending
the `<th>` to any DOM.

---

## 3. `buildCard` Modification

`buildCard` gains an optional third parameter:

```typescript
function buildCard(
  card: FolderCard,
  config: FolderViewConfig,
  checkboxCtx?: CheckboxContext,
): HTMLElement {
```

When `checkboxCtx` is provided:

1. Set `el.style.position = "relative"` (required for `position: absolute`
   child positioning of the checkbox).

2. Build the checkbox using `buildCheckboxTd` from `bulk-selection.ts`:

```typescript
if (checkboxCtx) {
  const { selectionState, syncToolbar, masterInput, rowCheckboxes,
          sectionRows, sectionPaths } = checkboxCtx;

  const checkboxTd = buildCheckboxTd(
    card,
    el as unknown as HTMLTableRowElement,  // safe: only classList.toggle is used
    selectionState,
    syncToolbar,
    masterInput,
    sectionPaths,
  );
  // Restyle the container for card positioning — the <td> is repurposed as a
  // positioned div overlay.
  checkboxTd.className = "fv-card-checkbox-wrap";
  el.appendChild(checkboxTd);

  // Register for master-checkbox sync.
  const inputInWrap = checkboxTd.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  rowCheckboxes.push(inputInWrap);
  sectionRows.push(el as unknown as HTMLTableRowElement);  // safe: classList.toggle only
}
```

Note: `buildCheckboxTd` returns a `<td>` element. We immediately override its
`className` to `"fv-card-checkbox-wrap"` — this is acceptable because the
`<td>` element is used as a generic `HTMLElement` container in this context;
it will be appended to a `<div>`, not a `<tr>`. The CSS for
`.fv-card-checkbox-wrap` (Step 06) applies `position: absolute` and the hover-
opacity transition.

**Stop-propagation**: `buildCheckboxTd` already calls `event.stopPropagation()`
on the `change` event and `event.stopPropagation()` on the cell click event
(bulk-selection.ts lines 110–128). No additional wiring is needed for C-5/EC-9.

---

## 4. `appendCardsToGrid` Modification

```typescript
function appendCardsToGrid(
  cards: FolderCard[],
  grid: HTMLElement,
  config: FolderViewConfig,
  scrollRoot: HTMLElement,
  checkboxCtx?: CheckboxContext,   // NEW
): void {
  if (cards.length <= LAZY_BATCH_SIZE) {
    for (const card of cards) grid.appendChild(buildCard(card, config, checkboxCtx));
    return;
  }

  for (const card of cards.slice(0, LAZY_BATCH_SIZE)) {
    grid.appendChild(buildCard(card, config, checkboxCtx));
  }

  let rendered = LAZY_BATCH_SIZE;
  const sentinel = document.createElement("div");
  sentinel.className = "fv-load-sentinel";
  grid.appendChild(sentinel);

  // CRITICAL (C-6): checkboxCtx is captured by reference in this closure.
  // checkboxCtx.rowCheckboxes and checkboxCtx.sectionPaths are arrays that
  // grow as new cards register. The closure captures the object reference,
  // not a copy, so lazily-added checkboxes are visible to the master checkbox
  // state calculation (updateMasterCheckboxState reads sectionPaths.length).
  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    const batch = cards.slice(rendered, rendered + LAZY_BATCH_SIZE);
    for (const card of batch) grid.insertBefore(buildCard(card, config, checkboxCtx), sentinel);
    rendered += batch.length;
    if (rendered >= cards.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }, { root: scrollRoot, rootMargin: "200px 0px" });

  observer.observe(sentinel);
}
```

The only changes are:
1. New `checkboxCtx?: CheckboxContext` parameter.
2. `buildCard` calls pass `checkboxCtx`.
3. The `IntersectionObserver` closure captures `checkboxCtx` by reference
   (TypeScript objects are always reference-captured; no special action needed).

---

## 5. `buildSection` Modification

```typescript
function buildSection(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
  scrollRoot: HTMLElement,
  checkboxCtx?: CheckboxContext,   // NEW
): HTMLElement {
  const section = document.createElement("div");
  section.className = "folder-view-section";

  if (title) {
    const heading = document.createElement("h3");
    heading.className = "folder-view-section-title";
    heading.textContent = title;
    section.appendChild(heading);
  }

  // NEW: master checkbox for this section (only when bulk context provided).
  if (checkboxCtx) {
    const masterWrap = document.createElement("div");
    masterWrap.className = "fv-card-master-checkbox-wrap";
    const masterLabel = document.createElement("label");
    masterLabel.className = "fv-card-master-label";
    const { masterInput } = checkboxCtx;
    masterInput.setAttribute(
      "aria-label",
      `Select all ${title ?? "items"}`,
    );
    masterLabel.appendChild(masterInput);
    const labelText = document.createElement("span");
    labelText.textContent = "Select all";
    labelText.className = "fv-card-master-label-text";
    masterLabel.appendChild(labelText);
    masterWrap.appendChild(masterLabel);
    section.appendChild(masterWrap);
  }

  const grid = document.createElement("div");
  grid.className = "folder-view-grid";
  grid.style.setProperty("--fv-card-width", config.cardWidth + "px");
  if (config.layoutMode === "flex") grid.classList.add("fv-flex-mode");
  grid.setAttribute("role", "list");

  appendCardsToGrid(cards, grid, config, scrollRoot, checkboxCtx);

  section.appendChild(grid);
  return section;
}
```

---

## 6. `renderFolderCards` Modification — Construct `CheckboxContext` Per Section

For each section (dirs, files), construct a `CheckboxContext` before calling
`buildSection`:

```typescript
// (after sorting dirCards and fileCards, before rendering sections)

// Helper to build per-section checkbox context when bulk context is provided.
const makeCheckboxCtx = (
  sectionCards: FolderCard[],
  sectionLabel: string,
): CheckboxContext | undefined => {
  if (!context) return undefined;

  const sectionPaths = sectionCards.map(c => c.path);
  const rowCheckboxes: HTMLInputElement[] = [];
  const sectionRows: HTMLTableRowElement[] = [];

  const { masterInput } = buildMasterCheckboxTh(
    sectionLabel,
    sectionPaths,
    context.selectionState,
    context.syncToolbar,
    rowCheckboxes,
    sectionRows,
  );

  return {
    selectionState: context.selectionState,
    syncToolbar:    context.syncToolbar,
    masterInput,
    rowCheckboxes,
    sectionRows,
    sectionPaths,
  };
};

// Import needed at top of renderer.ts:
// import { buildMasterCheckboxTh, buildCheckboxTd } from "./bulk-selection";

const dirLabel  = config.foldersTitle || "Folders";
const fileLabel = config.filesTitle   || "Files";

if (showDirs) {
  const checkboxCtx = makeCheckboxCtx(dirCards, dirLabel);
  host.appendChild(buildSection(config.foldersTitle || null, dirCards, config, host, checkboxCtx));
}

if (showFiles) {
  const checkboxCtx = makeCheckboxCtx(fileCards, fileLabel);
  host.appendChild(buildSection(config.filesTitle || null, fileCards, config, host, checkboxCtx));
}
```

**Why per-section context**: Each section has its own `sectionPaths`, master
checkbox, and row/input arrays. The master checkbox for Folders must not
affect the Files master checkbox. This matches the table renderer exactly.

**The `sectionPaths` array passed to `buildMasterCheckboxTh`** is `sectionCards.map(c => c.path)`.
Note that `updateMasterCheckboxState` in `bulk-selection.ts` reads
`sectionPaths.length` to determine "all selected". This is an array snapshot
at section-build time. For lazy-loaded cards, newly loaded cards **do not
automatically appear in `sectionPaths`** — the table renderer has the same
behavior (`sectionPaths` is assigned once at `buildSectionTable` entry).

This is consistent with the requirement (EC-5): the key requirement is that
`rowCheckboxes` and `sectionRows` arrays grow as lazy batches fire (so the
individual checkbox inputs are registered). The `sectionPaths` array is
intentionally a snapshot — `updateMasterCheckboxState` only uses it to
calculate "all selected" count, and the master checkbox indeterminate state is
recalculated after each individual check/uncheck via `updateMasterCheckboxState`.
The calculation uses `sectionPaths.filter(p => selectionState.paths.has(p))`
which naturally includes newly loaded paths as they enter `selectionState.paths`.

However, for lazy-loaded cards, the paths must also be in `sectionPaths` for
`updateMasterCheckboxState` to count them correctly. **Resolution**: when a
lazy batch fires, push the new card's path into `checkboxCtx.sectionPaths`
before calling `buildCard`. This is achieved inside `buildCard` itself: when
`checkboxCtx` is provided and a card's path is not yet in `sectionPaths`,
push it.

Revised approach in `buildCard`:

```typescript
if (checkboxCtx) {
  // Register path if not already present (lazy-load path).
  if (!checkboxCtx.sectionPaths.includes(card.path)) {
    checkboxCtx.sectionPaths.push(card.path);
  }
  // ... rest of checkbox construction
}
```

For the initial batch, all paths are already in `sectionPaths` (added by
`makeCheckboxCtx`). The `includes` check is O(N) but N is bounded by section
size and this runs at card-render time, not in a hot loop. This is acceptable.

---

## 7. Imports to Add in `renderer.ts`

```typescript
import { buildMasterCheckboxTh, buildCheckboxTd } from "./bulk-selection";
import type { BulkContext } from "./types";
```

---

## Tests to Write (TDD — write before implementing)

File: `tests/folder-view/renderer.test.ts` (extend existing file)

### Test group: `card checkboxes`

#### EC-9: `checkbox click does not trigger card navigation`

```
Given: a BulkContext with a fresh SelectionState
And:   a cards array with one .md file
When:  the checkbox input inside the card is clicked (change event fired)
Then:  the card's click handler is NOT called
       (verify by checking that openFileInTab was not called)
```

#### EC-10: `directory card gets a checkbox`

```
Given: a BulkContext
And:   a cards array with one directory card
When:  renderFolderCards is called
Then:  the directory card contains an input[type=checkbox]
```

#### EC-5: `lazy-loaded card checkboxes register into selectionState`

```
Given: a BulkContext with a fresh SelectionState
And:   a section with LAZY_BATCH_SIZE + 2 file cards
When:  renderFolderCards is called
And:   the IntersectionObserver fires (simulate by calling the
       IntersectionObserver callback directly — use vitest mock)
Then:  checking the lazy-loaded card's checkbox adds its path to
       selectionState.paths
       the master checkbox becomes indeterminate (not all selected)
```

#### EC-6: `previously checked card retains checked state after lazy load`

```
Given: a BulkContext
And:   a section with LAZY_BATCH_SIZE + 1 cards
When:  renderFolderCards is called
And:   the first card's checkbox is checked (change event)
And:   the IntersectionObserver fires (lazy batch loads)
Then:  the first card's checkbox is still checked
       selectionState.paths still contains the first card's path
       the newly loaded card's checkbox is unchecked
```

#### EC-11: `two independent render calls have isolated SelectionStates`

```
Given: two separate BulkContext instances with separate SelectionStates
And:   renderFolderCards called twice with the two contexts
When:  a checkbox is checked in the first render
Then:  the second render's selectionState.paths is empty
```

### Regression: all existing `renderer.test.ts` tests must pass

---

## Acceptance Criteria

- [ ] Each card element has `position: relative` set when bulk context is provided
- [ ] Each card contains a `.fv-card-checkbox-wrap > input[type=checkbox]`
- [ ] Both file and directory cards receive checkboxes (EC-10)
- [ ] Checkbox click stops propagation (EC-9)
- [ ] Master checkbox per section constructed via `buildMasterCheckboxTh`
- [ ] Lazy-loaded cards register their checkboxes into `rowCheckboxes` and
      their paths into `sectionPaths` (C-6, EC-5)
- [ ] Two independent renders have isolated `SelectionState` (EC-11)
- [ ] All tests in test group above pass
- [ ] All existing `renderer.test.ts` and other tests pass (`npm run test:run`)
