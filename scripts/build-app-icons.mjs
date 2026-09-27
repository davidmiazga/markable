/**
 * Generate per-flavor Tauri icon sets from the 1024 SVG masters.
 *
 * Sources (first hit wins):
 *   1. src-tauri/icons/src/<flavor>.svg
 *   2. ../app-icon/app-icon-<master>.svg  (workspace Affinity exports)
 *
 * Run: node scripts/build-app-icons.mjs
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(root, "src-tauri/icons");
const srcDir = resolve(outRoot, "src");
const workspaceMasters = resolve(root, "../app-icon");

const FLAVORS = [
  { id: "markable", master: "app-icon-markable.svg" },
  { id: "remarkable", master: "app-icon-remarkable.svg" },
  { id: "pkm", master: "app-icon-markPKM.svg" },
  { id: "project", master: "app-icon-markProject.svg" },
  { id: "diary", master: "app-icon-markDiary.svg" },
  { id: "quicknote", master: "app-icon-markQuickNote.svg" },
  { id: "book", master: "app-icon-markStorybook.svg" },
];

mkdirSync(srcDir, { recursive: true });

const tauri = resolve(root, "node_modules/.bin/tauri");
if (!existsSync(tauri)) {
  console.error("node_modules/.bin/tauri not found — run npm install");
  process.exit(1);
}

for (const flavor of FLAVORS) {
  const destSvg = resolve(srcDir, `${flavor.id}.svg`);
  const workspaceSvg = resolve(workspaceMasters, flavor.master);
  if (existsSync(workspaceSvg)) {
    copyFileSync(workspaceSvg, destSvg);
  }
  if (!existsSync(destSvg)) {
    console.error(`Missing master for ${flavor.id}: ${destSvg}`);
    process.exit(1);
  }
  const outDir = resolve(outRoot, flavor.id);
  console.log(`[build-app-icons] ${flavor.id} ← ${flavor.master}`);
  const result = spawnSync(tauri, ["icon", destSvg, "-o", outDir], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[build-app-icons] all flavor icon sets generated");
