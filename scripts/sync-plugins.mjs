/**
 * Sync built core plugins to the dev Application Support directory.
 *
 * Unlike `cp src-tauri/plugins/core/*.js ~/Library/.../plugins/core/`,
 * this script removes stale files from the destination that are no longer
 * in the source — the same cleanup that `copy_core_plugins` does in production.
 *
 * Also cleans Tauri's target/debug and target/release resource caches, which
 * Tauri populates on `tauri dev` / `tauri build` from bundle.resources globs.
 * These target dirs are never auto-cleaned by Tauri when a resource is removed
 * from the source — stale files there get re-copied into Application Support
 * on the next launch when the version stamp changes.
 *
 * Run via: npm run sync:plugins
 *
 * Typical dev workflow:
 *   npm run build:plugins   ← rebuild all plugin bundles
 *   npm run sync:plugins    ← clean-sync to Application Support + Tauri target caches
 */

import { readdirSync, rmSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "src-tauri/plugins/core");
const dst = join(
  homedir(),
  "Library/Application Support/com.markable.app/plugins/core"
);

// Tauri target resource caches — populated during `tauri dev` / `tauri build`.
// Stale files here survive until explicitly removed.
const tauriCacheDirs = [
  resolve(root, "src-tauri/target/debug/plugins/core"),
  resolve(root, "src-tauri/target/release/plugins/core"),
];

mkdirSync(dst, { recursive: true });

// Build set of source filenames.
const srcFiles = new Set(
  readdirSync(src).filter((f) => f.endsWith(".js"))
);

// Helper: remove stale .js files from a directory that aren't in srcFiles.
function cleanStaleFrom(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    if (!srcFiles.has(f)) {
      console.log(`Removing stale from ${dir.replace(root + "/", "")}: ${f}`);
      rmSync(join(dir, f));
    }
  }
}

// Clean Tauri target caches first (prevents them from re-polluting App Support on launch).
for (const cacheDir of tauriCacheDirs) {
  cleanStaleFrom(cacheDir);
}

// Remove stale files in Application Support destination.
for (const f of readdirSync(dst).filter((f) => f.endsWith(".js"))) {
  if (!srcFiles.has(f)) {
    console.log(`Removing stale from App Support: ${f}`);
    rmSync(join(dst, f));
  }
}

// Copy all source files → destination (overwrite).
for (const f of srcFiles) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`Copied: ${f}`);
}

console.log(`\n[sync:plugins] ${srcFiles.size} plugins synced to:\n  ${dst}`);
