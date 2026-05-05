import { extractH1, h1ToFilename, resolveConflictPath } from "./auto-title-helpers";
import type { FilenameStyle } from "./auto-title-helpers";
import { buildSelectRow } from "../../settings/settings-fields";

let _active = false;
let _style: FilenameStyle = "spaces";
let _api: { saveSettings(data: Record<string, unknown>): Promise<void> } | null = null;

async function resolveTargetPath(doc: string): Promise<string | null> {
  if (!_active) return null;

  const h1 = extractH1(doc);
  if (!h1) return null;

  const stem = h1ToFilename(h1, _style);

  const vaultRoot = (window as any).__MARKABLE_VAULT_MANAGER__
    ?.getActiveVault?.()
    ?.rootPaths?.[0] as string | undefined;
  if (!vaultRoot) return null;

  const candidates: string[] = [
    `${vaultRoot}/${stem}.md`,
    ...Array.from({ length: 98 }, (_, i) => `${vaultRoot}/${stem} ${i + 2}.md`),
  ];

  let existsMap: Record<string, boolean> = {};
  try {
    existsMap = await (window as any).__TAURI_INTERNALS__.invoke("check_paths_exist", {
      paths: candidates,
    });
  } catch {
    return null;
  }

  if (!_active) return null;

  return resolveConflictPath(vaultRoot, stem, existsMap);
}

function getFilenameStyle(): FilenameStyle {
  return _style;
}

function renderDetailExtra(container: HTMLElement): void {
  const row = buildSelectRow(
    "Filename style",
    _style,
    [
      ["spaces", "Normal Spaces  (My Note.md)"],
      ["camel",  "CamelCase  (MyNote.md)"],
      ["kebab",  "kebab-case  (my-note.md)"],
    ],
    async (value) => {
      _style = value as FilenameStyle;
      if (_api) await _api.saveSettings({ filenameStyle: _style });
    },
  );
  container.appendChild(row);
}

async function onEnable(api: any): Promise<void> {
  _active = true;
  _api = api;

  const stored = await api.loadSettings().catch(() => null) as Record<string, unknown> | null;
  const saved = stored?.filenameStyle;
  if (saved === "camel" || saved === "kebab" || saved === "spaces") {
    _style = saved;
  }

  (window as any).__MARKABLE_AUTO_TITLE__ = { resolveTargetPath, getFilenameStyle };
}

function onDisable() {
  _active = false;
  _api = null;
  delete (window as any).__MARKABLE_AUTO_TITLE__;
}

export default {
  id: "auto-title",
  name: "Auto Title",
  version: "1.0.0",
  description: "Derives a filename from the document's H1 heading on first save",
  detail:
    "When you create a new document and type a # Heading on line 1, " +
    "the first Cmd-S saves the file as {heading}.md in your vault root — " +
    "no dialog, no duplicate typing. Only applies to new untitled files.",
  renderDetailExtra,
  onEnable,
  onDisable,
};
