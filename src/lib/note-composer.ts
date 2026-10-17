/**
 * Note composer dialogs: merge another note into the current one, or
 * split the current note at the cursor into a new file.
 */

import { invoke } from "@tauri-apps/api/core";

export interface ComposerFile {
  path: string;
  title: string;
}

function ensureStyle(): void {
  if (document.getElementById("note-composer-style")) return;
  const style = document.createElement("style");
  style.id = "note-composer-style";
  style.textContent = `
    .note-composer-overlay {
      position: fixed; inset: 0; z-index: 1200;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.4);
    }
    .note-composer-panel {
      width: 420px; max-width: 92vw; padding: 16px;
      background: var(--bg-primary); color: var(--text-primary);
      border: 1px solid var(--border-color); border-radius: 12px;
      font-family: var(--ui-font); font-size: 13px;
    }
    .note-composer-panel h2 { margin: 0 0 8px; font-size: 15px; }
    .note-composer-panel p { margin: 0 0 12px; color: var(--text-secondary); }
    .note-composer-panel select,
    .note-composer-panel input { width: 100%; margin-bottom: 12px; }
    .note-composer-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .note-composer-error { color: var(--text-primary); margin: 0 0 8px; }
  `;
  document.head.appendChild(style);
}

function overlay(title: string, body: string): { root: HTMLElement; panel: HTMLElement } {
  ensureStyle();
  const root = document.createElement("div");
  root.className = "note-composer-overlay";
  root.innerHTML = `
    <div class="note-composer-panel" role="dialog" aria-label="${title}">
      <h2>${title}</h2>
      <p>${body}</p>
      <div class="note-composer-fields"></div>
      <p class="note-composer-error" hidden></p>
      <div class="note-composer-actions">
        <button type="button" class="btn btn-tertiary" data-composer="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-composer="go">Continue</button>
      </div>
    </div>`;
  root.addEventListener("click", (event) => {
    if (event.target === root) root.remove();
  });
  root.querySelector("[data-composer=cancel]")?.addEventListener("click", () => root.remove());
  document.body.append(root);
  return { root, panel: root.querySelector(".note-composer-panel") as HTMLElement };
}

function showError(panel: HTMLElement, message: string): void {
  const error = panel.querySelector(".note-composer-error") as HTMLElement;
  error.hidden = false;
  error.textContent = message;
}

export function openMergeComposer(
  destination: string,
  files: ComposerFile[],
  onMerged: (content: string) => void,
): void {
  const others = files.filter((file) => file.path !== destination);
  const { root, panel } = overlay(
    "Merge notes",
    "Append another note onto this one. The other note is then removed using Data Protection.",
  );
  const fields = panel.querySelector(".note-composer-fields") as HTMLElement;
  if (others.length === 0) {
    fields.textContent = "No other notes are available to merge.";
    (panel.querySelector("[data-composer=go]") as HTMLButtonElement).disabled = true;
    return;
  }
  const select = document.createElement("select");
  select.className = "settings-select";
  for (const file of others) {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = file.title;
    select.append(option);
  }
  fields.append(select);
  panel.querySelector("[data-composer=go]")?.addEventListener("click", () => {
    void (async () => {
      try {
        const merged = await invoke<string>("compose_merge_notes", {
          destination,
          source: select.value,
        });
        root.remove();
        onMerged(merged);
      } catch (error) {
        showError(panel, error instanceof Error ? error.message : String(error));
      }
    })();
  });
}

export function openSplitComposer(
  path: string,
  atChar: number,
  suggestedPath: string,
  onSplit: (head: string, newPath: string) => void,
): void {
  const { root, panel } = overlay(
    "Split note",
    "Text before the cursor stays here. Text after the cursor becomes a new note.",
  );
  const fields = panel.querySelector(".note-composer-fields") as HTMLElement;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "settings-input";
  input.value = suggestedPath;
  fields.append(input);
  panel.querySelector("[data-composer=go]")?.addEventListener("click", () => {
    const newPath = input.value.trim();
    if (!newPath) {
      showError(panel, "Enter a path for the new note.");
      return;
    }
    void (async () => {
      try {
        const head = await invoke<string>("compose_split_note", {
          path,
          atChar,
          newPath,
        });
        root.remove();
        onSplit(head, newPath);
      } catch (error) {
        showError(panel, error instanceof Error ? error.message : String(error));
      }
    })();
  });
}

/** Unicode scalar count before a JavaScript string index. Matches Rust `chars()`. */
export function charsBefore(text: string, utf16Index: number): number {
  return [...text.slice(0, utf16Index)].length;
}
