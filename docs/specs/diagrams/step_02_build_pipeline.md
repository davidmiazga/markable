---
title: "Step 02 — Build Pipeline: Mermaid npm install + PLUGINS array"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 02: Build Pipeline

**Requirement:** FR-09.1, FR-10.5 (Build pipeline registration), AD-01 (IIFE plugin pattern)
**Files modified:** `package.json`, `scripts/build-plugins.mjs`

---

## Goal

Install the Mermaid npm package and register the diagrams plugin in the build pipeline so that `npm run build:plugins` produces `src-tauri/plugins/core/diagrams.js`. This step is a prerequisite for all subsequent steps; the plugin file cannot be built without it.

---

## Files to Modify

1. `package.json` — add `mermaid` to `dependencies`
2. `scripts/build-plugins.mjs` — add `["diagrams", "src/plugins/diagrams/diagrams.plugin.ts"]` to `PLUGINS`

---

## Implementation Instructions

### Task 2.1: Install Mermaid

Run from the project root:

```bash
npm install mermaid
```

This adds `mermaid` to `dependencies` in `package.json` and updates `package-lock.json`. Accept whatever version `npm` resolves (must be 11.x or later). After installing, verify:

```bash
npm list mermaid
```

Expected output (or newer minor):

```
markable-2.0@... /path/to/markable-2.0
└── mermaid@11.x.x
```

Do not pin an exact patch version in this step — leave npm's resolved version in `package-lock.json`.

### Task 2.2: Register in PLUGINS array

Open `scripts/build-plugins.mjs`. The `PLUGINS` array currently ends with `"command-bar"`. Append the diagrams entry as the last item:

```js
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
  ["diagrams",          "src/plugins/diagrams/diagrams.plugin.ts"],  // FC2 #9
];
```

### Task 2.3: Verify the build compiles

After step_03 creates the plugin scaffold, run:

```bash
npm run build:plugins
```

The final line of output must read:

```
[build-plugins] All 12 core plugins built successfully.
```

And the output file must exist:

```bash
ls -lh src-tauri/plugins/core/diagrams.js
```

Expected output: a file larger than 2 MB (Mermaid bundled) and smaller than 5 MB.

Note: The build in step_02 cannot be fully verified until step_03 creates the `diagrams.plugin.ts` scaffold. Run `npm run build:plugins` again after step_03 completes.

---

## Rollup / Vite external handling

`build-plugins.mjs` marks `@codemirror/*` as external. Mermaid is NOT in the external list and must be bundled entirely into the IIFE (EC-31 requires self-containment). The `external: [/^@codemirror\//]` rule in `rollupOptions` does not affect Mermaid — it will be inlined by Rollup.

Mermaid has no `@codemirror/*` dependencies, so no conflicts arise.

---

## Bundle size note

Mermaid 11.x minified is approximately 2.5–2.8 MB. With the 5 MB core cap from step_01, `diagrams.js` loads successfully. Vite may emit a warning about large chunks during build:

```
(!) Some chunks are larger than 500 kBs after minification.
```

This warning is expected and acceptable — it refers to the Mermaid bundle. Do not attempt to suppress it with `build.chunkSizeWarningLimit` changes; it is informational only and does not affect correctness.

---

## Acceptance Criteria

- [ ] `npm install mermaid` completes without errors
- [ ] `npm list mermaid` shows version 11.x or newer
- [ ] `scripts/build-plugins.mjs` PLUGINS array contains `["diagrams", "src/plugins/diagrams/diagrams.plugin.ts"]` as the last entry
- [ ] After step_03 scaffold is in place: `npm run build:plugins` reports 12 plugins built
- [ ] After step_03: `src-tauri/plugins/core/diagrams.js` exists and is between 2 MB and 5 MB
- [ ] No other PLUGINS entries are modified or reordered

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | MODIFY (via npm) | Add mermaid dependency |
| `package-lock.json` | MODIFY (via npm) | Lock mermaid version |
| `scripts/build-plugins.mjs` | MODIFY | Register diagrams in PLUGINS array |
