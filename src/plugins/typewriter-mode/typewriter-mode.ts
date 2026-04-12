/**
 * Typewriter Mode — keep the cursor line vertically centered.
 *
 * Uses CM6's `EditorView.scrollIntoView` effect to smoothly center the
 * cursor after every selection/doc change. Adds top/bottom padding to
 * `.cm-content` so the first and last lines can be centered too
 * (Typora-style blank space at edges).
 *
 * The extension is always registered. When disabled (default), it does nothing.
 * Toggle via the `setTypewriterMode` StateEffect.
 */

import {
  StateField,
  StateEffect,
  type Extension,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

// --- Effect to toggle typewriter mode on/off ---

export const setTypewriterMode = StateEffect.define<boolean>();

// --- StateField: tracks whether typewriter mode is enabled ---

export const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTypewriterMode)) return e.value;
    }
    return value;
  },
});

// --- Padding management for edge centering ---

function updatePadding(view: EditorView, enabled: boolean): void {
  const content = view.contentDOM;
  if (enabled) {
    const halfHeight = Math.round(view.dom.clientHeight / 2);
    content.style.paddingTop = `${halfHeight}px`;
    content.style.paddingBottom = `${halfHeight}px`;
  } else {
    content.style.paddingTop = "";
    content.style.paddingBottom = "";
  }
}

// --- Update listener: scroll cursor to center ---

const typewriterUpdateListener = EditorView.updateListener.of(
  (update: ViewUpdate) => {
    const enabled = update.state.field(typewriterModeField);
    const wasEnabled = update.startState.field(typewriterModeField);

    // Handle padding when mode toggles
    if (enabled !== wasEnabled) {
      updatePadding(update.view, enabled);
    }

    if (!enabled) return;

    // Only scroll when doc changed, selection moved, or mode was just toggled
    const modeToggled = enabled !== wasEnabled;
    if (!update.docChanged && !update.selectionSet && !modeToggled) return;

    const head = update.state.selection.main.head;
    update.view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: "center" }),
    });
  },
);

// --- Resize observer: update padding when editor size changes ---

import { ViewPlugin } from "@codemirror/view";

const resizePlugin = ViewPlugin.define((view) => {
  const observer = new ResizeObserver(() => {
    const enabled = view.state.field(typewriterModeField);
    if (enabled) {
      updatePadding(view, true);
    }
  });
  observer.observe(view.dom);
  return {
    destroy() {
      observer.disconnect();
    },
  };
});

// --- Public extension ---

export const typewriterModeExtension: Extension = [
  typewriterModeField,
  typewriterUpdateListener,
  resizePlugin,
];
