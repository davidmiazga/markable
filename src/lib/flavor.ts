/**
 * Active product flavor — first-run defaults, not capability limits.
 *
 * Packs live in /flavors/packs.json. Flavor files choose packs and may
 * override the first-run plugin list (Re-markable kitchen-sink stub).
 */

import packCatalog from "../../flavors/packs.json";
import markableManifest from "../../flavors/markable.json";
import remarkableManifest from "../../flavors/remarkable.json";
import knowledgebankManifest from "../../flavors/knowledgebank.json";

export interface FlavorManifest {
  id: string;
  displayName: string;
  productName?: string;
  /** Reverse-DNS bundle id. Controls Application Support on macOS. */
  identifier?: string;
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
  knowledgebank: knowledgebankManifest,
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

/**
 * Today’s kitchen-sink first-run set from the Re-markable stub override.
 * Existing `com.markable.app` installs use this until a real migration exists.
 */
export const LEGACY_KITCHEN_SINK_PLUGINS: readonly string[] =
  resolveFlavorFirstRunPlugins(remarkableManifest);

export function defaultEnabledPluginsForProductLine(
  productLine: string | undefined,
): ReadonlySet<string> {
  if (productLine === "legacy-kitchen-sink") {
    return new Set(LEGACY_KITCHEN_SINK_PLUGINS);
  }
  return defaultEnabledPluginSet();
}
