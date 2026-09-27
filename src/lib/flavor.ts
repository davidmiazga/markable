/**
 * Active product flavor — first-run defaults, not capability limits.
 *
 * Packs live in /flavors/packs.json. Flavor files choose packs.
 * An optional defaultEnabledPlugins list overrides pack union (unused now).
 */

import packCatalog from "../../flavors/packs.json";
import markableManifest from "../../flavors/markable.json";
import remarkableManifest from "../../flavors/remarkable.json";
import pkmManifest from "../../flavors/pkm.json";
import projectManifest from "../../flavors/project.json";
import diaryManifest from "../../flavors/diary.json";
import quicknoteManifest from "../../flavors/quicknote.json";

export interface FlavorManifest {
  id: string;
  displayName: string;
  productName?: string;
  /** Tight UI: Finder, Dock, app menu, window title. Falls back to productName. */
  shortName?: string;
  /** Reverse-DNS bundle id. Controls Application Support on macOS. */
  identifier?: string;
  /** src-tauri-relative folder with the Tauri icon set for this flavor. */
  iconDir?: string;
  enabledPacks?: string[];
  defaultEnabledPlugins?: string[];
}

/** Existing kitchen-sink / Re-markable Application Support folder. */
export const LEGACY_BUNDLE_IDENTIFIER = "com.markable.app";

export function flavorIdentifier(flavor: FlavorManifest): string {
  if (typeof flavor.identifier === "string" && flavor.identifier.trim() !== "") {
    return flavor.identifier.trim();
  }
  return LEGACY_BUNDLE_IDENTIFIER;
}

export function flavorProductName(flavor: FlavorManifest): string {
  if (typeof flavor.productName === "string" && flavor.productName.trim() !== "") {
    return flavor.productName.trim();
  }
  return flavor.displayName;
}

export function flavorShortName(flavor: FlavorManifest): string {
  if (typeof flavor.shortName === "string" && flavor.shortName.trim() !== "") {
    return flavor.shortName.trim();
  }
  return flavorProductName(flavor);
}

export interface PluginPack {
  displayName: string;
  plugins: string[];
  planned?: string[];
}

export interface PackCatalog {
  host: { description: string; modules: string[] };
  packs: Record<string, PluginPack>;
}

export const PACKS: PackCatalog = packCatalog;

const REGISTRY: Record<string, FlavorManifest> = {
  markable: markableManifest,
  remarkable: remarkableManifest,
  pkm: pkmManifest,
  project: projectManifest,
  diary: diaryManifest,
  quicknote: quicknoteManifest,
};

export function pluginsFromPacks(packIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const packId of packIds) {
    const pack = PACKS.packs[packId];
    if (pack === undefined) continue;
    for (const pluginId of pack.plugins) {
      if (seen.has(pluginId)) continue;
      seen.add(pluginId);
      out.push(pluginId);
    }
  }
  return out;
}

export function resolveFlavorFirstRunPlugins(flavor: FlavorManifest): string[] {
  if (flavor.defaultEnabledPlugins !== undefined && flavor.defaultEnabledPlugins.length > 0) {
    return flavor.defaultEnabledPlugins;
  }
  return pluginsFromPacks(flavor.enabledPacks ?? []);
}

export function getActiveFlavorId(): string {
  const fromEnv = import.meta.env.VITE_FLAVOR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  return "markable";
}

export function getActiveFlavor(): FlavorManifest {
  const id = getActiveFlavorId();
  const found = REGISTRY[id];
  if (found !== undefined) {
    return found;
  }
  return REGISTRY.markable;
}

export function defaultEnabledPluginSet(): ReadonlySet<string> {
  return new Set(resolveFlavorFirstRunPlugins(getActiveFlavor()));
}

export function flavorEnablesPack(packId: string): boolean {
  return (getActiveFlavor().enabledPacks ?? []).includes(packId);
}

/**
 * Window / title-bar label: document name plus the active flavor product.
 * Empty document label → product name only.
 */
export function flavorWindowTitle(documentLabel?: string): string {
  const product = flavorShortName(getActiveFlavor());
  const label = documentLabel?.trim() ?? "";
  if (label === "") return product;
  return `${label} — ${product}`;
}

/** Apply the flavor window title to document.title and the custom title bar. */
export function applyFlavorWindowTitle(documentLabel?: string): void {
  const title = flavorWindowTitle(documentLabel);
  document.title = title;
  const titleEl = document.getElementById("titlebar-title");
  if (titleEl) titleEl.textContent = title;
}
