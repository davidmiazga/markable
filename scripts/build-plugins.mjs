/**
 * Build script for Markable core plugin IIFE bundles.
 *
 * Vite 6 does not support exporting an array of configs from a single config file,
 * and IIFE format does not support multiple entry points in one lib build.
 * This script calls Vite's programmatic build() API sequentially — one call per
 * plugin — to produce four IIFE .js files in src-tauri/plugins/core/.
 *
 * Run via: npm run build:plugins  (which calls: node scripts/build-plugins.mjs)
 *
 * Each plugin is built with:
 *   - format: "iife"
 *   - name: "__markablePlugin__"  (so loader can append "\nreturn __markablePlugin__;")
 *   - external: []                (EC-31: all @codemirror/* deps bundled, no require())
 *   - sourcemap: false            (IIFE eval context; maps are not consumed)
 *
 * EC-30: This script exits with a non-zero code if any build fails.
 * EC-31: No externals — every dependency is bundled into the IIFE.
 * EC-32: No dynamic imports; CSS injected via <style> tags in .plugin.ts files.
 */

import { build } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { rmSync, mkdirSync } from "fs";

// Resolve project root from this script's location (scripts/ is one level down).
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
// Tauri resource globs in tauri.conf.json are relative to src-tauri/.
// The `bundle.resources` entry "plugins/core/*" resolves to src-tauri/plugins/core/*.
// This mirrors how `help/*` maps to src-tauri/help/*.
const outDir = resolve(root, "src-tauri/plugins/core");

/**
 * Ordered list of plugins to build.
 * Each entry: [outputFileStem, relativePathToEntry]
 * The first entry triggers the output directory clear (emptyOutDir: true).
 */
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["status-bar",        "src/plugins/status-bar/status-bar.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
  ["table-toolbar",     "src/plugins/table-toolbar/table-toolbar.plugin.ts"],
  ["image-toolbar",     "src/plugins/image-toolbar/image-toolbar.plugin.ts"],
];

/**
 * Clear and recreate the output directory before the first build.
 * Subsequent builds append to the same directory (emptyOutDir: false).
 */
function clearOutputDir() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
}

/**
 * Build a single plugin as a self-contained IIFE bundle.
 *
 * @param {string} name      - Output filename stem (e.g. "focus-mode" → "focus-mode.js")
 * @param {string} entryPath - Relative path from project root to the .plugin.ts file
 */
async function buildPlugin(name, entryPath) {
  const entry = resolve(root, entryPath);
  console.log(`Building ${name}.js ...`);

  await build({
    root,
    logLevel: "warn",
    build: {
      outDir,
      // Never clear the dir from within individual builds — we manage clearing above.
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry,
        formats: ["iife"],
        // Global variable name written by the IIFE wrapper:
        //   var __markablePlugin__ = (function() { ...bundle... })();
        // Loader appends "\nreturn __markablePlugin__;" before eval.
        name: "__markablePlugin__",
        // Plain "[name].js" — avoids Vite's default "[name].iife.js" suffix.
        fileName: () => `${name}.js`,
      },
      rollupOptions: {
        // Bug #5 fix: mark all @codemirror/* packages as external.
        //
        // Previously every dependency was bundled (EC-31). Bundling CM6 into each
        // plugin creates a separate StateField slot-ID namespace per IIFE, making
        // plugin extensions invisible to the main editor's CM6 instance.
        //
        // The fix is a two-part coordination (see vite.plugins.config.ts comments
        // and src/lib/cm-globals.ts for the full rationale):
        //   1. main.ts exposes the main app's CM6 objects on window globals.
        //   2. Plugin files access CM6 via those globals — no @codemirror/* imports.
        //
        // With this external rule, Rollup emits no import/require for @codemirror/*
        // in the IIFE output. The plugins use plain window property accesses instead,
        // which are safe inside the new Function() sandbox at runtime.
        external: [/^@codemirror\//],
        output: {
          // Each plugin is a single file — no code splitting.
          inlineDynamicImports: false,
        },
      },
    },
  });

  console.log(`  -> ${name}.js done`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

clearOutputDir();

let failed = false;

for (const [name, entry] of PLUGINS) {
  try {
    await buildPlugin(name, entry);
  } catch (err) {
    // EC-30: Report the failure and continue building remaining plugins so
    // the developer sees all errors in one run. Exit code will be non-zero.
    console.error(`\n[build-plugins] ERROR building ${name}.js:`, err);
    failed = true;
  }
}

if (failed) {
  console.error("\n[build-plugins] One or more plugin builds failed.");
  process.exit(1);
}

console.log("\n[build-plugins] All 8 core plugins built successfully.");
