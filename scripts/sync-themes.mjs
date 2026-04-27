/**
 * Sync bundled default themes from themes/ → Application Support.
 *
 * Run via: npm run sync:themes
 *
 * This copies the default .css theme files that ship with the repo into the
 * user-facing themes directory so they appear in the theme picker. Existing
 * user-created themes are never deleted — only the repo's defaults are written.
 */

import { readdirSync, copyFileSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "src-tauri/themes");
const dst = join(homedir(), "Library/Application Support/com.markable.app/themes");

mkdirSync(dst, { recursive: true });

const files = readdirSync(src).filter((f) => f.endsWith(".css"));

for (const f of files) {
  copyFileSync(join(src, f), join(dst, f));
  console.log(`  Copied: ${f}`);
}

console.log(`\n[sync:themes] ${files.length} theme(s) synced to:\n  ${dst}`);
