/**
 * preview-pane.ts — Adobe Bridge–style preview pane for folder views.
 *
 * Exports `buildPreviewPane()`, which returns a `PreviewPaneHandle` containing
 * the pane DOM element and an `update(card)` method. The host (renderer.ts /
 * table-renderer.ts) inserts `pane` as the first child and calls `update`
 * whenever the selection changes.
 *
 * Content types:
 *   - No selection  → placeholder text
 *   - Directory     → folder icon + name
 *   - Image (.jpg/.jpeg/.png/.gif/.webp/.heic/.svg)
 *                   → <img> via __MARKABLE_CONVERT_FILE_SRC__
 *   - Markdown/text (.md/.txt)
 *                   → read_file → strip frontmatter → __MARKABLE_RENDER_MD__
 *   - Other         → file-type icon + name
 *
 * Stale-load guard: an incrementing `loadToken` is captured in each async
 * read_file call; if a newer update() fires before the load completes, the
 * callback compares tokens and discards the stale result.
 *
 * @module folder-view/preview-pane
 */

import type { FolderCard } from "./types";
import { stripScripts } from "./shared";
import {
  ICON_FOLDER,
  ICON_FILE,
  ICON_FILE_MARKDOWN,
  ICON_FILE_IMAGE,
} from "../icons/material/index";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".svg"]);
const MD_EXTS    = new Set([".md", ".txt"]);

function iconForExt(ext: string): string {
  const l = ext.toLowerCase();
  if (l === ".md") return ICON_FILE_MARKDOWN;
  if (IMAGE_EXTS.has(l)) return ICON_FILE_IMAGE;
  return ICON_FILE;
}

export interface PreviewPaneHandle {
  pane: HTMLElement;
  update(card: FolderCard | null): void;
}

/**
 * Build the preview pane element and return a handle for updating its content.
 *
 * The pane is a flex column: a `.fvp-header` bar (hidden when no selection)
 * and a `.fvp-body` content area. The host must set `--fvp-height` on itself
 * so the pane's `flex: 0 0 var(--fvp-height, 60%)` resolves to the right size.
 */
export function buildPreviewPane(): PreviewPaneHandle {
  let loadToken = 0;

  const pane = document.createElement("div");
  pane.className = "fvp-pane";

  const header = document.createElement("div");
  header.className = "fvp-header";
  header.style.display = "none";
  pane.appendChild(header);

  const body = document.createElement("div");
  body.className = "fvp-body";
  pane.appendChild(body);

  const showEmptyState = (): void => {
    header.style.display = "none";
    body.innerHTML = "";
    const placeholder = document.createElement("div");
    placeholder.className = "fvp-empty";
    placeholder.textContent = "← Select a file to preview";
    body.appendChild(placeholder);
  };

  const showNoPreviewIcon = (ext: string): void => {
    body.innerHTML = "";
    const iconWrap = document.createElement("div");
    iconWrap.className = "fvp-other-icon";
    iconWrap.innerHTML = iconForExt(ext);
    body.appendChild(iconWrap);
  };

  showEmptyState();

  const update = (card: FolderCard | null): void => {
    if (!card) { showEmptyState(); return; }

    header.style.display = "";
    header.textContent = card.name + (card.ext ? `  ${card.ext}` : "");

    if (card.kind === "directory") {
      body.innerHTML = "";
      const iconWrap = document.createElement("div");
      iconWrap.className = "fvp-other-icon";
      iconWrap.innerHTML = ICON_FOLDER;
      body.appendChild(iconWrap);
      const label = document.createElement("div");
      label.className = "fvp-empty";
      label.textContent = card.name;
      body.appendChild(label);
      return;
    }

    const extLower = card.ext.toLowerCase();

    if (IMAGE_EXTS.has(extLower)) {
      body.innerHTML = "";
      const convertFileSrc = (window as any).__MARKABLE_CONVERT_FILE_SRC__ as
        ((p: string) => string) | undefined;
      if (convertFileSrc) {
        const url = convertFileSrc(card.path);
        const wrap = document.createElement("div");
        wrap.className = "fvp-image-content";
        const img = document.createElement("img");
        img.src = url;
        img.alt = card.name;
        wrap.appendChild(img);
        body.appendChild(wrap);
      } else {
        showNoPreviewIcon(extLower);
      }
      return;
    }

    if (MD_EXTS.has(extLower)) {
      body.innerHTML = "";
      const token = ++loadToken;
      const invoke = (window as any).__TAURI_INTERNALS__?.invoke as
        ((cmd: string, args: object) => Promise<string>) | undefined;
      if (!invoke) { showNoPreviewIcon(extLower); return; }
      void invoke("read_file", { path: card.path }).then((raw) => {
        if (token !== loadToken) return; // stale load — newer update() fired
        let text = raw;
        if (text.startsWith("---")) {
          const closeAt = text.indexOf("\n---", 4);
          if (closeAt !== -1) text = text.slice(closeAt + 4);
        }
        body.innerHTML = "";
        const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
          ((md: string) => string) | undefined;
        if (renderMd && extLower === ".md") {
          const content = document.createElement("div");
          content.className = "fvp-md-content";
          content.innerHTML = stripScripts(renderMd(text.trim()));
          body.appendChild(content);
        } else {
          const pre = document.createElement("pre");
          pre.className = "fvp-md-content";
          pre.textContent = text.trim();
          body.appendChild(pre);
        }
      }).catch(() => {
        if (token !== loadToken) return;
        body.innerHTML = "";
        const msg = document.createElement("div");
        msg.className = "fvp-empty";
        msg.textContent = "Could not load preview.";
        body.appendChild(msg);
      });
      return;
    }

    showNoPreviewIcon(extLower);
  };

  return { pane, update };
}
