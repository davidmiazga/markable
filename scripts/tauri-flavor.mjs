/**
 * Run the Tauri CLI with identifier + productName from flavors/<id>.json.
 *
 * Usage:
 *   node scripts/tauri-flavor.mjs markable dev
 *   node scripts/tauri-flavor.mjs remarkable dev
 *   node scripts/tauri-flavor.mjs pkm build
 *   VITE_FLAVOR=remarkable node scripts/tauri-flavor.mjs dev
 *
 * Named npm scripts: `npm run dev:markable`, `dev:remarkable`, `dev:pkm`,
 * `dev:project`, `dev:diary`, `dev:quicknote`.
 * `npm run tauri dev` still uses src-tauri/tauri.conf.json (com.markable.app).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function flavorFile(id) {
  return resolve(root, "flavors", `${id}.json`);
}

let flavorId = (process.env.VITE_FLAVOR ?? "").trim();
let command = argv;
if (argv[0] !== undefined && existsSync(flavorFile(argv[0]))) {
  flavorId = argv[0];
  command = argv.slice(1);
}
if (flavorId === "") {
  flavorId = "markable";
}
if (command.length === 0) {
  command = ["dev"];
}

const flavorPath = flavorFile(flavorId);
let flavor;
try {
  flavor = JSON.parse(readFileSync(flavorPath, "utf8"));
} catch (err) {
  console.error(`Unknown flavor "${flavorId}" (expected ${flavorPath})`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

function stringField(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

const identifier = stringField(flavor.identifier);
const productName =
  stringField(flavor.shortName) ||
  stringField(flavor.productName) ||
  stringField(flavor.displayName) ||
  "Markable";

if (identifier === "") {
  console.error(`Flavor "${flavorId}" is missing identifier`);
  process.exit(1);
}

const merge = {
  identifier,
  productName,
};

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
