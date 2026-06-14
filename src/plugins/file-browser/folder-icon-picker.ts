/**
 * folder-icon-picker.ts — Modal picker for assigning a folder's icon.
 *
 * Invoked from the directory right-click menu via `openFolderIconPicker()`.
 * Displays:
 *   1. The curated catalog (FOLDER_ICONS) as a grid of clickable tiles.
 *   2. A divider.
 *   3. The "Custom" section — one tile per entry in `settings.customFolderIcons`,
 *      each rendering the sanitised SVG inline (same cache the tree uses) plus
 *      a hover-revealed × button to remove the entry from the favourites list.
 *   4. The footer: "Add custom SVG…" (left), spacer, then Remove / Cancel /
 *      Apply (right).
 *
 * Reuses the canonical Markable modal chrome (.settings-overlay, .settings-panel,
 * .settings-footer, .btn-* variants) so the picker matches the rest of the app's
 * modal style. Per `feedback_look_first`: no parallel modal CSS invented.
 *
 * Behaviour highlights:
 *   - EC-9: opens with the current assignment highlighted (catalog OR custom).
 *   - EC-10: Apply is disabled while the write is in flight (single-writer guard).
 *   - EC-16/17: custom tiles are rendered through `getCustomSvg()` so the same
 *     sanitisation pipeline that protects the tree protects the picker preview.
 *   - EC-18/19: "Add custom SVG…" validates via `validateSvgFile()` before
 *     calling `addCustomIcon`; failures surface as an inline error.
 *   - EC-20: at the 100-entry cap, the Add button refuses without opening the
 *     file dialog.
 */

import { FOLDER_ICONS, interpretIconValue } from "./folder-icons";
import { readFolderIcon, setFolderIcon } from "./folder-icon-store";
import { getCustomSvg } from "./folder-icon-custom-cache";
import { validateSvgFile } from "./svg-validator";
import {
  getCustomIcons,
  addCustomIcon,
  removeCustomIcon,
  CUSTOM_ICON_CAP,
} from "./folder-icon-custom-settings";
import { openAssetDialog } from "../../lib/dialogs";
import { readFile } from "../../lib/bridge";
import { attachModalKeyboard } from "../../lib/modal-keyboard";

/** Options passed to `openFolderIconPicker`. */
export interface OpenFolderIconPickerOptions {
  /**
   * Called after a successful Apply / Remove. The caller wires this to the
   * vault-index reload (step_07) so the tree picks up the new icon class on
   * the next render pass.
   */
  onChange?: () => void;
}

/**
 * Local selection state held by the picker.
 *
 * `value === undefined` means "no selection" (initial state when the folder
 * has no icon assignment). A non-undefined value is whatever will be written
 * to `_folder.md icon:` on Apply — either a catalog iconId or an absolute
 * SVG path (the store layer is opaque to the kind).
 */
interface PickerState {
  /** What's currently saved in `_folder.md` — never changes during the modal. */
  initial: string | undefined;
  /** What the user has picked. `undefined` = no selection yet. */
  selected: string | undefined;
}

/** Wrap an inline SVG markup string into a sized <svg> tag for the picker grid. */
function wrapPickerSvg(svg: string, size: number): string {
  // Tiles size the SVG via CSS (`width: 100%; height: 100%`), so we override
  // any embedded width/height attributes. This mirrors the wrapSvg() helper
  // in file-browser.plugin.ts.
  return svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
}

/**
 * Map a validation failure reason to the user-facing inline error string.
 * Kept in one place so future localisation has a single touchpoint.
 */
function validatorErrorMessage(
  reason: "too_large" | "parse_error" | "not_svg" | "empty",
): string {
  switch (reason) {
    case "too_large":
      return "SVG too large (max 32 KB).";
    case "empty":
    case "parse_error":
    case "not_svg":
    default:
      return "Not a valid SVG file.";
  }
}

/**
 * Open the folder icon picker modal for `folderPath`.
 *
 * Resolves when the modal closes (after Apply success, Remove success, or
 * Cancel/Escape/backdrop). The promise never rejects — bridge errors are
 * surfaced inline and Cancel keeps the modal lifecycle clean.
 *
 * @param folderPath - Absolute path of the folder to assign an icon to.
 * @param opts       - Optional onChange callback fired after a successful Apply/Remove.
 */
export async function openFolderIconPicker(
  folderPath: string,
  opts?: OpenFolderIconPickerOptions,
): Promise<void> {
  // ── Read current assignment ────────────────────────────────────────────
  const initial = await readFolderIcon(folderPath);

  // ── Overlay + panel ────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.className = "settings-overlay folder-icon-picker-overlay";

  const backdrop = document.createElement("div");
  backdrop.className = "settings-backdrop";
  overlay.appendChild(backdrop);

  const panel = document.createElement("div");
  panel.className = "settings-panel folder-icon-picker-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Set folder icon");
  panel.tabIndex = -1;
  overlay.appendChild(panel);

  // ── Header ─────────────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.className = "settings-header";
  const title = document.createElement("h2");
  title.className = "settings-title";
  title.textContent = "Set folder icon";
  header.appendChild(title);
  panel.appendChild(header);

  // ── Body ───────────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "settings-body";
  panel.appendChild(body);

  const curatedGrid = document.createElement("div");
  curatedGrid.className = "folder-icon-picker-grid folder-icon-picker-curated";
  curatedGrid.setAttribute("role", "listbox");
  body.appendChild(curatedGrid);

  const divider = document.createElement("hr");
  divider.className = "folder-icon-picker-divider";
  body.appendChild(divider);

  const customHeading = document.createElement("div");
  customHeading.className = "folder-icon-picker-section-heading";
  customHeading.textContent = "Custom";
  body.appendChild(customHeading);

  const customGrid = document.createElement("div");
  customGrid.className = "folder-icon-picker-grid folder-icon-picker-custom-grid";
  customGrid.setAttribute("role", "listbox");
  body.appendChild(customGrid);

  // ── Footer ─────────────────────────────────────────────────────────────
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-secondary folder-icon-picker-add";
  addBtn.textContent = "Add custom SVG…";

  const errorEl = document.createElement("span");
  errorEl.className = "folder-icon-picker-error";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-tertiary folder-icon-picker-remove";
  removeBtn.textContent = "Remove icon";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary folder-icon-picker-cancel";
  cancelBtn.textContent = "Cancel";

  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn btn-primary folder-icon-picker-apply";
  applyBtn.textContent = "Apply";

  footer.appendChild(addBtn);
  footer.appendChild(errorEl);
  footer.appendChild(removeBtn);
  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  panel.appendChild(footer);

  // ── State ──────────────────────────────────────────────────────────────
  const state: PickerState = { initial, selected: initial };

  function setError(msg: string): void {
    errorEl.textContent = msg;
  }
  function clearError(): void {
    errorEl.textContent = "";
  }

  function updateApplyEnabled(): void {
    // Apply is enabled only when the selection differs from the initial
    // assignment AND a selection actually exists.
    applyBtn.disabled =
      state.selected === state.initial || state.selected === undefined;
    // Remove is only meaningful when an assignment currently exists.
    removeBtn.disabled = state.initial === undefined;
  }

  function highlightSelected(): void {
    const all = panel.querySelectorAll<HTMLElement>(".folder-icon-tile");
    for (const tile of all) tile.classList.remove("folder-icon-tile-selected");
    if (state.selected === undefined) return;
    // Match either curated (data-icon-id) or custom (data-icon-path).
    const interp = interpretIconValue(state.selected);
    if (interp.kind === "catalog") {
      const t = panel.querySelector<HTMLElement>(
        `.folder-icon-tile[data-icon-id="${interp.id}"]`,
      );
      t?.classList.add("folder-icon-tile-selected");
    } else if (interp.kind === "custom") {
      const t = panel.querySelector<HTMLElement>(
        `.folder-icon-tile[data-icon-path="${cssAttrEscape(interp.path)}"]`,
      );
      t?.classList.add("folder-icon-tile-selected");
    }
  }

  function renderCurated(): void {
    curatedGrid.innerHTML = "";
    for (const def of FOLDER_ICONS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "folder-icon-tile";
      tile.setAttribute("role", "option");
      tile.setAttribute("aria-label", def.label);
      tile.title = def.label;
      tile.dataset.iconId = def.id;
      tile.innerHTML = wrapPickerSvg(def.svg, 24);
      tile.addEventListener("click", () => {
        clearError();
        state.selected = def.id;
        highlightSelected();
        updateApplyEnabled();
      });
      curatedGrid.appendChild(tile);
    }
  }

  function renderCustom(): void {
    customGrid.innerHTML = "";
    const entries = getCustomIcons();
    for (const entry of entries) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "folder-icon-tile folder-icon-tile-custom";
      tile.setAttribute("role", "option");
      tile.setAttribute("aria-label", entry.label);
      tile.title = entry.label;
      tile.dataset.iconPath = entry.path;

      // Render the SVG inline via the cache (same pipeline the tree uses).
      // Fire-and-forget; until the read resolves the tile stays empty.
      void (async () => {
        const sanitised = await getCustomSvg(entry.path);
        if (sanitised) {
          // Preserve the × button while replacing the icon body.
          const removeMark = tile.querySelector(".folder-icon-tile-remove");
          tile.innerHTML = sanitised;
          if (removeMark) tile.appendChild(removeMark);
        }
      })();

      // Remove-from-Custom × button (hover-revealed by CSS).
      const removeMark = document.createElement("button");
      removeMark.type = "button";
      removeMark.className = "folder-icon-tile-remove";
      removeMark.setAttribute("aria-label", `Remove ${entry.label} from Custom`);
      removeMark.textContent = "×";
      removeMark.addEventListener("click", async (ev) => {
        // Stop the parent tile's click from also firing.
        ev.stopPropagation();
        await removeCustomIcon(entry.path);
        // If the removed entry was the current selection, clear it.
        if (state.selected === entry.path) {
          state.selected = state.initial;
        }
        renderCustom();
        highlightSelected();
        updateApplyEnabled();
      });
      tile.appendChild(removeMark);

      tile.addEventListener("click", () => {
        clearError();
        state.selected = entry.path;
        highlightSelected();
        updateApplyEnabled();
      });

      customGrid.appendChild(tile);
    }
  }

  // ── Add custom SVG handler ────────────────────────────────────────────
  addBtn.addEventListener("click", async () => {
    clearError();
    // EC-20: refuse-add at cap. Surface the error inline and DO NOT open
    // the dialog (avoids a confusing "you picked a file but nothing
    // happened" flow).
    if (getCustomIcons().length >= CUSTOM_ICON_CAP) {
      setError(
        `Custom icon limit reached. Remove an icon from the Custom section first.`,
      );
      return;
    }

    const dlg = await openAssetDialog();
    if (dlg.cancelled) return;

    // openAssetDialog accepts images + svg; reject non-svg extensions
    // explicitly (the validator will catch them too, but a precise
    // up-front error is clearer).
    if (!/\.svg$/i.test(dlg.path)) {
      setError("Only SVG files are supported.");
      return;
    }

    const readResult = await readFile(dlg.path);
    if (!readResult.ok) {
      setError("Could not read file.");
      return;
    }
    const content = readResult.value;
    // `validateSvgFile` documents its second parameter as the BYTE length of
    // the original file (its 32 KB cap is a file-size cap, not a JS-string-
    // length cap). JavaScript's `String.length` counts UTF-16 code units, so
    // multibyte UTF-8 content (emoji, non-ASCII glyphs) would underreport the
    // true file size and slip past the cap. TextEncoder.encode produces the
    // canonical UTF-8 byte stream that matches what the picker just read.
    const byteLength = new TextEncoder().encode(content).length;
    const validation = validateSvgFile(content, byteLength);
    if (!validation.ok) {
      setError(validatorErrorMessage(validation.reason));
      return;
    }

    // basename helper — last `/` segment.
    const slash = dlg.path.lastIndexOf("/");
    const label = slash >= 0 ? dlg.path.slice(slash + 1) : dlg.path;

    const addResult = await addCustomIcon({
      path: dlg.path,
      label,
      addedAt: Date.now(),
    });
    if (!addResult.ok) {
      // Cap or duplicate — both map to clear inline messages.
      if (addResult.reason === "cap_reached") {
        setError(
          `Custom icon limit reached. Remove an icon from the Custom section first.`,
        );
      } else {
        setError("Already in your Custom list.");
      }
      return;
    }

    // Success — select the new path, re-render the Custom section, and let
    // the user confirm with Apply.
    state.selected = dlg.path;
    renderCustom();
    highlightSelected();
    updateApplyEnabled();
  });

  // ── Apply / Remove / Cancel handlers ──────────────────────────────────
  let inFlight = false;

  function setButtonsDisabled(disabled: boolean): void {
    applyBtn.disabled = disabled;
    removeBtn.disabled = disabled;
    cancelBtn.disabled = disabled;
    addBtn.disabled = disabled;
  }

  let resolveOuter: () => void = () => {};

  function close(): void {
    overlay.remove();
    resolveOuter();
  }

  applyBtn.addEventListener("click", async () => {
    if (inFlight) return;
    if (state.selected === undefined) return;
    inFlight = true;
    setButtonsDisabled(true);
    const r = await setFolderIcon(folderPath, state.selected);
    if (r.ok) {
      opts?.onChange?.();
      close();
    } else {
      inFlight = false;
      setError(r.error.message || "Failed to write _folder.md");
      setButtonsDisabled(false);
      // After re-enabling, recompute apply gating (selection unchanged).
      updateApplyEnabled();
    }
  });

  removeBtn.addEventListener("click", async () => {
    if (inFlight) return;
    inFlight = true;
    setButtonsDisabled(true);
    const r = await setFolderIcon(folderPath, undefined);
    if (r.ok) {
      opts?.onChange?.();
      close();
    } else {
      inFlight = false;
      setError(r.error.message || "Failed to write _folder.md");
      setButtonsDisabled(false);
      updateApplyEnabled();
    }
  });

  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  // ── Initial render ────────────────────────────────────────────────────
  renderCurated();
  renderCustom();
  highlightSelected();
  updateApplyEnabled();

  document.body.appendChild(overlay);

  attachModalKeyboard({ modal: overlay, onClose: close });

  return new Promise<void>((resolve) => {
    resolveOuter = resolve;
  });
}

/**
 * Escape characters that have special meaning inside a CSS attribute
 * selector value. The picker uses `[data-icon-path="<path>"]` queries to
 * find tiles for highlighting; paths with `"` or `\` could break the
 * selector. Backslash and double-quote escapes are sufficient for
 * filesystem paths.
 */
function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
