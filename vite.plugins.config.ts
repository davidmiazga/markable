/**
 * Vite build configuration for core plugin IIFE bundles.
 *
 * Builds the six built-in Markable plugins as self-contained IIFE `.js` files.
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
 * single lib build. This config exports an array of six per-plugin configs —
 * Vite runs them sequentially. `emptyOutDir: true` is set only on the first
 * entry so the directory is cleared once before the six builds run.
 *
 * Design constraints:
 *   EC-31: `external: []` — NO packages may be externalized. Every @codemirror/*
 *          dependency is bundled into the IIFE. If an import were externalized,
 *          the output would contain a require() call that throws at eval time.
 *   EC-30: Vite exits with a non-zero code if TypeScript or import errors exist,
 *          so CI catches broken builds before the app is packaged.
 *   EC-32: No import() calls in output; CSS injected via <style> tags in .plugin.ts.
 *
 * Why `name: "__markablePlugin__"`:
 *   Vite's IIFE format wraps the entry module as:
 *     var __markablePlugin__ = (function() { ...bundle... })();
 *   The loader extracts the plugin object by appending:
 *     "\nreturn __markablePlugin__;"
 *   to the source string before evaluating. All four plugins share the same name
 *   because each file is evaluated in an isolated Function scope — no collisions.
 */

import { defineConfig } from "vite";
import { resolve } from "path";

/**
 * Build a single per-plugin Vite config.
 *
 * @param pluginName  - Kebab-case plugin id, used as output filename stem.
 * @param entryFile   - Absolute path to the .plugin.ts entry point.
 * @param clearOutput - When true, the output directory is emptied before this
 *                      build runs. Set to true only for the first plugin so the
 *                      directory is cleared exactly once per `npm run build:plugins`.
 */
function pluginConfig(
  pluginName: string,
  entryFile: string,
  clearOutput: boolean,
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
          // Disable code splitting — each plugin is a single self-contained file.
          // Dynamic imports are not supported inside the Function sandbox.
          inlineDynamicImports: false,
          // No global variable mappings needed: plugins consume @codemirror exports
          // via the window.__CM_STATE__ / window.__CM_VIEW__ property accesses in
          // their source, not via bare @codemirror/* import specifiers in the bundle.
        },
      },
    },
  });
}

// Export an array of plugin configs. Vite processes each sequentially.
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
    "status-bar",
    resolve(__dirname, "src/plugins/status-bar/status-bar.plugin.ts"),
    false,
  ),
  pluginConfig(
    "markdown-toolbar",
    resolve(__dirname, "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"),
    false,
  ),
  pluginConfig(
    "table-toolbar",
    resolve(__dirname, "src/plugins/table-toolbar/table-toolbar.plugin.ts"),
    false,
  ),
  pluginConfig(
    "image-toolbar",
    resolve(__dirname, "src/plugins/image-toolbar/image-toolbar.plugin.ts"),
    false,
  ),
  pluginConfig(
    "templates",
    resolve(__dirname, "src/plugins/templates/templates.plugin.ts"),
    false,
  ),
];
