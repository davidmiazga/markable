/**
 * Run the Tauri CLI with identifier + productName from flavors/<id>.json.
 *
 * Usage:
 *   node scripts/tauri-flavor.mjs dev
 *   VITE_FLAVOR=remarkable node scripts/tauri-flavor.mjs dev
 *   VITE_FLAVOR=knowledgebank node scripts/tauri-flavor.mjs build
 *
 * `npm run tauri dev` still uses src-tauri/tauri.conf.json (com.markable.app)
 * so existing Application Support data is not moved.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flavorId = (process.env.VITE_FLAVOR ?? "markable").trim() || "markable";
const flavorPath = resolve(root, "flavors", `${flavorId}.json`);

let flavor;
try {
  flavor = JSON.parse(readFileSync(flavorPath, "utf8"));
} catch (err) {
  console.error(`Unknown flavor "${flavorId}" (expected ${flavorPath})`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const identifier = typeof flavor.identifier === "string" ? flavor.identifier : "";
const productName =
  typeof flavor.productName === "string"
    ? flavor.productName
    : typeof flavor.displayName === "string"
      ? flavor.displayName
      : "Markable";

if (identifier === "") {
  console.error(`Flavor "${flavorId}" is missing identifier`);
  process.exit(1);
}

const merge = {
  identifier,
  productName,
};

const tauriArgs = process.argv.slice(2);
const command = tauriArgs.length > 0 ? tauriArgs : ["dev"];

console.log(`[tauri-flavor] ${flavorId} → ${identifier} (${productName})`);

const child = spawn(
  "npm",
  ["exec", "--", "tauri", ...command, "--config", JSON.stringify(merge)],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_FLAVOR: flavorId },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
