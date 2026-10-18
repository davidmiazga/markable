/**
 * Footer trash can for Data Protection.
 *
 * Shown only when Data Protection → Show trash icon is on. A closed can
 * means the recovery queue is empty. An open can means notes are waiting.
 * Click reveals the copies in Finder. Command-click or Control-click opens
 * Data Protection settings.
 */

import { invoke } from "@tauri-apps/api/core";
import "./trash-footer.css";
import { resolveDataProtection, type RecoveredNote } from "./data-protection";
import { getCurrentSettings } from "./settings";
import { openSettingsPanel } from "../settings/settings-panel";

const BUTTON_ID = "trash-footer-btn";
const CLOSED_CAN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h6v2H9z"/><path d="M5 8h14"/><path d="M7 8h10v12H7z"/></svg>`;
const OPEN_CAN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7l5-4h7l2 3"/><path d="M5 9h14"/><path d="M7 9h10v11H7z"/><path d="M10 13h4M10 16h4"/></svg>`;

let poll: ReturnType<typeof setInterval> | null = null;
let mounted = false;

function footerSlot(): HTMLElement | null {
  return document.querySelector(".statusbar-right");
}

function stopPolling(): void {
  if (poll !== null) {
    clearInterval(poll);
    poll = null;
  }
}

function releaseStatusBar(): void {
  const bar = document.getElementById("statusbar");
  if (!bar) return;
  if (bar.dataset.trashFooterShown === "1") {
    bar.classList.add("hidden");
    delete bar.dataset.trashFooterShown;
  }
}

async function queueCount(): Promise<number> {
  try {
    const notes = await invoke<RecoveredNote[]>("list_recovered_notes");
    return Array.isArray(notes) ? notes.length : 0;
  } catch {
    return 0;
  }
}

async function paintCan(button: HTMLButtonElement): Promise<void> {
  const count = await queueCount();
  const full = count > 0;
  button.dataset.trashState = full ? "full" : "empty";
  button.innerHTML = full ? OPEN_CAN : CLOSED_CAN;
  button.setAttribute("aria-label", full ? "Trash has notes" : "Trash is empty");
  button.title = full
    ? "Trash has notes. Click to show them in Finder. Command-click opens Data Protection."
    : "Trash is empty. Click to show the folder in Finder. Command-click opens Data Protection.";
}

function onTrashClick(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    openSettingsPanel("data-protection");
    return;
  }
  void invoke("reveal_recovered_notes");
}

/** Show or hide the footer trash can from the current Data Protection preference. */
export function syncTrashFooter(): void {
  const slot = footerSlot();
  const bar = document.getElementById("statusbar");
  const show = resolveDataProtection(getCurrentSettings().dataProtection).showTrashIcon;
  if (!slot || !bar || !show) {
    document.getElementById(BUTTON_ID)?.remove();
    releaseStatusBar();
    stopPolling();
    return;
  }

  if (bar.classList.contains("hidden")) {
    bar.classList.remove("hidden");
    bar.dataset.trashFooterShown = "1";
  }

  let button = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "trash-footer-btn";
    button.addEventListener("click", onTrashClick);
    slot.append(button);
  }
  void paintCan(button);
  if (poll === null) {
    poll = setInterval(() => {
      const current = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
      if (current) void paintCan(current);
    }, 3000);
  }
}

/** Start watching the Data Protection preference and the recovery queue. */
export function mountTrashFooter(): void {
  if (!mounted) {
    mounted = true;
    window.addEventListener("markable-data-protection", () => syncTrashFooter());
  }
  syncTrashFooter();
}
