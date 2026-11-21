/**
 * html-document-host.ts — Host services for an HTML tab.
 *
 * The iframe asks for the index, one note, or a link. This module answers
 * from the live vault, or from the open HTML file's folder, and never writes a file.
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { readFile } from "../lib/bridge";
import {
  classifyHref,
  isHtmlFilePath,
  noteIsReadable,
  parseNoteFile,
  projectBridgeIndex,
} from "../lib/html-dashboard";
import { getCurrentSettings } from "../lib/settings";
import {
  getActiveVault,
  getVaultIndex,
  offIndexUpdated,
  offVaultChanged,
  onIndexUpdated,
  onVaultChanged,
} from "../lib/vault-manager";
import type { HtmlDocumentHost } from "./html-document-view";

/** Roots of the active vault, from the live manager or from settings during startup. */
export function activeVaultRoots(): string[] {
  const live = getActiveVault()?.rootPaths;
  if (live && live.length > 0) return live;
  const settings = getCurrentSettings();
  const vault = (settings.vaults ?? []).find((entry) => entry.id === settings.activeVaultId);
  return vault?.rootPaths ?? [];
}

/**
 * Build the host callbacks for one HTML tab.
 * `openHtml` and `openNote` are supplied by TabManager so this file does not
 * import the tab manager.
 */
export function createHtmlDocumentHost(
  pagePath: string,
  actions: {
    openHtml: (path: string) => void;
    openNote: (path: string) => void;
  },
): HtmlDocumentHost {
  return {
    async readText(path) {
      if (!isHtmlFilePath(path)) return null;
      const result = await readFile(path);
      return result.ok ? result.value : null;
    },
    bridgeIndex() {
      const index = getVaultIndex();
      if (!index) return projectBridgeIndex(null);
      return projectBridgeIndex({
        vaultId: index.vaultId,
        builtAt: index.builtAt,
        capped: index.capped,
        entries: index.entries,
      });
    },
    subscribeVault(listener) {
      const onVault = () => listener();
      const onIndex = () => listener();
      onVaultChanged(onVault);
      onIndexUpdated(onIndex);
      return () => {
        offVaultChanged(onVault);
        offIndexUpdated(onIndex);
      };
    },
    async readNote(path) {
      if (!noteIsReadable(path, pagePath, activeVaultRoots())) {
        return { ok: false };
      }
      const result = await readFile(path);
      if (!result.ok) return { ok: true, note: null };
      return { ok: true, note: parseNoteFile(path, result.value) };
    },
    classifyHref(href, pagePath) {
      return classifyHref(href, pagePath, activeVaultRoots());
    },
    openHtml: actions.openHtml,
    openNote: actions.openNote,
    openExternal(url) {
      void invoke("open_external_url", { url });
    },
    assetBaseUrl(filePath) {
      const slash = filePath.lastIndexOf("/");
      const dir = slash >= 0 ? filePath.slice(0, slash + 1) : filePath;
      const url = convertFileSrc(dir);
      return url.endsWith("/") ? url : `${url}/`;
    },
  };
}
