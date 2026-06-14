/**
 * folder-icons.ts — Curated catalog + resolver for per-folder icon assignment.
 *
 * This module is the single source of truth for the iconId → CSS-class mapping
 * used by the folder-icon-assignment feature (`docs/specs/folder-icon-assignment/`).
 * It is also the resolver layer that disambiguates the raw `icon:` frontmatter
 * value into one of three shapes: a curated catalog hit, a custom-SVG file path,
 * or the generic fallback.
 *
 * Pure module: no DOM access, no I/O, no Tauri calls. Every export is
 * deterministic and side-effect-free, fully testable in Vitest with zero mocks.
 *
 * Convention:
 *   - Catalog ids are short lowercase kebab-case slugs (`book`, `lightbulb`,
 *     `folder-open`) — never contain `/`, `\`, or `.svg`. Collision between a
 *     catalog id and a user filename is therefore impossible.
 *   - Each id maps 1:1 to a CSS class `folder-icon-<id>` defined in step_02.
 *
 * @module folder-icons
 */

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One entry in the curated catalog.
 *
 * `svg` is the inline SVG markup as a string. We persist the full <svg> element
 * (including `xmlns` + `viewBox`) so the renderer can drop the markup straight
 * into the DOM without extra wrapping — matching the precedent in
 * `src/plugins/file-browser/icons/material/index.ts`.
 */
export interface FolderIconDef {
  /**
   * Stable identifier persisted in `_folder.md`. Lowercase kebab-case.
   * Maps 1:1 to a CSS class `folder-icon-<id>` (see step_02).
   */
  readonly id: string;
  /** User-facing label shown as a tooltip in the picker (step_06). */
  readonly label: string;
  /**
   * Full inline SVG markup as a string (including the outer `<svg>` element).
   * Sourced from Material Symbols Outlined (Apache 2.0) — same icon family
   * as `icons/material/index.ts`, kept inline so the catalog has no asset
   * dependency at runtime.
   */
  readonly svg: string;
}

/**
 * Discriminated union describing how a raw `icon:` value resolves.
 *
 * The renderer (step_05) switches on `kind`; the picker (step_06) uses `kind`
 * to decide between a catalog-tile and a custom-tile UI.
 *
 *   - `catalog`  — `value` matched a curated id. Render `folder-icon-<id>`.
 *   - `custom`   — `value` is treated as a file-system path to a `.svg` file.
 *                  Render `folder-icon-custom` and post-mount inject the
 *                  sanitised SVG body via folder-icon-custom-cache.ts.
 *   - `fallback` — undefined, empty, or unrecognised non-path slug. Render
 *                  the generic `folder-icon` class (today's behaviour — NFR-1).
 */
export type IconValueKind =
  | { kind: "catalog"; id: string; cssClass: string }
  | { kind: "custom"; path: string; cssClass: "folder-icon-custom" }
  | { kind: "fallback"; cssClass: "folder-icon" };

// ── Curated catalog (24 entries) ──────────────────────────────────────────────

/**
 * The curated catalog of folder icons available for assignment.
 *
 * Ordering here is also the visual ordering used by the picker grid (step_06):
 * generic folder variants first, then content primitives (book, notebook),
 * then productivity (target, calendar, inbox, archive), then tech (code,
 * terminal, database), then media (image, film, music), then small affordances
 * (pencil, tag, flag, star, heart, clipboard, briefcase, house).
 *
 * Adding a new entry requires:
 *   1. Adding a row here.
 *   2. Adding a matching `.folder-icon-<id>` CSS rule in step_02.
 *
 * The SVG path data is from Material Symbols Outlined (weight 400, 24px,
 * Apache 2.0 — https://fonts.google.com/icons), the same family already in
 * use under `icons/material/`. Each glyph uses the `viewBox="0 -960 960 960"`
 * coordinate system Material Symbols ships with.
 */
export const FOLDER_ICONS: readonly FolderIconDef[] = [
  // ── Generic folder variants ──
  {
    id: "folder",
    label: "Folder",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M140-160q-24 0-42-18.5T80-220v-520q0-23 18-41.5t42-18.5h281l60 60h339q23 0 41.5 18.5T880-680v460q0 23-18.5 41.5T820-160H140Zm0-60h680v-460H456l-60-60H140v520Zm0 0v-520 520Z"/></svg>`,
  },
  {
    id: "folder-open",
    label: "Folder (open)",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M140-160q-23 0-41.5-18.5T80-220v-520q0-23 18.5-41.5T140-800h281l60 60h339q23 0 41.5 18.5T880-680H455l-60-60H140v520l102-400h698L833-206q-6 24-22 35t-41 11H140Zm63-60h572l84-340H287l-84 340Zm0 0 84-340-84 340Zm-63-460v-60 60Z"/></svg>`,
  },

  // ── Content primitives ──
  {
    id: "book",
    label: "Book",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M300-80q-58 0-99-41t-41-99v-560q0-58 41-99t99-41h500v640q-25 0-42.5 17.5T740-220q0 25 17.5 42.5T800-160v80H300Zm-60-267q14-7 29-10t31-3h20v-440h-20q-25 0-42.5 17.5T240-740v393Zm140-13h320v-440H380v440Zm-140 13v-453 453Zm60 207h373q-6-14-9.5-28.5T660-220q0-16 3-31t10-29H300q-26 0-43 17.5T240-220q0 26 17 43t43 17Z"/></svg>`,
  },
  {
    id: "bookshelf",
    label: "Bookshelf",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M80-80v-800h800v800H80Zm60-60h120v-680H140v680Zm180 0h120v-680H320v680Zm180 0h120v-680H500v680Zm180 0h120v-680H680v680Z"/></svg>`,
  },
  {
    id: "notebook",
    label: "Notebook",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M220-80q-24 0-42-18t-18-42v-680q0-24 18-42t42-18h560q24 0 42 18t18 42v680q0 24-18 42t-42 18H220Zm0-60h560v-680H460v280l-100-60-100 60v-280h-40v680Zm0 0v-680 680Zm40-400 100-60 100 60-100-60-100 60Z"/></svg>`,
  },

  // ── Ideas / planning ──
  {
    id: "lightbulb",
    label: "Idea",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-60h320v60H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm22-60h256q49-35 75.5-87.5T710-580q0-96-67-163t-163-67q-96 0-163 67t-67 163q0 60 26.5 112.5T352-380Zm128 0Z"/></svg>`,
  },
  {
    id: "target",
    label: "Goal",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-120q-83 0-141.5-58.5T280-480q0-83 58.5-141.5T480-680q83 0 141.5 58.5T680-480q0 83-58.5 141.5T480-280Zm0-80q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Zm0-40q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-80Z"/></svg>`,
  },
  {
    id: "calendar",
    label: "Calendar",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-400Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-160 0q-17 0-28.5-11.5T280-280q0-17 11.5-28.5T320-320q17 0 28.5 11.5T360-280q0 17-11.5 28.5T320-240Zm320 0q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z"/></svg>`,
  },
  {
    id: "inbox",
    label: "Inbox",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-160q-33 0-56.5-23.5T120-240v-480q0-33 23.5-56.5T200-800h560q33 0 56.5 23.5T840-720v480q0 33-23.5 56.5T760-160H200Zm0-200h140q14 35 44.5 57.5T480-280q35 0 65.5-22.5T590-360h170v-360H200v360Zm280 0q-25 0-42.5-17.5T420-420H200v180h560v-180H540q0 25-17.5 42.5T480-360ZM200-360v180-180Z"/></svg>`,
  },
  {
    id: "archive",
    label: "Archive",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-120q-33 0-56.5-23.5T120-200v-499q0-14 4.5-27t13.5-24l50-61q11-14 27.5-21.5T250-840h460q18 0 34.5 7.5T772-811l50 61q9 11 13.5 24t4.5 27v499q0 33-23.5 56.5T760-120H200Zm16-600h528l-34-40H250l-34 40Zm-16 60v420h560v-420H200Zm280 360 160-160-56-56-64 64v-168h-80v168l-64-64-56 56 160 160ZM200-180h560-560Z"/></svg>`,
  },

  // ── Tech / data ──
  {
    id: "code",
    label: "Code",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M320-242 80-482l242-242 43 43-199 199 197 197-43 43Zm318 2-43-43 199-199-197-197 43-43 240 240-242 242Z"/></svg>`,
  },
  {
    id: "terminal",
    label: "Terminal",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M120-120v-720h720v720H120Zm60-60h600v-600H180v600Zm126-87-43-43 110-110-110-110 43-43 153 153-153 153Zm167 7v-60h280v60H473Z"/></svg>`,
  },
  {
    id: "database",
    label: "Database",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M480-120q-151 0-255.5-46.5T120-280v-400q0-66 105-113t255-47q150 0 255 47t105 113v400q0 67-104.5 113.5T480-120Zm0-491q89 0 179-25.5T760-680q-11-29-100.5-54.5T480-760q-91 0-178.5 25T200-680q14 30 101.5 54.5T480-611Zm0 171q42 0 81-4t74.5-11.5q35.5-7.5 67-18.5t57.5-25v-120q-26 14-57.5 25t-67 18.5Q600-468 561-464t-81 4q-42 0-82-4t-75.5-11.5Q287-483 256-494t-56-25v120q25 14 56 25t66.5 18.5Q358-348 398-344t82 4Zm0 200q46 0 90.5-7t82.5-18.5q38-11.5 67-26t39-29.5v-98q-26 14-57.5 25t-67 18.5Q600-268 561-264t-81 4q-42 0-82-4t-75.5-11.5Q287-283 256-294t-56-25v99q10 15 39 29t67 26q38 12 82.5 18.5T480-140Z"/></svg>`,
  },

  // ── Media ──
  {
    id: "image",
    label: "Image",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M180-120q-24 0-42-18t-18-42v-600q0-24 18-42t42-18h600q24 0 42 18t18 42v600q0 24-18 42t-42 18H180Zm0-60h600v-600H180v600Zm56-97h489L578-473 446-302l-93-127-117 152Zm-56 97v-600 600Z"/></svg>`,
  },
  {
    id: "film",
    label: "Film",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h80v-80h-80v80Zm160 0h320v-480H320v480Zm400 0h80v-80h-80v80ZM160-320h80v-80h-80v80Zm560 0h80v-80h-80v80ZM160-480h80v-80h-80v80Zm560 0h80v-80h-80v80ZM160-560h80v-80h-80v80Zm560 0h80v-80h-80v80Z"/></svg>`,
  },
  {
    id: "music",
    label: "Music",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-419v-441h240v160H560v500q0 66-47 113t-113 47Z"/></svg>`,
  },

  // ── Small affordances ──
  {
    id: "pencil",
    label: "Pencil",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>`,
  },
  {
    id: "tag",
    label: "Tag",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M856-390 570-104q-12 12-27 18t-30 6q-15 0-30-6t-27-18L103-457q-11-11-17-25.5T80-513v-287q0-33 23.5-56.5T160-880h287q16 0 31 6.5t26 17.5l352 353q12 12 17.5 27t5.5 30q0 15-5.5 29.5T856-390ZM513-160l286-286-353-354H160v286l353 354ZM260-640q25 0 42.5-17.5T320-700q0-25-17.5-42.5T260-760q-25 0-42.5 17.5T200-700q0 25 17.5 42.5T260-640Zm220 160Z"/></svg>`,
  },
  {
    id: "flag",
    label: "Flag",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-120v-680h360l16 80h224v400H520l-16-80H260v280h-60Zm300-440Zm86 160h154v-280H526l-16-80H260v280h310l16 80Z"/></svg>`,
  },
  {
    id: "star",
    label: "Star",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="m233-80 65-281L80-550l288-25 112-265 112 265 288 25-218 189 65 281-247-149L233-80Zm247-228 149 90-39-170 131-114-173-15-68-160-68 160-173 15 131 114-39 170 149-90Zm0-92Z"/></svg>`,
  },
  {
    id: "heart",
    label: "Heart",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="m480-120-58-52q-101-91-167-157T150-447.5Q111-500 95.5-544T80-634q0-94 63-157t157-63q52 0 99 22t81 62q34-40 81-62t99-22q94 0 157 63t63 157q0 46-15.5 90T810-447.5Q771-395 705-329T538-172l-58 52Zm0-80q96-86 158-147.5t98-107q36-45.5 50-81t14-71.5q0-69-46-115t-115-46q-43 0-80 18.5T501-660h-42q-22-29-59-47.5T320-726q-69 0-115 46t-46 115q0 36 14 71.5t50 81q36 45.5 98 107T480-200Zm0-262Z"/></svg>`,
  },
  {
    id: "clipboard",
    label: "Clipboard",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h167q11-35 43-57.5t70-22.5q40 0 71.5 22.5T594-840h166q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm80-80h280v-80H280v80Zm0-160h400v-80H280v80Zm0-160h400v-80H280v80Zm200-180q17 0 28.5-11.5T520-820q0-17-11.5-28.5T480-860q-17 0-28.5 11.5T440-820q0 17 11.5 28.5T480-780ZM200-200v-560 560Z"/></svg>`,
  },
  {
    id: "briefcase",
    label: "Briefcase",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M160-120q-33 0-56.5-23.5T80-200v-440q0-33 23.5-56.5T160-720h160v-80q0-33 23.5-56.5T400-880h160q33 0 56.5 23.5T640-800v80h160q33 0 56.5 23.5T880-640v440q0 33-23.5 56.5T800-120H160Zm0-80h640v-440H160v440Zm240-520h160v-80H400v80ZM160-200v-440 440Z"/></svg>`,
  },
  {
    id: "house",
    label: "Home",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"><path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-60 60v-450l300-225 300 225v450H540v-240H420v240H180Zm300-330Z"/></svg>`,
  },
];

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Pre-computed `iconId → CSS class` lookup table.
 *
 * Built once at module load from `FOLDER_ICONS` so every call to
 * `interpretIconValue()` is O(1). Object literal is `Object.fromEntries` for
 * brevity; the runtime shape is a plain string-keyed record.
 */
const ICON_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  FOLDER_ICONS.map((def) => [def.id, `folder-icon-${def.id}`]),
);

/**
 * Heuristic: does this string look like a file-system path to a `.svg`?
 *
 * True when the value contains a `/` or `\` (path separators on POSIX and
 * Windows respectively) OR ends with `.svg` (case-insensitive). The function
 * is intentionally permissive — false positives are recovered at render time
 * (a malformed path fails the SVG-sniff check in folder-icon-custom-cache.ts
 * and the tree falls back to the generic glyph per EC-16).
 *
 * Pure. No I/O.
 */
function looksLikePath(value: string): boolean {
  if (value.includes("/") || value.includes("\\")) return true;
  if (/\.svg$/i.test(value)) return true;
  return false;
}

/**
 * Discriminate the raw `icon:` value per FR-12 precedence:
 *
 *   1. **Catalog hit** — value is a known curated id → `kind: "catalog"`.
 *   2. **Custom-SVG path** — value matches `looksLikePath` → `kind: "custom"`.
 *      The caller (renderer) handles the file read + sanitisation pipeline.
 *   3. **Fallback** — undefined, empty, or unrecognised slug → `kind: "fallback"`.
 *
 * The precedence is strict — catalog matches always win. Because every catalog
 * id is a short kebab-case slug containing no path separator and no `.svg`
 * suffix, a curated id and a user filename can never collide.
 *
 * @param value - Raw frontmatter value (typically from `_folder.md icon:` field).
 * @returns A discriminated union the caller switches on.
 */
export function interpretIconValue(value: string | undefined): IconValueKind {
  if (!value) {
    return { kind: "fallback", cssClass: "folder-icon" };
  }

  const catalogClass = ICON_MAP[value];
  if (catalogClass) {
    return { kind: "catalog", id: value, cssClass: catalogClass };
  }

  if (looksLikePath(value)) {
    return { kind: "custom", path: value, cssClass: "folder-icon-custom" };
  }

  return { kind: "fallback", cssClass: "folder-icon" };
}

/**
 * Resolve the CSS icon class for a directory tree node from a stored icon value
 * (typically read from `_folder.md` frontmatter).
 *
 * Convenience wrapper over `interpretIconValue()` — returns just the cssClass.
 * Existing call sites in `file-tree.ts` (the two `iconClass: "folder-icon"`
 * literals at lines 313 + 344, replaced in step_05) use this signature
 * unchanged. New consumers that need the full discriminated shape — the tree
 * builder that has to also know whether to set `data-icon-path` — call
 * `interpretIconValue` directly.
 *
 * Unknown, undefined, empty-string, or any non-catalog non-path value returns
 * the generic `"folder-icon"` class so the renderer is a pure superset of
 * today's behaviour (NFR-1).
 *
 * @param iconValue - Raw value from `_folder.md icon:` (may be undefined).
 * @returns A CSS class name. Default fallback is literally `"folder-icon"`.
 */
export function getFolderIconClass(iconValue: string | undefined): string {
  return interpretIconValue(iconValue).cssClass;
}
