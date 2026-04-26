/**
 * Reset default themes and verify font installation.
 *
 * Run via: npm run reset:themes
 *
 * Useful when switching to a new dev machine or when themes/fonts get into a
 * broken state. Does three things:
 *
 *   1. Copies all default theme CSS files from themes/ → Application Support.
 *   2. Checks that @fontsource/inter is installed in node_modules; prints a
 *      reminder to run `npm install` if it is missing.
 *   3. Prints the current active theme from settings.json and how to reset it.
 *
 * User-created theme files are never deleted. Only default themes are written.
 */

import { readdirSync, copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── 1. Sync default themes ────────────────────────────────────────────────────

const themeSrc = resolve(root, "src-tauri/themes");
const themeDst = join(homedir(), "Library/Application Support/com.markable.app/themes");
mkdirSync(themeDst, { recursive: true });

const themeFiles = readdirSync(themeSrc).filter((f) => f.endsWith(".css"));
console.log("\n[reset:themes] Syncing default themes…");
for (const f of themeFiles) {
  copyFileSync(join(themeSrc, f), join(themeDst, f));
  console.log(`  ✓ ${f}`);
}
console.log(`  → ${themeFiles.length} theme(s) written to:\n    ${themeDst}`);

// ── 2. Verify Inter font ──────────────────────────────────────────────────────

console.log("\n[reset:themes] Checking Inter font…");
const fontDir = resolve(root, "node_modules/@fontsource/inter");
if (existsSync(fontDir) && existsSync(join(fontDir, "400.css"))) {
  console.log("  ✓ @fontsource/inter is installed");
} else {
  console.log("  ✗ @fontsource/inter is MISSING — run: npm install");
  process.exitCode = 1;
}

// ── 3. Report / optionally reset active theme ─────────────────────────────────

console.log("\n[reset:themes] Checking settings.json…");
const settingsPath = join(
  homedir(),
  "Library/Application Support/com.markable.app/settings.json"
);

if (!existsSync(settingsPath)) {
  console.log("  settings.json not found — will be created on first launch");
} else {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    const active = settings?.theme?.active ?? "(not set)";
    console.log(`  Active theme: ${active}`);

    // If --reset flag passed, rewrite theme to default-dark
    if (process.argv.includes("--reset-theme")) {
      settings.theme = { active: "default-dark", fallback: "default-dark" };
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log("  ✓ Active theme reset to default-dark");
    } else {
      console.log('  Tip: pass --reset-theme to set active theme back to "default-dark"');
    }
  } catch (e) {
    console.log(`  ✗ Could not parse settings.json: ${e.message}`);
  }
}

console.log("\n[reset:themes] Done.\n");
