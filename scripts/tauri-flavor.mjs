/**
 * Run the Tauri CLI with identifier + productName from flavors/<id>.json.
 *
 * Usage:
 *   node scripts/tauri-flavor.mjs markable dev
 *   node scripts/tauri-flavor.mjs remarkable dev
 *   node scripts/tauri-flavor.mjs pkm build
 *   VITE_FLAVOR=remarkable node scripts/tauri-flavor.mjs dev
 *
 * Named npm scripts: `npm run dev:markable` / `bundle:markable` (and the
 * other flavor ids). `just bundle markable` is the same as bundle:markable.
 * `npm run tauri dev` still uses src-tauri/tauri.conf.json (com.markable.app).
 */

import { execFileSync, spawn } from "node:child_process";
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

const tauriCommand = [];
const appArgs = [];
let passToApp = false;
const opensFolder = command[0] === "dev";
for (const arg of command) {
  if (passToApp || arg === "--") {
    if (arg !== "--") appArgs.push(arg);
    passToApp = true;
    continue;
  }
  if (opensFolder && tauriCommand.length > 0 && !arg.startsWith("-")) {
    appArgs.push(arg);
    continue;
  }
  tauriCommand.push(arg);
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

const iconDir =
  stringField(flavor.iconDir) || `icons/${flavorId}`;
const merge = {
  identifier,
  productName,
  build: {
    beforeBuildCommand: `VITE_FLAVOR=${flavorId} npm run build:plugins && VITE_FLAVOR=${flavorId} npm run build`,
  },
  bundle: {
    icon: [
      `${iconDir}/32x32.png`,
      `${iconDir}/128x128.png`,
      `${iconDir}/128x128@2x.png`,
      `${iconDir}/icon.icns`,
      `${iconDir}/icon.ico`,
    ],
  },
};

console.log(`[tauri-flavor] ${flavorId} → ${identifier} (${productName}) icons ${iconDir}`);

if (tauriCommand.includes("dev")) {
  let stopped = false;
  try {
    const listeners = execFileSync("lsof", ["-nP", "-iTCP:1420", "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    for (const pid of listeners.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
        stopped = true;
        console.log("[tauri-flavor] Stopped the dev server already using port 1420");
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* port is free */
  }
  if (stopped) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        execFileSync("lsof", ["-nP", "-iTCP:1420", "-sTCP:LISTEN", "-t"], { stdio: "ignore" });
      } catch {
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

const child = spawn(
  "npm",
  ["exec", "--", "tauri", ...tauriCommand, "--config", JSON.stringify(merge), "--", ...appArgs],
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
