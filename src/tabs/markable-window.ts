/**
 * markable-window.ts — Open a vault file in a second Markable window.
 *
 * Creates a WebviewWindow that loads the same app with an `html` query
 * parameter. Closing that window is left to the OS; this module never
 * closes or destroys the current window.
 */

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Query parameter that names the HTML file to open. */
export const HTML_OPEN_QUERY = "html";

/** Visual options copied from the main window in src-tauri/tauri.conf.json. */
const MARKABLE_WINDOW_OPTIONS = {
  title: "Markable",
  width: 800,
  height: 600,
  // JS TitleBarStyle is lowercase; tauri.conf.json uses "Overlay".
  titleBarStyle: "overlay" as const,
  hiddenTitle: true,
  backgroundColor: [30, 30, 30, 255] as [number, number, number, number],
};

let nextWindowSequence = 0;

/**
 * Label for a secondary window. Starts with `markable-` so it cannot
 * collide with the primary `main` window label.
 */
function nextMarkableLabel(): string {
  nextWindowSequence += 1;
  return `markable-${nextWindowSequence}`;
}

/**
 * Read the `html` query parameter from a `location.search` string.
 *
 * @returns The decoded parameter when it is a non-empty string, otherwise null.
 */
export function readHtmlOpenQuery(search: string): string | null {
  const value = new URLSearchParams(search).get(HTML_OPEN_QUERY);
  if (value === null || value === "") return null;
  return value;
}

/**
 * Open `filePath` in a new Markable window. The current window stays open.
 */
export async function openInNewMarkableWindow(filePath: string): Promise<void> {
  const label = nextMarkableLabel();
  new WebviewWindow(label, {
    url: `index.html?${HTML_OPEN_QUERY}=${encodeURIComponent(filePath)}`,
    ...MARKABLE_WINDOW_OPTIONS,
  });
}
