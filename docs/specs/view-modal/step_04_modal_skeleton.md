---
title: "step_04 — Modal skeleton + SVG illustrations"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_04 — Modal skeleton + SVG illustrations

## Goal

Build the Unified View Modal's DOM skeleton matching the mockup:
preview area on top (60–65% of vertical space), tab strip below the
preview, single config row (Path / Filter / Sort on the left; toggles
+ Content Width on the right), and Cancel / Action buttons in the
footer. Mount uses default state per FR-2 / FR-6. No wire-up to
triggers yet (step_05 does that). Six static SVG illustrations live
in a new co-located module (AD-9).

## Files touched

- **EDIT** `src/lib/codeblock-modal.ts` — add the new `openViewModal(mode, ctx)`
  export and its DOM builder. Old `openCodeBlockModal()` stays in place
  for backward compatibility until step_09.
- **NEW** `src/lib/view-modal-illustrations.ts` — six static SVG
  constants (AD-9).
- **NEW** `tests/view-modal/modal-mount.test.ts` — mount/unmount and
  default-state tests.
- **NEW** `tests/view-modal/tab-switch.test.ts` — tab switch
  preserves config state.
- **NEW** `tests/view-modal/config-row.test.ts` — Path / Filter / Sort
  / toggles / Content Width emit the right codefence keys.
- **NEW** `tests/view-modal/css.test.ts` — theme-token usage; no
  hardcoded hex.

## Function signatures

```typescript
// src/lib/codeblock-modal.ts (additions)

export type ViewModalMode = "create" | "insert" | "edit";

export interface ViewModalContext {
  /** Vault-relative folder path the modal targets, when in create/edit mode. */
  folderPath?: string;
  /** EditorView + selection range, when in insert mode. */
  editor?: { view: EditorView; from: number; to: number };
  /** Prefilled config when in edit mode (existing _folder.md or codefence). */
  initial?: SelectBuilderInitial;
  /** Tag and extension suggestions for the filter rows. */
  ruleRowContext?: RuleRowContext;
}

export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void;
```

Internal state, scoped to a single open:

```typescript
interface ViewModalState {
  mode: ViewModalMode;
  ctx: ViewModalContext;
  // Mirrors SelectFormState so step_05's submit can call
  // buildSelectFenceFromState() or writeFolderMdCodeblock() directly.
  form: SelectFormState;
  // Six-tab strip: which is active.
  activeTab: "cards" | "table" | "collection-home" | "timeline" | "kanban" | "bookshelf";
}
```

## Failing tests FIRST

Path: `tests/view-modal/modal-mount.test.ts`. Tests:

1. **"opens with default state in create mode (FR-2)"** — `openViewModal("create", { folderPath: "/v/Foo" })`. DOM contains tab strip with Cards active; Path field has value `"./"`; Filter status reads "Show all files"; Sort dropdown shows `"Name ↑"` selected; all three toggle inputs are checked; Content Width pill `"Normal"` is active.
2. **"opens with default state in insert mode (FR-6)"** — same defaults; button label is "Insert".
3. **"action button label reflects mode"** — Create / Insert / Save respectively.
4. **"title bar text reflects mode (Q-1)"** — "New Folder View" / "Insert Codeblock" / "Edit Folder View" / "Edit Codeblock".
5. **"Cancel discards changes (EC-11)"** — mount, edit Path to "Foo", click Cancel, modal closes, no spy-call on `writeFolderMdCodeblock` or `view.dispatch`.
6. **"Esc closes modal"** — modal-keyboard wiring via `attachModalKeyboard`.
7. **"⏎ triggers Action button"** — FR-42.
8. **"clicking outside the panel closes via backdrop"** — pre-existing behaviour.
9. **"two-column config row layout"** — DOM has left column with Path/Filter/Sort and right column with three toggles + Content Width.
10. **"preview area shows the SVG for the active tab"** — switching to Table swaps the SVG; assert via `innerHTML.includes` against the static constant.

Path: `tests/view-modal/tab-switch.test.ts`. Tests:

1. **"clicking each tab makes it active visually (FR-13)"** — clicking each of the six tabs flips the `is-active` class; only one tab is active at any time.
2. **"tab switch updates the preview illustration (FR-46)"** — `VIEW_MODAL_ILLUSTRATIONS[currentTab]` is what the preview area shows.
3. **"tab switch preserves Path value (EC-6)"** — set Path to "Projects/2026", switch Cards → Table → Cards, assert Path still reads "Projects/2026".
4. **"tab switch preserves filter rules (EC-6)"** — add two filter rules via `+ Add filter`, switch tabs, assert rules persist.
5. **"tab switch preserves Sort dropdown (EC-6)"** — set Sort to "Name ↓", switch tabs, assert Sort persists.
6. **"tab switch preserves toggle states (EC-6)"** — uncheck "Show modified date", switch tabs, assert it remains unchecked.
7. **"tab switch preserves Content Width selection (EC-6)"** — click "Wide", switch tabs, assert "Wide" still active.
8. **"tab switch is synchronous (EC-18 / NFR-6)"** — wrap the click in `performance.now()` brackets; assert <16ms. Vitest can spy via `vi.useFakeTimers()` to confirm no `setTimeout`/`requestAnimationFrame`/`await` is on the path.
9. **"tab switch updates the codefence `display:` slug that will be emitted"** — click Table tab, immediately submit, assert emitted fence contains `display: table`.
10. **"clicking the Collection tab and submitting writes `display: collection-home` (FR-80)"** — covered specifically because the slug includes a hyphen and prior bugs around this exist.

Path: `tests/view-modal/config-row.test.ts`. Tests:

1. **"Path field is editable; empty path emits `path: ./` (EC-4)"** — clear the input, submit, emitted fence has `path: ./` (or omits the key — the writer falls back to default if the line is absent; assert the renderer sees `./`).
2. **"Filter `+ Add filter` opens smart-filter-builder modal"** — click, assert `__smart-folder-editor-overlay__` mounts. (Existing modal; no edit.)
3. **"Filter rule with three rules emits three under `where:` (EC-5)"** — pre-set state to have three rules, submit, assert YAML body has three `- type:` items.
4. **"Sort dropdown contains exactly Name ↑ and Name ↓ (FR-25)"** — assert `<option>` count and labels.
5. **"Sort defaults to `name-asc`"** — FR-25.
6. **"Show modified date toggle defaults ON (FR-31)"** — FR-31 / EC-17.
7. **"Show file extensions toggle defaults ON (FR-31)"** — same.
8. **"Include preview pane toggle defaults ON (FR-31 / Q-2 override)"** — explicitly verifies the changed default (the legacy `mountSelectForm` default was `false`).
9. **"Content Width pills emit `content-width: wide|full` when non-default (FR-37)"** — clicking "Wide" then submit → emitted fence has `content-width: wide`. "Normal" omits the key.
10. **"Toggle OFF emits `show-modified: false`, `show-extensions: false`, `preview-pane: false`"** — FR-32; matches the existing `buildSelectFenceFromState` emit logic.

Path: `tests/view-modal/css.test.ts`. Tests:

1. **"the view modal source contains no hardcoded hex colors (EC-15)"** — grep the modal source + illustrations file for `/#[0-9a-fA-F]{3,8}\b/`. Allow the per-color comments in SVG strings only via a documented allowlist (preferable: zero hex in the new source files). NFR-5.
2. **"the modal reuses the existing modal-chrome class names"** — assert `cbm-overlay`, `cbm-panel`, `cbm-header`, `cbm-footer` classes appear in the new modal DOM. C-2 / NFR-5.

All tests fail initially: `openViewModal` does not exist.

EC mapping in this step: EC-4, EC-5, EC-6, EC-11, EC-12 (placeholder; full check lands in step_06), EC-15, EC-17, EC-18.

FR mapping: FR-2, FR-6, FR-10, FR-11, FR-12, FR-13, FR-14, FR-18, FR-25, FR-31, FR-32, FR-35, FR-36, FR-37, FR-40, FR-41, FR-42, FR-45, FR-46, FR-47.

## Implementation outline

The DOM structure is built top-down inside `openViewModal()`:

```typescript
export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void {
  if (isAnyModalOpen()) return;  // step_06 — for now this is a stub returning false
  if (document.getElementById(OVERLAY_ID)) return;
  injectStyles();

  // Initial state — apply Q-2 / FR-31 defaults for create/insert; use
  // ctx.initial for edit mode.
  const isPrefill = mode === "edit" && ctx.initial != null;
  const initial: SelectBuilderInitial = isPrefill ? ctx.initial : {
    path: "./",
    display: "cards",
    sort: "name-asc",
    showModified: true,
    showExtensions: true,
    previewPane: true,           // Q-2 / FR-31 default override
    contentWidth: "normal",
    rules: [],
  };

  // Build overlay + panel using existing cbm-* class names.
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "cbm-overlay";
  // ... backdrop, panel ...

  // Header
  const titleEl = document.createElement("div");
  titleEl.className = "cbm-title";
  titleEl.textContent = TITLE_BY_MODE[mode][folderOrInDoc(ctx)];
  // ... close button ...

  // Body
  const body = document.createElement("div");
  body.className = "cbm-body";

  // Preview area (60-65% of modal vertical space).
  const previewArea = document.createElement("div");
  previewArea.className = "view-modal-preview";  // new class — see CSS
  // ... applies VIEW_MODAL_ILLUSTRATIONS[activeTab] ...

  // Tab strip — six buttons, default Cards.
  const tabStrip = buildTabStrip(state, () => syncPreview());

  // Config row — two columns.
  const configRow = document.createElement("div");
  configRow.className = "view-modal-config-row";
  const leftCol = document.createElement("div");
  leftCol.className = "view-modal-col-left";
  const rightCol = document.createElement("div");
  rightCol.className = "view-modal-col-right";

  // Mount the select form to a HIDDEN host, then re-parent individual
  // sections into the two columns. This reuses mountSelectForm's
  // section composition + rule-row machinery WITHOUT changing
  // select-builder.ts.
  const hiddenHost = document.createElement("div");
  hiddenHost.style.display = "none";
  body.appendChild(hiddenHost);
  const { getState } = mountSelectForm(hiddenHost, { initial, ruleRowContext: ctx.ruleRowContext });

  // Re-parent: Path → leftCol, Filter → leftCol, Sort → leftCol,
  //            Toggles (show-modified, show-extensions, preview-pane) → rightCol,
  //            Content Width → rightCol.
  const sections = hiddenHost.querySelectorAll<HTMLElement>(".sb-section");
  for (const sec of Array.from(sections)) {
    const label = sec.querySelector(".sb-section-label")?.textContent;
    if (label === "Path" || label === "Filter") leftCol.appendChild(sec);
    else if (label === "Display") leftCol.appendChild(extractSortRowOnly(sec));
    else if (label === "Content width") rightCol.appendChild(sec);
  }
  // Toggle rows live inside the Display section's optsHost; lift them
  // out into rightCol.
  const toggleRows = hiddenHost.querySelectorAll<HTMLElement>(".sb-opt-row");
  for (const r of Array.from(toggleRows)) {
    if (r.textContent?.includes("Show modified date") ||
        r.textContent?.includes("Show file extensions") ||
        r.textContent?.includes("Preview pane")) {
      rightCol.appendChild(r);
    }
  }

  configRow.appendChild(leftCol);
  configRow.appendChild(rightCol);
  body.appendChild(tabStrip);
  body.appendChild(configRow);

  // Footer
  const footer = document.createElement("div");
  footer.className = "cbm-footer";
  // ... Cancel + Primary (Create/Insert/Save) buttons ...
  // Primary button handler is wired in step_05.
  primaryBtn.addEventListener("click", () => {
    // step_05: dispatch based on mode.
  });

  document.body.appendChild(overlay);
  attachModalKeyboard({ modal: overlay, onClose: close });
}
```

**Re-parenting approach rationale.** `mountSelectForm()` mounts six
sections vertically (Path, Filter, Display, Content width, plus
internal opts). The View Modal needs a two-column layout. Two
approaches were considered:

1. **Edit `select-builder.ts`** to expose a re-arrangeable section API.
2. **Re-parent DOM nodes after mount.**

(2) is chosen because (a) it touches one file (`codeblock-modal.ts`),
(b) the legacy `openSelectBuilderModal()` keeps working unchanged,
(c) the section labels in `.sb-section-label` are stable so the
re-parenting is robust, and (d) test 1 + test 9 in `modal-mount.test.ts`
pin the resulting DOM structure so drift in `select-builder.ts`
section composition is caught.

If `select-builder.ts` changes the section composition in a future
refactor and breaks the re-parenting, the modal test suite catches
it immediately.

**Preview-area dimensions.** CSS:

```css
.view-modal-preview {
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin: 0 0 14px 0;
  min-height: 280px;
  color: var(--text-secondary);
}
.view-modal-preview svg { max-width: 400px; max-height: 280px; }
```

All theme tokens (NFR-5).

### Six SVG illustrations (view-modal-illustrations.ts)

Each SVG uses `currentColor` for strokes/fills (theme-aware), is 400×280, and depicts the layout schematically.

```typescript
// src/lib/view-modal-illustrations.ts (NEW)

const CARDS_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="40"  y="80" width="100" height="120" rx="6" />
    <rect x="150" y="80" width="100" height="120" rx="6" />
    <rect x="260" y="80" width="100" height="120" rx="6" />
    <rect x="50"  y="90" width="80"  height="60"  rx="3" opacity="0.4" fill="currentColor" />
    <rect x="160" y="90" width="80"  height="60"  rx="3" opacity="0.4" fill="currentColor" />
    <rect x="270" y="90" width="80"  height="60"  rx="3" opacity="0.4" fill="currentColor" />
    <line x1="50"  y1="165" x2="120" y2="165" />
    <line x1="160" y1="165" x2="230" y2="165" />
    <line x1="270" y1="165" x2="340" y2="165" />
  </g>
</svg>`;

const TABLE_SVG = `<svg viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg">
  <g stroke="currentColor" stroke-width="1" fill="none">
    <rect x="30" y="50" width="340" height="180" rx="4" />
    <line x1="30" y1="80" x2="370" y2="80" stroke-width="1.5" />
    <line x1="150" y1="50" x2="150" y2="230" />
    <line x1="270" y1="50" x2="270" y2="230" />
    <line x1="30" y1="110" x2="370" y2="110" opacity="0.5" />
    <line x1="30" y1="140" x2="370" y2="140" opacity="0.5" />
    <line x1="30" y1="170" x2="370" y2="170" opacity="0.5" />
    <line x1="30" y1="200" x2="370" y2="200" opacity="0.5" />
  </g>
</svg>`;

// ... COLLECTION_SVG, TIMELINE_SVG, KANBAN_SVG, BOOKSHELF_SVG ...

export const VIEW_MODAL_ILLUSTRATIONS = {
  cards:            CARDS_SVG,
  table:            TABLE_SVG,
  "collection-home": COLLECTION_SVG,
  timeline:         TIMELINE_SVG,
  kanban:           KANBAN_SVG,
  bookshelf:        BOOKSHELF_SVG,
} as const;
```

The Lead Developer fills in the four remaining SVGs during step_04
implementation, matching the schematic descriptions in FR-46. Visual
fidelity is bounded by the test (`tabSwitchUpdatesIllustration` — any
non-empty SVG that differs across tabs satisfies the contract). The
Code Reviewer audits visual quality in the final review.

## Refactor opportunities

- The re-parenting helper logic could move into a small
  `view-modal-layout.ts` if `codeblock-modal.ts` grows past ~700 LOC.
  Phase 1 keeps it inline.
- The `previewPane: true` default override (Q-2) is documented inline.
  If a future caller of `mountSelectForm()` needs the new default, the
  override moves into `select-builder.ts`.

## Definition of Done

- All 10 tests in `tests/view-modal/modal-mount.test.ts` pass.
- All 10 tests in `tests/view-modal/tab-switch.test.ts` pass.
- All 10 tests in `tests/view-modal/config-row.test.ts` pass.
- All 2 tests in `tests/view-modal/css.test.ts` pass.
- `npm run test:run -- tests/view-modal/` is green.
- `npm run build` runs clean (no TypeScript errors).
- The new modal is not yet triggered by any production code path
  (step_05 wires the triggers); call it manually from a devtools
  REPL to verify visual fidelity.
- Window-defaults invariant test continues to pass.
