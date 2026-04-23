/**
 * Reference config for Markable core plugin IIFE bundles.
 *
 * NOTE: This file is a reference document. The actual build runs via
 * `scripts/build-plugins.mjs` (the programmatic Vite build API). Keep this file
 * in sync with that script — any plugin added to PLUGINS in build-plugins.mjs
 * must also appear in the export array below.
 *
 * Builds the fourteen built-in Markable plugins as self-contained IIFE `.js` files.
 * Each output is evaluated at runtime inside a sandboxed Function scope via:
 *
 *   const fn = new Function(source + "\nreturn __markablePlugin__;");
 *   const plugin = fn();
 *
 * Output directory: src-tauri/plugins/core/
 * Run with:         npm run build:plugins
 * Or automatically: npm run tauri build (via beforeBuildCommand in tauri.conf.json)
 *
 * Vite 6 constraint: IIFE format does not support multiple entry points in a
 * single lib build. This config exports an array of per-plugin configs —
 * Vite runs them sequentially. `emptyOutDir: true` is set only on the first
 * entry so the directory is cleared once before the builds run.
 *
 * Design constraints:
 *   EC-31: `external: [/^@codemirror\//]` — CM6 packages are marked external and
 *          accessed via window globals (cm-globals.ts). This prevents duplicate
 *          CM6 slot-ID namespaces that would make plugin extensions invisible.
 *   EC-30: Vite exits with a non-zero code if TypeScript or import errors exist,
 *          so CI catches broken builds before the app is packaged.
 *   EC-32: No import() calls in output; CSS injected via <style> tags in .plugin.ts.
 *
 * Why `name: "__markablePlugin__"`:
 *   Vite's IIFE format wraps the entry module as:
 *     var __markablePlugin__ = (function() { ...bundle... })();
 *   The loader extracts the plugin object by appending:
 *     "\nreturn __markablePlugin__;"
 *   to the source string before evaluating. All plugins share the same name
 *   because each file is evaluated in an isolated Function scope — no collisions.
 *
 * `inlineDynamicImports`:
 *   Set to true only for plugins that bundle large libraries with internal dynamic
 *   imports (e.g. Mermaid v11). IIFE format does not support code-splitting, so
 *   all dynamic import() calls must be inlined into the single output file.
 */

import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Build a single per-plugin Vite config.
 *
 * @param pluginName          - Kebab-case plugin id, used as output filename stem.
 * @param entryFile           - Absolute path to the .plugin.ts entry point.
 * @param clearOutput         - When true, the output directory is emptied before this
 *                              build runs. Set to true only for the first plugin.
 * @param inlineDynamicImports - When true, Rollup inlines all dynamic import() calls
 *                              into the IIFE. Required for Mermaid (diagrams plugin).
 */
function pluginConfig(
  pluginName: string,
  entryFile: string,
  clearOutput: boolean,
  inlineDynamicImports = false,
) {
  return defineConfig({
    build: {
      // Output files land in the Tauri resources directory so `tauri build`
      // picks them up via the `bundle.resources` entry in tauri.conf.json.
      outDir: "src-tauri/plugins/core",

      // Clear the output directory only on the first plugin build.
      // Subsequent builds append to the same directory without clearing.
      emptyOutDir: clearOutput,

      // No sourcemaps: IIFE files are evaluated via new Function(); source maps
      // are not consumed by any debugger in that sandbox context.
      sourcemap: false,

      lib: {
        entry: entryFile,

        // IIFE format: Vite wraps the entry as an immediately-invoked function
        // and assigns the result to the named global `__markablePlugin__`.
        formats: ["iife"],

        // The global variable name written by the IIFE wrapper:
        //   var __markablePlugin__ = (function() { ...bundle... })();
        // The loader appends "\nreturn __markablePlugin__;" before eval.
        name: "__markablePlugin__",

        // Output filename: plain "[pluginName].js" (not "[name].iife.js").
        fileName: () => `${pluginName}.js`,
      },

      rollupOptions: {
        // Bug #5 fix: mark all @codemirror/* packages as external.
        //
        // Previously EC-31 required bundling everything so there were no require()
        // calls in the IIFE output. However, bundling CM6 into each plugin creates
        // SEPARATE StateField slot-ID namespaces (one per IIFE), which are invisible
        // to the main app's CM6 instance. The result is that plugin extensions appear
        // registered but produce no observable effect.
        //
        // The fix is a two-part coordination:
        //   1. main.ts imports cm-globals.ts, which assigns the main app's CM6 module
        //      objects to window.__CM_STATE__ and window.__CM_VIEW__ before any plugin
        //      IIFE is evaluated.
        //   2. Plugin .plugin.ts files destructure from those globals instead of
        //      importing from @codemirror/* directly.
        //
        // With this change, Rollup emits NO import/require for @codemirror/* — the
        // plugin accesses the globals via `window.__CM_VIEW__` which is a plain
        // property access in the IIFE body. No require() calls are generated.
        external: [/^@codemirror\//],

        output: {
          // inlineDynamicImports: true is required when bundling libraries that
          // use internal dynamic import() (e.g. Mermaid v11). IIFE format does not
          // support code-splitting — all imports must be inlined into one file.
          // For all other plugins false keeps the output lean and split-free.
          inlineDynamicImports,
        },
      },
    },
  });
}

// Export an array of plugin configs. Vite processes each sequentially.
// Keep this list in sync with scripts/build-plugins.mjs PLUGINS array.
// The first config (focus-mode) clears the output directory before building;
// the rest append their output to the same directory.
export default [
  pluginConfig(
    "focus-mode",
    resolve(__dirname, "src/plugins/focus-mode/focus-mode.plugin.ts"),
    true, // clear output directory before this first build
  ),
  pluginConfig(
    "typewriter-mode",
    resolve(__dirname, "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"),
    false,
  ),
  pluginConfig(
    "word-count",
    resolve(__dirname, "src/plugins/word-count/word-count.plugin.ts"),
    false,
  ),
  pluginConfig(
    "auto-toc",
    resolve(__dirname, "src/plugins/auto-toc/auto-toc.plugin.ts"),
    false,
  ),
  pluginConfig(
    "markdown-toolbar",
    resolve(__dirname, "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"),
    false,
  ),
  pluginConfig(
    "backlinks",
    resolve(__dirname, "src/plugins/backlinks/backlinks.plugin.ts"),
    false,
  ),
  pluginConfig(
    "templates",
    resolve(__dirname, "src/plugins/templates/templates.plugin.ts"),
    false,
  ),
  pluginConfig(
    "yaml-pane",
    resolve(__dirname, "src/plugins/yaml-pane/yaml-pane.plugin.ts"),
    false,
  ),
  pluginConfig(
    "math",
    resolve(__dirname, "src/plugins/math/math.plugin.ts"),
    false,
  ),
  pluginConfig(
    "media-preview",
    resolve(__dirname, "src/plugins/media-preview/media-preview.plugin.ts"),
    false,
  ),
  pluginConfig(
    "command-bar",
    resolve(__dirname, "src/plugins/command-bar/command-bar.plugin.ts"),
    false,
  ),
  // FC2 #9: Mermaid bundles ~2.5 MB and has internal dynamic imports.
  // inlineDynamicImports: true is required for IIFE format compatibility.
  pluginConfig(
    "diagrams",
    resolve(__dirname, "src/plugins/diagrams/diagrams.plugin.ts"),
    false,
    true, // inlineDynamicImports
  ),
  // FC2 #15: Insert Count — no dynamic imports.
  pluginConfig(
    "insert-count",
    resolve(__dirname, "src/plugins/insert-count/insert-count.plugin.ts"),
    false,
  ),
  // FC2 Auto-Save — no dynamic imports; debounce + blur listener, no CM6 StateField.
  pluginConfig(
    "auto-save",
    resolve(__dirname, "src/plugins/auto-save/auto-save.plugin.ts"),
    false,
  ),
  // Daily Note — no dynamic imports; no CM6 StateField in Step 03 (Steps 04–05 will add).
  pluginConfig(
    "daily-note",
    resolve(__dirname, "src/plugins/daily-note/daily-note.plugin.ts"),
    false,
  ),
];
