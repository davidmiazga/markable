/**
 * Sync built core plugins to every flavor Application Support directory.
 *
 * Reads identifiers from flavors/*.json (plus com.markable.app if missing).
 * Removes stale .js files the same way `copy_core_plugins` does in production.
 *
 * Also cleans Tauri's target/debug and target/release resource caches, which
 * Tauri populates on `tauri dev` / `tauri build` from bundle.resources globs.
 *
 * Run via: npm run sync:plugins
 */

import { readdirSync, rmSync, copyFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "src-tauri/plugins/core");
const flavorsDir = resolve(root, "flavors");
const LEGACY_IDENTIFIER = "com.markable.app";

function flavorIdentifiers() {
  const ids = new Set([LEGACY_IDENTIFIER]);
  if (!existsSync(flavorsDir)) return [...ids];
  for (const name of readdirSync(flavorsDir)) {
    if (!name.endsWith(".json") || name === "packs.json") continue;
    let flavor;
    try {
      flavor = JSON.parse(readFileSync(join(flavorsDir, name), "utf8"));
    } catch {
      continue;
    }
    if (typeof flavor.identifier === "string" && flavor.identifier.trim() !== "") {
      ids.add(flavor.identifier.trim());
    }
  }
  return [...ids];
}

function appSupportPluginsDir(identifier) {
  return join(homedir(), "Library/Application Support", identifier, "plugins/core");
}

const tauriCacheDirs = [
  resolve(root, "src-tauri/target/debug/plugins/core"),
  resolve(root, "src-tauri/target/release/plugins/core"),
];

if (!existsSync(src)) {
  console.error(`[sync:plugins] missing ${src} — run npm run build:plugins first`);
  process.exit(1);
}

const srcFiles = new Set(readdirSync(src).filter((f) => f.endsWith(".js")));

function cleanStaleFrom(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((file) => file.endsWith(".js"))) {
    if (!srcFiles.has(f)) {
      console.log(`Removing stale from ${dir.replace(root + "/", "")}: ${f}`);
      rmSync(join(dir, f));
    }
  }
}

for (const cacheDir of tauriCacheDirs) {
  cleanStaleFrom(cacheDir);
}

const destinations = flavorIdentifiers().map(appSupportPluginsDir);
const synced = [];

for (const dst of destinations) {
  mkdirSync(dst, { recursive: true });
  cleanStaleFrom(dst);
  for (const f of srcFiles) {
    copyFileSync(join(src, f), join(dst, f));
  }
  synced.push(dst);
}

console.log(`[sync:plugins] ${srcFiles.size} plugins synced to ${synced.length} Application Support dirs:`);
for (const dst of synced) {
  console.log(`  ${dst}`);
}
