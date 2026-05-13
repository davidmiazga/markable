/**
 * table-renderer.ts — Compact sortable table renderer for the "folder-table" layout.
 *
 * Exports renderFolderTable(), the FolderLayoutRenderer for the "folder-table"
 * layout. Reuses all _folder.md infrastructure (parser, types, tab opening,
 * lazy loading pattern) and adds only a table-based view with interactive
 * column header sorting.
 *
 * Design decisions:
 *   AD-6: Plain DOM construction — no reactive library or template engine.
 *   FR-25: All colors use CSS custom properties — no hard-coded values.
 *   NFR-07: Rows use role="row", tabindex=0, aria-label, and keyboard handlers.
 *   EC-14: Description body passes through stripScripts() before innerHTML.
 *   EC-13: All user-supplied text is set via .textContent (never .innerHTML).
 *
 * @module folder-view/table-renderer
 */

import type { FolderViewConfig, FolderCard, FolderSortOrder, ExtraField } from "./types";
import { sortCards, getFileIconForCard, formatModified } from "./renderer";
import { ICON_FOLDER } from "../icons/material/index";
import { stripScripts, applyExcludeFilter, attachArrowNavigation } from "./shared";
import { buildPreviewPane, attachPaneResizeHandle } from "./preview-pane";
import type { PreviewPaneHandle } from "./preview-pane";
import { buildCheckboxTd, buildMasterCheckboxTh }
  from "./bulk-selection";
import type { SelectionState } from "./bulk-selection";

// ── Lazy loading ──────────────────────────────────────────────────────────────

const LAZY_BATCH_SIZE = 50;

// ── Row click handler ─────────────────────────────────────────────────────────

function handleRowClick(card: FolderCard): void {
  const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
  const fb = (window as any).__MARKABLE_FILE_BROWSER__;

  if (card.kind === "directory") {
    fb?.expandDirectory?.(card.path);
    if (card.hasFolderView) {
      const openFV = (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__;
      openFV?.(card.path);
    }
  } else {
    const lp = card.path.toLowerCase();
    if (lp.endsWith(".md") || lp.endsWith(".txt")) {
      void tabMgr?.openFileInTab?.(card.path);
    } else {
      void tabMgr?.openMediaInTab?.(card.path);
    }
  }
}

// ── Lazy row appender ─────────────────────────────────────────────────────────

/**
 * Append rows to a tbody, lazy-loading batches via IntersectionObserver when
 * the card count exceeds LAZY_BATCH_SIZE.
 *
 * Adapts the appendCardsToGrid pattern from renderer.ts for <tr> elements.
 *
 * @param cards      - All pre-sorted cards for this section.
 * @param tbody      - The <tbody> element to append into.
 * @param buildRow   - Factory: FolderCard → HTMLTableRowElement.
 * @param scrollRoot - Scrollable host element (IntersectionObserver root).
 */
function appendRowsToTbody(
  cards: FolderCard[],
  tbody: HTMLTableSectionElement,
  buildRow: (card: FolderCard) => HTMLTableRowElement,
  scrollRoot: HTMLElement,
): void {
  if (cards.length <= LAZY_BATCH_SIZE) {
    for (const card of cards) tbody.appendChild(buildRow(card));
    return;
  }

  for (const card of cards.slice(0, LAZY_BATCH_SIZE)) tbody.appendChild(buildRow(card));

  let rendered = LAZY_BATCH_SIZE;
  const sentinel = document.createElement("tr");
  sentinel.className = "fv-sentinel-row";
  tbody.appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    const batch = cards.slice(rendered, rendered + LAZY_BATCH_SIZE);
    for (const card of batch) tbody.insertBefore(buildRow(card), sentinel);
    rendered += batch.length;
    if (rendered >= cards.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }, { root: scrollRoot, rootMargin: "200px 0px" });

  observer.observe(sentinel);
}

// ── Fields-mode helpers ───────────────────────────────────────────────────────

/**
 * Return the ordered list of column identifiers to render for a section.
 *
 * Fields mode (config.fields !== null):
 *   - Files section: return config.fields with "count" filtered out (count is
 *     folders-only; no em-dash placeholder is rendered for it in files).
 *   - Folders section: return config.fields unchanged. The caller is responsible
 *     for rendering "name" and "count" cells normally; all other identifiers
 *     produce an em-dash placeholder cell (AD-3, FR-11).
 *
 * Legacy mode (config.fields === null):
 *   - Returns [] as a sentinel; buildSectionTable uses flag-based logic instead.
 *     The legacy code path is never entered when resolveFields returns a list.
 *
 * @param config  - The validated FolderViewConfig.
 * @param isFiles - true for Files section, false for Folders section.
 * @returns Ordered field identifier list (never null — returns [] in legacy mode).
 */
function resolveFields(config: FolderViewConfig, isFiles: boolean): string[] {
  if (config.fields === null) return [];
  // "select" controls checkbox visibility (BulkContext) — not a data column.
  const base = config.fields.filter(f => f !== "select");
  if (isFiles) {
    // count is folders-only; excluded from files section (AD-8, AC-05).
    return base.filter(f => f !== "count");
  }
  return base;
}

/**
 * Return the column header label for a field identifier.
 *
 * Built-in identifiers map to hardcoded English strings.
 * Custom identifiers look up config.extraFields first (for any explicit label
 * set by old extra-fields: syntax or derived from fields:), then fall back
 * to capitalising the key.
 *
 * @param field       - A field identifier string.
 * @param extraFields - The config.extraFields array (may be empty).
 * @returns The human-readable column header label.
 */
function fieldHeaderLabel(field: string, extraFields: ExtraField[]): string {
  switch (field) {
    case "name":       return "Name";
    case "type":
    case "ext":        return "Type";
    case "modified":   return "Modified";
    case "tags":       return "Tags";
    case "count":      return "Items";
    // Image built-in column labels (FR-6, step_06).
    case "width":      return "Width";
    case "height":     return "Height";
    case "date-taken": return "Date Taken";
    case "camera":     return "Camera";
    default: {
      // Look for an explicit label in extraFields (derived from fields: or extra-fields:).
      const ef = extraFields.find(e => e.key === field);
      if (ef) return ef.label;
      // Fallback: capitalise the key (FR-09 / AC-03).
      return field.charAt(0).toUpperCase() + field.slice(1);
    }
  }
}

// ── Row builders ──────────────────────────────────────────────────────────────

/**
 * Build a table row for a folder/directory card.
 *
 * When resolvedFields is null, uses legacy flag-based column rendering
 * (config.showCount only). When non-null, renders columns in the exact order
 * specified by resolvedFields, with em-dash placeholders for any field that is
 * not "name" or "count" (since folders have no modification date or tags to show).
 *
 * Length justification: two rendering branches (legacy vs fields mode) each iterate
 * a different column list with different cell-building logic. They share icon construction
 * but diverge in every subsequent step. Extracting sub-functions would require threading
 * resolvedFields, config, and card across an extra boundary with no clarity gain.
 *
 * @param card           - The directory FolderCard to render.
 * @param config         - FolderViewConfig (used in legacy mode for showCount flag).
 * @param resolvedFields - Ordered field list from resolveFields(), or null for legacy mode.
 */
function buildFolderRow(
  card: FolderCard,
  config: FolderViewConfig,
  resolvedFields: string[] | null,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "fv-row";
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", `Open folder ${card.name}`);

  // In fields mode with an explicit "icon" entry, the icon is positioned by the
  // fields list; otherwise it is always rendered first.
  if (resolvedFields === null || !resolvedFields.includes("icon")) {
    const iconTd = document.createElement("td");
    iconTd.className = "fv-td fv-td-icon";
    iconTd.innerHTML = ICON_FOLDER;
    tr.appendChild(iconTd);
  }

  if (resolvedFields === null) {
    // ── Legacy mode: flag-based columns ──────────────────────────────────
    const nameTd = document.createElement("td");
    nameTd.className = "fv-td fv-td-name";
    nameTd.textContent = card.name;
    nameTd.title = card.path;
    tr.appendChild(nameTd);

    if (config.showCount) {
      const countTd = document.createElement("td");
      countTd.className = "fv-td fv-td-count";
      countTd.textContent = String(card.childCount ?? 0);
      tr.appendChild(countTd);
    }
  } else {
    // ── Fields mode: iterate resolvedFields ───────────────────────────────
    for (const field of resolvedFields) {
      if (field === "icon") {
        const td = document.createElement("td");
        td.className = "fv-td fv-td-icon";
        td.innerHTML = ICON_FOLDER;
        tr.appendChild(td);
      } else if (field === "name") {
        const nameTd = document.createElement("td");
        nameTd.className = "fv-td fv-td-name";
        nameTd.textContent = card.name;
        nameTd.title = card.path;
        tr.appendChild(nameTd);
      } else if (field === "count") {
        const countTd = document.createElement("td");
        countTd.className = "fv-td fv-td-count";
        countTd.textContent = String(card.childCount ?? 0);
        tr.appendChild(countTd);
      } else {
        // Em-dash placeholder for any other field (modified, tags, custom keys).
        // Folders have no modification date, tags, or custom frontmatter to display.
        // The placeholder keeps column alignment between folder and file rows (AD-3).
        const placeholderTd = document.createElement("td");
        placeholderTd.className = "fv-td fv-td-placeholder";
        placeholderTd.textContent = "—"; // em-dash (U+2014), XSS-safe via textContent
        tr.appendChild(placeholderTd);
      }
    }
  }

  tr.addEventListener("click", () => handleRowClick(card));
  tr.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(card); }
  });

  return tr;
}

/**
 * Build a table row for a file card.
 *
 * When resolvedFields is null, uses legacy flag-based column rendering
 * (showExtensions, showModified, showTags, extraFields). When non-null, renders
 * columns in the exact order specified by resolvedFields (fields mode, AD-2).
 *
 * Length justification: two separate rendering branches (legacy vs fields mode)
 * each require iteration over different column lists with different cell-building
 * logic. The branches share icon cell construction and displayName computation
 * but differ in every subsequent step. Splitting into sub-functions would
 * require threading config, card, and the field list through an extra boundary
 * with no clarity gain over the clearly labelled in-line branches below.
 *
 * @param card           - The file FolderCard to render.
 * @param config         - FolderViewConfig (used in legacy mode for show* flags).
 * @param extraFields    - ExtraField list (used in legacy mode only).
 * @param resolvedFields - Ordered field list from resolveFields(), or null for legacy mode.
 */
function buildFileRow(
  card: FolderCard,
  config: FolderViewConfig,
  extraFields: ExtraField[],
  resolvedFields: string[] | null,
  onActivate?: (card: FolderCard, tr: HTMLTableRowElement) => void,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "fv-row";
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", `Open file ${card.name}`);

  // In fields mode with an explicit "icon" entry, the icon is positioned by the
  // fields list; otherwise it is always rendered first.
  if (resolvedFields === null || !resolvedFields.includes("icon")) {
    const iconTd = document.createElement("td");
    iconTd.className = "fv-td fv-td-icon";
    iconTd.innerHTML = getFileIconForCard(card.ext);
    tr.appendChild(iconTd);
  }

  // MD files store only the stem in card.name; add ext back when showing extensions.
  let displayName = card.name;
  if (config.showExtensions && card.ext === ".md") {
    displayName = card.name + card.ext;
  } else if (!config.showExtensions && card.ext && card.ext !== ".md" && card.name.endsWith(card.ext)) {
    displayName = card.name.slice(0, -card.ext.length);
  }

  if (resolvedFields === null) {
    // ── Legacy mode: flag-based columns ──────────────────────────────────
    const nameTd = document.createElement("td");
    nameTd.className = "fv-td fv-td-name";
    nameTd.textContent = displayName;
    nameTd.title = card.path;
    tr.appendChild(nameTd);

    if (config.showExtensions) {
      const extTd = document.createElement("td");
      extTd.className = "fv-td fv-td-ext";
      extTd.textContent = card.ext;
      tr.appendChild(extTd);
    }

    if (config.showModified) {
      const modTd = document.createElement("td");
      modTd.className = "fv-td fv-td-modified";
      modTd.textContent = card.modified > 0 ? formatModified(card.modified) : "—";
      tr.appendChild(modTd);
    }

    if (config.showTags) {
      const tagsTd = document.createElement("td");
      tagsTd.className = "fv-td fv-td-tags";
      if (card.tags && card.tags.length > 0) {
        for (const tag of card.tags) {
          const chip = document.createElement("span");
          chip.className = "folder-view-tag-chip";
          chip.textContent = tag;
          chip.title = tag;
          tagsTd.appendChild(chip);
        }
      }
      tr.appendChild(tagsTd);
    }

    // Extra-field cells (FR-11, FR-16). Values are inserted via .textContent to
    // prevent HTML injection (EC-11). Missing values display as an em-dash.
    for (const field of extraFields) {
      const td = document.createElement("td");
      td.className = "fv-td fv-td-extra";
      td.setAttribute("data-extra-key", field.key);
      const value = card.meta?.[field.key] ?? "";
      td.textContent = value === "" ? "—" : value;  // "—" = U+2014 em-dash
      tr.appendChild(td);
    }
  } else {
    // ── Fields mode: iterate resolvedFields ───────────────────────────────
    for (const field of resolvedFields) {
      if (field === "icon") {
        const td = document.createElement("td");
        td.className = "fv-td fv-td-icon";
        td.innerHTML = getFileIconForCard(card.ext);
        tr.appendChild(td);
      } else if (field === "name") {
        const nameTd = document.createElement("td");
        nameTd.className = "fv-td fv-td-name";
        nameTd.textContent = displayName;
        nameTd.title = card.path;
        tr.appendChild(nameTd);
      } else if (field === "type" || field === "ext") {
        const extTd = document.createElement("td");
        extTd.className = "fv-td fv-td-ext";
        extTd.textContent = card.ext;
        tr.appendChild(extTd);
      } else if (field === "modified") {
        const modTd = document.createElement("td");
        modTd.className = "fv-td fv-td-modified";
        modTd.textContent = card.modified > 0 ? formatModified(card.modified) : "—";
        tr.appendChild(modTd);
      } else if (field === "tags") {
        const tagsTd = document.createElement("td");
        tagsTd.className = "fv-td fv-td-tags";
        if (card.tags && card.tags.length > 0) {
          for (const tag of card.tags) {
            const chip = document.createElement("span");
            chip.className = "folder-view-tag-chip";
            chip.textContent = tag;
            chip.title = tag;
            tagsTd.appendChild(chip);
          }
        }
        tr.appendChild(tagsTd);
      } else {
        // Custom frontmatter field — value from card.meta, em-dash fallback.
        // XSS-safe: inserted via textContent (FR-18).
        const td = document.createElement("td");
        td.className = "fv-td fv-td-extra";
        td.setAttribute("data-extra-key", field);
        const value = card.meta?.[field] ?? "";
        td.textContent = value === "" ? "—" : value;
        tr.appendChild(td);
      }
    }
  }

  // When onActivate is provided (preview pane active):
  //   single click / Space → select + preview only
  //   Enter → open in tab (same as default)
  if (onActivate) {
    tr.addEventListener("click", () => onActivate(card, tr));
    tr.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); handleRowClick(card); }
      else if (e.key === " ") { e.preventDefault(); onActivate(card, tr); }
    });
  } else {
    tr.addEventListener("click", () => handleRowClick(card));
    tr.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(card); }
    });
  }

  return tr;
}

// ── Sort helpers ──────────────────────────────────────────────────────────────

function parseSortOrder(sort: FolderSortOrder): { col: "name" | "modified"; dir: "asc" | "desc" } {
  if (sort === "modified-asc")  return { col: "modified", dir: "asc" };
  if (sort === "modified-desc") return { col: "modified", dir: "desc" };
  if (sort === "name-desc")     return { col: "name",     dir: "desc" };
  return { col: "name", dir: "asc" };
}

// ── Section table builder ─────────────────────────────────────────────────────

/**
 * Build a section element (optional heading + sortable table).
 *
 * Manages interactive sort state in a closure: sortCol and sortDir initialise
 * from config.sort (folders are name-only; files support name and modified).
 * Clicking a header column toggles direction (same column) or resets to asc
 * (different column). rebuildTbody() clears and repopulates the tbody on sort.
 *
 * Supports two rendering modes:
 *   - Fields mode (config.fields !== null): columns are exactly those in
 *     resolvedFields in declaration order (AD-2, FR-05).
 *   - Legacy mode (config.fields === null): columns driven by show* flags —
 *     identical behaviour to the pre-fields implementation (NFR-04).
 *
 * Length justification: sort state, header construction (two full branches for
 * legacy vs fields mode), header event wiring (two full branches), conditional
 * columns, and tbody population are all tightly coupled through the shared
 * sortCol/sortDir mutable closure and the nameTh/extTh/modTh references.
 * Splitting into sub-functions would require threading 7+ variables across
 * boundaries with no clarity gain over the clearly labelled in-line branches.
 *
 * @param title          - Section heading text, or null to omit.
 * @param cards          - Pre-filtered cards for this section (unsorted copy is made internally).
 * @param config         - FolderViewConfig for column visibility flags.
 * @param host           - The .folder-view-host element (IntersectionObserver root).
 * @param isFiles        - true → file columns; false → folder columns.
 * @param selectionState - Shared mutable selection state, or undefined when checkboxes are off.
 * @param syncToolbar    - Closure that calls updateToolbar(toolbarRefs, selectionState).
 */
function buildSectionTable(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
  host: HTMLElement,
  isFiles: boolean,
  selectionState: SelectionState | undefined,
  syncToolbar: (() => void) | undefined,
  onActivate?: (card: FolderCard, tr: HTMLTableRowElement) => void,
): HTMLElement {
  const { col: initCol, dir: initDir } = parseSortOrder(config.sort);
  // Folders only sort by name; if config had a modified sort, default to asc-name.
  // sortCol is typed as string to accommodate extra-field keys alongside builtins.
  let sortCol: string = isFiles ? initCol : "name";
  let sortDir: "asc" | "desc" = isFiles ? initDir : (initCol === "name" ? initDir : "asc");

  // Determine fields mode: non-null resolvedFields means fields: was declared.
  const resolvedFields: string[] | null =
    config.fields !== null ? resolveFields(config, isFiles) : null;
  const isFieldsMode = resolvedFields !== null;

  const section = document.createElement("div");
  section.className = "folder-view-section";

  if (title) {
    const h3 = document.createElement("h3");
    h3.className = "folder-view-section-title";
    h3.textContent = title;
    section.appendChild(h3);
  }

  const table = document.createElement("table");
  table.className = "fv-table";

  // ── thead ─────────────────────────────────────────────────────────────────

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  // These are assigned during thead construction for sort wiring.
  // They remain null when the corresponding field is absent (fields mode with
  // name/ext/mod omitted from fields:). All callers guard with if (nameTh).
  let nameTh:  HTMLTableCellElement | null = null;
  let extTh:   HTMLTableCellElement | null = null;
  let modTh:   HTMLTableCellElement | null = null;
  // Array of all non-icon <th> elements — used by clearIndicators() (EC-14).
  const extraThs: HTMLTableCellElement[] = [];
  // fieldThPairs is populated in fields mode for sort-click wiring (AD-5).
  const fieldThPairs: { th: HTMLTableCellElement; field: string }[] = [];

  // ── Checkbox column (FR-1) ────────────────────────────────────────────────
  // Only rendered when selectionState is provided (i.e. "select" in fields:).
  let masterInput: HTMLInputElement | undefined;
  let rowCheckboxes: HTMLInputElement[] = [];
  let sectionRows: HTMLTableRowElement[] = [];
  let sectionPaths: string[] = [];

  if (selectionState) {
    sectionPaths = cards.map(c => c.path);
    const sectionLabel = isFiles
      ? (config.filesTitle || "Files")
      : (config.foldersTitle || "Folders");
    const built = buildMasterCheckboxTh(
      sectionLabel,
      sectionPaths,
      selectionState,
      syncToolbar!,
      rowCheckboxes,
      sectionRows,
    );
    masterInput = built.masterInput;
    // Appended before any other <th> so checkbox is always leftmost (FR-1).
    headerRow.appendChild(built.th);
  }

  if (!isFieldsMode) {
    // ── Legacy thead ───────────────────────────────────────────────────────
    // Icon column is always rendered first (NFR-06).
    const iconTh = document.createElement("th");
    iconTh.className = "fv-th fv-th-icon";
    headerRow.appendChild(iconTh);

    // Name column is always present in legacy mode.
    nameTh = document.createElement("th");
    nameTh.className = "fv-th fv-th-name";
    nameTh.textContent = "Name";
    if (sortCol === "name") nameTh.classList.add(`fv-sorted-${sortDir}`);
    headerRow.appendChild(nameTh);

    if (isFiles) {
      if (config.showExtensions) {
        extTh = document.createElement("th");
        extTh.className = "fv-th fv-th-ext";
        extTh.textContent = "Type";
        if (sortCol === "ext") extTh.classList.add(`fv-sorted-${sortDir}`);
        headerRow.appendChild(extTh);
      }
      if (config.showModified) {
        modTh = document.createElement("th");
        modTh.className = "fv-th fv-th-modified";
        modTh.textContent = "Modified";
        if (sortCol === "modified") modTh.classList.add(`fv-sorted-${sortDir}`);
        headerRow.appendChild(modTh);
      }
      if (config.showTags) {
        const tagsTh = document.createElement("th");
        tagsTh.className = "fv-th fv-th-tags";
        tagsTh.textContent = "Tags";
        headerRow.appendChild(tagsTh);
      }

      // Extra-field column headers (FR-11, FR-13). Built after Tags so extra
      // columns appear to the right of Tags (T-24, AD-05).
      for (const field of config.extraFields) {
        const extraTh = document.createElement("th");
        extraTh.className = "fv-th fv-th-extra";
        extraTh.textContent = field.label;
        // Pre-select this column when config.sort matches the field key (FR-11 AC-07).
        // parseSortOrder() falls back to "name-asc" for unknown sort values, so we
        // override sortCol here after the fact.
        if (config.sort === field.key) {
          extraTh.classList.add("fv-sorted-asc");
          sortCol = field.key;
          sortDir = "asc";
          // Remove the pre-selected indicator from the Name column to avoid dual indicators.
          nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
        }
        headerRow.appendChild(extraTh);
        extraThs.push(extraTh);
      }
    } else {
      if (config.showCount) {
        const countTh = document.createElement("th");
        countTh.className = "fv-th fv-th-count";
        countTh.textContent = "Items";
        headerRow.appendChild(countTh);
      }
    }
  } else {
    // ── Fields-mode thead ──────────────────────────────────────────────────
    // Render the implicit icon-th first only when "icon" is not in the fields
    // list; if it is, it will be positioned by the fields loop below.
    if (!resolvedFields.includes("icon")) {
      const iconTh = document.createElement("th");
      iconTh.className = "fv-th fv-th-icon";
      headerRow.appendChild(iconTh);
    }

    // Build one <th> per field in declaration order.
    for (const field of resolvedFields) {
      const th = document.createElement("th");
      const label = fieldHeaderLabel(field, config.extraFields);
      th.textContent = label; // textContent for XSS-safe header labels (FR-18)

      // Assign CSS class and capture reference for sort wiring.
      if (field === "icon") {
        th.className = "fv-th fv-th-icon";
        // Icon column is not sortable.
      } else if (field === "name") {
        th.className = "fv-th fv-th-name";
        nameTh = th;
        if (sortCol === "name") th.classList.add(`fv-sorted-${sortDir}`);
      } else if (field === "type" || field === "ext") {
        th.className = "fv-th fv-th-ext";
        extTh = th;
        if (sortCol === "ext") th.classList.add(`fv-sorted-${sortDir}`);
      } else if (field === "modified") {
        th.className = "fv-th fv-th-modified";
        modTh = th;
        if (sortCol === "modified") th.classList.add(`fv-sorted-${sortDir}`);
      } else if (field === "tags") {
        th.className = "fv-th fv-th-tags";
        // Tags column is not sortable (AD-5); no sort indicator or click handler.
      } else if (field === "count") {
        th.className = "fv-th fv-th-count";
        // Count column is not sortable (AD-5).
      } else {
        // Custom frontmatter field — sortable by meta value.
        th.className = "fv-th fv-th-extra";
        // Pre-select sort indicator when config.sort matches this custom field (FR-13).
        if (config.sort === field) {
          th.classList.add("fv-sorted-asc");
          sortCol = field;
          sortDir = "asc";
          // Clear name indicator to prevent dual pre-selection (AD-2 / EC-14 guard).
          if (nameTh) nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
        }
      }

      headerRow.appendChild(th);
      // Track all non-icon ths for clearIndicators (EC-14).
      extraThs.push(th);
      // Track field-th pairs for fields-mode sort-click wiring.
      fieldThPairs.push({ th, field });
    }
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // ── tbody + sort logic ────────────────────────────────────────────────────

  const tbody = document.createElement("tbody");
  tbody.className = "fv-tbody";

  const workingCards = [...cards];

  const applySort = (): void => {
    if (sortCol === "ext") {
      // Sort by file extension, tie-break by name.
      const dir = sortDir === "asc" ? 1 : -1;
      workingCards.sort((a, b) => {
        const cmp = dir * a.ext.localeCompare(b.ext);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
    } else if (sortCol === "name" || sortCol === "modified") {
      // Built-in sort via sortCards() helper.
      sortCards(workingCards, `${sortCol}-${sortDir}` as FolderSortOrder);
    } else {
      // Extra-field sort (FR-11, FR-12): localeCompare with empty-last ordering.
      // Empty string (absent key) always sorts after non-empty values in both
      // directions so that blank cells do not float to the top on desc click.
      const dir = sortDir === "asc" ? 1 : -1;
      workingCards.sort((a, b) => {
        const aVal = a.meta?.[sortCol] ?? "";
        const bVal = b.meta?.[sortCol] ?? "";
        // Tie-break: both empty → sort by name.
        if (aVal === "" && bVal === "") return a.name.localeCompare(b.name);
        // Empty always last, regardless of direction.
        if (aVal === "") return 1;
        if (bVal === "") return -1;
        const cmp = dir * aVal.localeCompare(bVal);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
    }
  };

  // Capture extraFields at call time so lazily-appended rows (EC-13) use the
  // same field list as the immediately-rendered rows.
  const extraFieldsForRow = isFiles ? config.extraFields : [];

  // WeakMap for reverse-lookup from row element → FolderCard (arrow-nav onFocus).
  const rowCardMap = new WeakMap<HTMLTableRowElement, FolderCard>();

  /**
   * Wraps the row builders to optionally prepend the checkbox cell and
   * register the row in rowCardMap for arrow-navigation lookups.
   */
  const buildRow = (card: FolderCard): HTMLTableRowElement => {
    const tr = isFiles
      ? buildFileRow(card, config, extraFieldsForRow, resolvedFields, onActivate)
      : buildFolderRow(card, config, resolvedFields);

    rowCardMap.set(tr, card);

    if (selectionState && masterInput) {
      // Build checkbox cell and prepend as leftmost cell in the row.
      const checkboxTd = buildCheckboxTd(
        card,
        tr,
        selectionState,
        syncToolbar!,
        masterInput,
        sectionPaths,
      );
      tr.insertBefore(checkboxTd, tr.firstChild);

      // Register for master-checkbox sync.
      const inputInTd = checkboxTd.querySelector<HTMLInputElement>("input[type=checkbox]")!;
      rowCheckboxes.push(inputInTd);
      sectionRows.push(tr);
    }

    return tr;
  };

  const clearIndicators = (): void => {
    // Guard: nameTh may be null in fields mode when "name" is not in fields:.
    if (nameTh) nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    if (extTh) extTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    if (modTh) modTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    // Clear indicators on all extra-field headers (EC-14 / AD-05).
    // In fields mode, extraThs holds ALL field headers (including builtin ones).
    for (const th of extraThs) th.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  };

  const rebuildTbody = (): void => {
    // FR-7, NFR-7: clear selection state before any re-render so ghost-selected
    // rows from the old tbody do not persist after sort rebuilds the table.
    selectionState?.paths.clear();
    syncToolbar?.();

    tbody.innerHTML = "";
    applySort();
    appendRowsToTbody(workingCards, tbody, buildRow, host);
  };

  applySort();
  appendRowsToTbody(workingCards, tbody, buildRow, host);

  // ── Header sort wiring ────────────────────────────────────────────────────

  if (isFieldsMode) {
    // ── Fields-mode sort wiring ────────────────────────────────────────────
    // Attach click handlers from fieldThPairs; skip non-sortable columns.
    for (const { th, field } of fieldThPairs) {
      if (field === "icon" || field === "tags" || field === "count") continue; // not sortable (AD-5)
      const _th = th;
      // Map field identifier to internal sort key.
      const sortKey =
        field === "type" || field === "ext" ? "ext" :
        field === "name" ? "name" :
        field === "modified" ? "modified" :
        field; // custom fields use the key directly (FR-08)
      _th.addEventListener("click", () => {
        sortDir = sortCol === sortKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        sortCol = sortKey;
        clearIndicators();
        _th.classList.add(`fv-sorted-${sortDir}`);
        rebuildTbody();
      });
    }
  } else {
    // ── Legacy mode sort wiring ────────────────────────────────────────────
    // nameTh is always non-null in legacy mode (assigned above unconditionally).
    nameTh!.addEventListener("click", () => {
      sortDir = sortCol === "name" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = "name";
      clearIndicators();
      nameTh!.classList.add(`fv-sorted-${sortDir}`);
      rebuildTbody();
    });

    if (extTh) {
      const _extTh = extTh;
      _extTh.addEventListener("click", () => {
        sortDir = sortCol === "ext" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        sortCol = "ext";
        clearIndicators();
        _extTh.classList.add(`fv-sorted-${sortDir}`);
        rebuildTbody();
      });
    }

    if (modTh) {
      const _modTh = modTh;
      _modTh.addEventListener("click", () => {
        sortDir = sortCol === "modified" ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        sortCol = "modified";
        clearIndicators();
        _modTh.classList.add(`fv-sorted-${sortDir}`);
        rebuildTbody();
      });
    }

    // Extra-field column sort handlers (FR-11, FR-12, AC-08).
    // Iterate by index to pair each <th> element with its field key.
    for (let i = 0; i < extraThs.length; i++) {
      const th = extraThs[i];
      const fieldKey = config.extraFields[i].key;
      th.addEventListener("click", () => {
        sortDir = sortCol === fieldKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        sortCol = fieldKey;
        clearIndicators();
        th.classList.add(`fv-sorted-${sortDir}`);
        rebuildTbody();
      });
    }
  }

  // Arrow-key navigation — always enabled on the tbody (plan requirement).
  // Single-column view: Up/Down navigate rows; Left/Right are no-ops (cols=1).
  attachArrowNavigation(tbody, ".fv-row", () => 1,
    (el) => {
      const card = rowCardMap.get(el as HTMLTableRowElement);
      if (card && onActivate) onActivate(card, el as HTMLTableRowElement);
    },
  );

  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

// ── Public renderer ───────────────────────────────────────────────────────────

/**
 * Render the folder-table layout into the given container.
 *
 * This is the FolderLayoutRenderer for the "folder-table" layout (FR-28).
 * Reuses all existing _folder.md config fields with no new YAML additions.
 *
 * After Step 01 of the unification refactor, the SelectionState, toolbar, and
 * operation callbacks are constructed in tab.ts and passed in via the optional
 * `context` parameter. When `context` is absent (e.g. in tests that call
 * renderFolderTable directly without a fifth argument), a local fallback context
 * is created here so the table remains fully functional with no API breakage.
 *
 * Length justification: mirrors renderFolderCards() — two distinct sections
 * (subfolders, files), each requiring exclude filtering, sort init, and
 * conditional render. All per-section work is delegated to buildSectionTable().
 *
 * @param config      - Validated FolderViewConfig from parseFolderMd().
 * @param cards       - Immediate children from collectChildren() (unsorted).
 * @param container   - The DOM element to render into (cleared on entry).
 * @param _folderPath - Absolute path of the folder (satisfies FolderLayoutRenderer contract).
 * @param context     - Optional shared bulk wiring from tab.ts (Step 01).
 */
export function renderFolderTable(
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  _folderPath: string,
  context?: import("./types").BulkContext,
): void {
  container.innerHTML = "";

  const host = document.createElement("div");
  host.className = "folder-view-host";
  if (!config.contentAreaOverride) host.classList.add("folder-view-host--constrained");

  // Preview pane — when config.previewPane is true, restructure host as a
  // flex column: pane (top) + scrollable main area (bottom).
  // When false, contentTarget === host and DOM is unchanged.
  let contentTarget: HTMLElement = host;
  let previewHandle: PreviewPaneHandle | null = null;
  let selectedTr: HTMLElement | null = null;

  if (config.previewPane) {
    host.classList.add("fv-host--with-preview");
    host.style.setProperty("--fvp-height", config.previewHeight);
    previewHandle = buildPreviewPane();
    host.appendChild(previewHandle.pane);
    host.appendChild(attachPaneResizeHandle(host, previewHandle.pane));

    const mainWrapper = document.createElement("div");
    mainWrapper.className = "folder-view-main";
    host.appendChild(mainWrapper);
    contentTarget = mainWrapper;
  }

  const onActivate = previewHandle
    ? (card: FolderCard, tr: HTMLTableRowElement) => {
        selectedTr?.classList.remove("fv-card--selected");
        selectedTr = tr;
        tr.classList.add("fv-card--selected");
        previewHandle!.update(card);
      }
    : undefined;

  // ── Bulk selection + toolbar ──────────────────────────────────────────────
  // context is only provided when "select" is in fields: (tab.ts gates this).
  // When absent, toolbar and checkboxes are fully suppressed.
  const selectionState = context?.selectionState;
  const syncToolbar    = context?.syncToolbar;

  if (context) {
    contentTarget.appendChild(context.toolbarRefs.toolbar);
  }

  const visibleCards = applyExcludeFilter(cards, config.exclude);
  const dirCards  = visibleCards.filter(c => c.kind === "directory");
  const fileCards = visibleCards.filter(c => c.kind === "file");

  if (config.body.trim()) {
    const desc = document.createElement("div");
    desc.className = "folder-view-description";
    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as ((md: string) => string) | undefined;
    if (renderMd) {
      desc.innerHTML = stripScripts(renderMd(config.body));
    } else {
      desc.textContent = config.body;
    }
    contentTarget.appendChild(desc);
  }

  const showDirs  = config.showFolders && dirCards.length > 0;
  const showFiles = config.showFiles   && fileCards.length > 0;

  if (!showDirs && !showFiles) {
    const empty = document.createElement("div");
    empty.className = "folder-view-empty";
    empty.textContent = "This folder is empty.";
    contentTarget.appendChild(empty);
    container.appendChild(host);
    return;
  }

  if (showDirs) {
    contentTarget.appendChild(
      buildSectionTable(config.foldersTitle || null, dirCards, config, contentTarget, false, selectionState, syncToolbar, onActivate),
    );
  }
  if (showFiles) {
    contentTarget.appendChild(
      buildSectionTable(config.filesTitle || null, fileCards, config, contentTarget, true, selectionState, syncToolbar, onActivate),
    );
  }

  container.appendChild(host);
}
