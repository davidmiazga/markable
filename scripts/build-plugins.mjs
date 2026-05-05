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
 * Each entry: [outputFileStem, relativePathToEntry, extraOptions?]
 *   extraOptions.inlineDynamicImports — set true for plugins that bundle large
 *   libraries with their own internal dynamic imports (e.g. Mermaid). When true,
 *   Rollup inlines all dynamic import() calls into the IIFE output, which is
 *   required because IIFE format does not support code-splitting (EC-31).
 * The first entry triggers the output directory clear (emptyOutDir: true).
 */
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
  ["backlinks",         "src/plugins/backlinks/backlinks.plugin.ts"],
  ["templates",         "src/plugins/templates/templates.plugin.ts"],
  ["yaml-pane",         "src/plugins/yaml-pane/yaml-pane.plugin.ts"],
  ["math",              "src/plugins/math/math.plugin.ts"],
  ["media-preview",     "src/plugins/media-preview/media-preview.plugin.ts"],
  ["command-bar",       "src/plugins/command-bar/command-bar.plugin.ts"],
  // FC2 #9: Mermaid bundles ~2.5 MB and has internal dynamic imports.
  // inlineDynamicImports: true is required for IIFE format compatibility.
  ["diagrams",          "src/plugins/diagrams/diagrams.plugin.ts", { inlineDynamicImports: true }],
  // FC2 #15: Insert Count — no dynamic imports; no inlineDynamicImports needed.
  ["insert-count",      "src/plugins/insert-count/insert-count.plugin.ts"],
  // FC2 Auto-Save — no dynamic imports; debounce + blur listener, no CM6 StateField.
  ["auto-save",         "src/plugins/auto-save/auto-save.plugin.ts"],
  // Daily Note — no dynamic imports; no CM6 StateField in Step 03 (Steps 04–05 will add).
  ["daily-note",        "src/plugins/daily-note/daily-note.plugin.ts"],
  // PKM Step 02a: File Browser — read-only vault file tree, no CM6 StateField.
  ["file-browser",      "src/plugins/file-browser/file-browser.plugin.ts"],
  // PKM Step 03: Knowledge Graph — D3 force-directed graph, no dynamic imports.
  ["knowledge-graph",   "src/plugins/knowledge-graph/knowledge-graph.plugin.ts"],
  // Outline Panel — live heading tree with bidirectional fold sync.
  ["outline-panel",     "src/plugins/outline-panel/outline-panel.plugin.ts"],
  // Auto Title — derives filename from H1 heading on first save of a new file.
  ["auto-title",        "src/plugins/auto-title/auto-title.plugin.ts"],
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
 * @param {string}  name      - Output filename stem (e.g. "focus-mode" → "focus-mode.js")
 * @param {string}  entryPath - Relative path from project root to the .plugin.ts file
 * @param {object}  [extra]   - Optional per-plugin overrides:
 *   extra.inlineDynamicImports {boolean} — when true, Rollup inlines all dynamic
 *     import() calls into the IIFE. Required for plugins that bundle libraries
 *     (e.g. Mermaid) that use internal dynamic imports. IIFE format does not
 *     support code-splitting, so any dynamic import must be inlined (EC-31).
 */
async function buildPlugin(name, entryPath, extra = {}) {
  const entry = resolve(root, entryPath);
  console.log(`Building ${name}.js ...`);

  // inlineDynamicImports defaults to false (no-op for most plugins).
  // Set to true for plugins whose bundled dependencies use dynamic imports.
  const inlineDynamicImports = extra.inlineDynamicImports ?? false;

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
          // inlineDynamicImports: true is required when bundling libraries that
          // use internal dynamic import() (e.g. Mermaid). IIFE format does not
          // support code-splitting — all imports must be inlined into one file.
          // For all other plugins false keeps the output identical to before.
          inlineDynamicImports,
        },
      },
    },
  });

  console.log(`  -> ${name}.js done`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

clearOutputDir();

let failed = false;

for (const [name, entry, extra] of PLUGINS) {
  try {
    await buildPlugin(name, entry, extra);
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

console.log(`\n[build-plugins] All ${PLUGINS.length} core plugins built successfully.`);
