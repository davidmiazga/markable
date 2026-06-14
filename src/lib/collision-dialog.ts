/**
 * collision-dialog.ts — "File Already Exists" modal for rename/move collisions.
 *
 * Shows a compact blocking dialog with three choices:
 *   Stop      — abort the operation (Esc / close button)
 *   Keep Both — the caller uses the pre-computed incremented filename
 *   Replace   — the caller deletes the existing file then proceeds
 *
 * Self-contained: injects its own CSS once, uses its own `cdlg-` class prefix.
 * Registered in active-modal.ts so the stacking guard sees it.
 *
 * @module collision-dialog
 */

const STYLE_ID   = "__cdlg-styles__";
const OVERLAY_ID = "__collision-dialog-overlay__";

const STYLES = `
.cdlg-overlay {
  position: fixed; inset: 0; z-index: 2100;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 8vh;
  font-family: var(--ui-font, -apple-system, sans-serif);
}
.cdlg-backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
}
.cdlg-panel {
  position: relative; z-index: 1;
  width: min(380px, 90vw);
  background: var(--bg-primary, #1d1d2a);
  border: 1px solid var(--border-color, rgba(255,255,255,.12));
  border-radius: 10px; box-shadow: 0 16px 48px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
  color: var(--text-primary, #e0e0e0);
}
.cdlg-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border-color, rgba(255,255,255,.08));
}
.cdlg-title { font-size: 14px; font-weight: 600; }
.cdlg-close {
  background: transparent; border: none; cursor: pointer;
  color: var(--text-secondary, #aaa); font-size: 22px; line-height: 1; padding: 0 2px;
}
.cdlg-close:hover { color: var(--text-primary, #fff); }
.cdlg-body { padding: 14px 18px 10px; font-size: 13px; line-height: 1.55; }
.cdlg-filename { font-weight: 600; }
.cdlg-preview  { font-size: 11.5px; color: var(--text-secondary, #aaa); margin-top: 5px; }
.cdlg-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 18px 14px;
}
.cdlg-footer-left { margin-right: auto; }
.cdlg-btn {
  font-size: 13px; padding: 5px 14px; border-radius: 5px;
  border: 1px solid var(--border-color, #444);
  background: transparent; color: var(--text-primary, #e0e0e0);
  cursor: pointer; white-space: nowrap;
}
.cdlg-btn:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
.cdlg-btn-danger { color: var(--text-danger, #e66); }
.cdlg-btn-danger:hover { background: var(--bg-hover, rgba(255,255,255,.06)); }
.cdlg-btn:focus-visible { outline: 2px solid var(--accent-color, #4a9eff); outline-offset: 1px; }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES.trim();
  document.head.appendChild(style);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the next available filename by appending or incrementing a `-N`
 * suffix on the stem.
 *
 * - `"note.md"` + `{"note.md"}`              → `"note-2.md"`
 * - `"note-2.md"` + `{"note.md","note-2.md"}` → `"note-3.md"`
 * - Handles files with no extension: `"note"` → `"note-2"`
 */
export function incrementFilename(
  filename: string,
  existingFilenames: Set<string>,
): string {
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext  = lastDot > 0 ? filename.slice(lastDot) : "";

  // Strip an existing `-N` suffix so we increment from N+1, not add another.
  const suffixMatch = /-(\d+)$/.exec(stem);
  let baseStem: string;
  let startN: number;
  if (suffixMatch) {
    baseStem = stem.slice(0, stem.length - suffixMatch[0].length);
    startN = Number.parseInt(suffixMatch[1], 10) + 1;
  } else {
    baseStem = stem;
    startN = 2;
  }

  for (let n = startN; n < 10000; n++) {
    const candidate = `${baseStem}-${n}${ext}`;
    if (!existingFilenames.has(candidate)) return candidate;
  }
  return `${baseStem}-${startN}${ext}`;
}

/**
 * Show the collision dialog and resolve with the user's choice.
 *
 * Resolves with:
 *   "stop"       — abort the operation
 *   "keep-both"  — caller should use `suggestedName` for the new filename
 *   "replace"    — caller should delete the existing file then proceed
 *
 * Esc and the × button both resolve as "stop".
 * Backdrop clicks are intentionally ignored — users must choose explicitly.
 */
export function showCollisionDialog(opts: {
  filename: string;
  suggestedName: string;
}): Promise<"stop" | "keep-both" | "replace"> {
  injectStyles();

  return new Promise<"stop" | "keep-both" | "replace">((resolve) => {
    let resolved = false;
    function finish(choice: "stop" | "keep-both" | "replace"): void {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(choice);
    }

    // ── Overlay + backdrop ──────────────────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "cdlg-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "cdlg-title-text");

    const backdrop = document.createElement("div");
    backdrop.className = "cdlg-backdrop";
    overlay.appendChild(backdrop);

    // ── Panel ────────────────────────────────────────────────────────────────
    const panel = document.createElement("div");
    panel.className = "cdlg-panel";
    overlay.appendChild(panel);

    // Header
    const header = document.createElement("div");
    header.className = "cdlg-header";

    const title = document.createElement("span");
    title.id = "cdlg-title-text";
    title.className = "cdlg-title";
    title.textContent = "File Already Exists";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "cdlg-close";
    closeBtn.setAttribute("aria-label", "Stop");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => finish("stop"));
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "cdlg-body";

    const msg = document.createElement("p");
    msg.style.margin = "0";
    msg.textContent = 'A file named ';
    const fname = document.createElement("span");
    fname.className = "cdlg-filename";
    fname.textContent = `"${opts.filename}"`;
    msg.appendChild(fname);
    msg.append(" already exists in this location.");
    body.appendChild(msg);

    const preview = document.createElement("p");
    preview.className = "cdlg-preview";
    preview.style.margin = "0";
    preview.textContent = `Keep Both will save it as "${opts.suggestedName}".`;
    body.appendChild(preview);

    panel.appendChild(body);

    // Footer
    const footer = document.createElement("div");
    footer.className = "cdlg-footer";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "cdlg-btn cdlg-footer-left";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => finish("stop"));
    footer.appendChild(stopBtn);

    const keepBtn = document.createElement("button");
    keepBtn.type = "button";
    keepBtn.className = "cdlg-btn";
    keepBtn.textContent = "Keep Both";
    keepBtn.addEventListener("click", () => finish("keep-both"));
    footer.appendChild(keepBtn);

    const replaceBtn = document.createElement("button");
    replaceBtn.type = "button";
    replaceBtn.className = "cdlg-btn cdlg-btn-danger";
    replaceBtn.textContent = "Replace";
    replaceBtn.addEventListener("click", () => finish("replace"));
    footer.appendChild(replaceBtn);

    panel.appendChild(footer);
    document.body.appendChild(overlay);

    // Focus the Stop button by default (safest action first).
    stopBtn.focus();

    // ── Keyboard handling ───────────────────────────────────────────────────
    const focusableButtons = [stopBtn, keepBtn, replaceBtn];

    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish("stop");
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const active = document.activeElement;
        const idx = focusableButtons.indexOf(active as HTMLButtonElement);
        if (e.shiftKey) {
          focusableButtons[(idx - 1 + focusableButtons.length) % focusableButtons.length].focus();
        } else {
          focusableButtons[(idx + 1) % focusableButtons.length].focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
  });
}
