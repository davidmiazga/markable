/**
 * Open a rendered markdown link, bare URL, or wiki link without moving
 * the cursor or leaving view mode.
 *
 * http(s) opens in the system browser. A note path opens that note.
 * javascript: and file: do nothing. A link that cannot be opened leaves
 * the selection and the view where they were.
 */

import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

/** How long a rendered-link mousedown suppresses the wiki plugin's own click. */
export const LINK_CLICK_ARM_MS = 500;

const ARM_KEY = "__MARKABLE_LINK_CLICK_ARMED_AT__";

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__MARKABLE_LINK_CLICK_ARM_MS__ = LINK_CLICK_ARM_MS;
}

export interface LinkOpeners {
  openExternal(url: string): void;
  openNote(path: string): void;
  currentFile(): string | null;
}

export type EditorLinkAction =
  | { type: "external"; url: string }
  | { type: "note"; target: string }
  | { type: "ignore" };

function defaultOpeners(): LinkOpeners {
  return {
    openExternal(url) {
      void invoke("open_external_url", { url });
    },
    openNote(path) {
      const tm = (globalThis as {
        __MARKABLE_TAB_MANAGER__?: { openFileInTab?: (p: string) => unknown };
      }).__MARKABLE_TAB_MANAGER__;
      if (typeof tm?.openFileInTab === "function") tm.openFileInTab(path);
    },
    currentFile() {
      const current = (globalThis as { __MARKABLE_CURRENT_FILE__?: string | null })
        .__MARKABLE_CURRENT_FILE__;
      return typeof current === "string" && current ? current : null;
    },
  };
}

function normalizeAbsolute(filePath: string): string {
  const parts: string[] = [];
  for (const segment of filePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join("/")}`;
}

/**
 * Resolve a note target against the open file's directory.
 * Returns null for schemes, fragments, and non-note extensions.
 */
export function resolveNotePath(currentFile: string, target: string): string | null {
  let path = target.trim();
  const cut = path.search(/[?#]/);
  if (cut === 0) return null;
  if (cut > 0) path = path.slice(0, cut).trim();
  if (!path || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.startsWith("./")) path = path.slice(2);
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  if (ext && ext !== ".md" && ext !== ".markdown") return null;
  if (!ext) path += ".md";
  if (path.startsWith("/")) return normalizeAbsolute(path);
  const slash = currentFile.lastIndexOf("/");
  const dir = slash <= 0 ? "" : currentFile.slice(0, slash);
  return normalizeAbsolute(`${dir}/${path}`);
}

/** http(s) and www open externally. Note paths open a note. Other schemes do nothing. */
export function classifyEditorHref(href: string): EditorLinkAction {
  const trimmed = href.trim();
  if (!trimmed) return { type: "ignore" };
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === "http" || name === "https") return { type: "external", url: trimmed };
    return { type: "ignore" };
  }
  if (/^www\./i.test(trimmed)) return { type: "external", url: `https://${trimmed}` };
  if (resolveNotePath("/note.md", trimmed)) return { type: "note", target: trimmed };
  return { type: "ignore" };
}

/** Open a classified href. Returns what happened. Failures do not throw. */
export function openEditorHref(
  href: string,
  openers: LinkOpeners = defaultOpeners(),
): "external" | "note" | "ignore" {
  const action = classifyEditorHref(href);
  if (action.type === "ignore") return "ignore";
  if (action.type === "external") {
    try {
      openers.openExternal(action.url);
    } catch {
      return "ignore";
    }
    return "external";
  }
  const current = openers.currentFile();
  if (!current) return "ignore";
  const path = resolveNotePath(current, action.target);
  if (!path) return "ignore";
  try {
    openers.openNote(path);
  } catch {
    return "ignore";
  }
  return "note";
}

function eventElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function hrefFromSyntax(state: EditorState, pos: number): string | null {
  let node = syntaxTree(state).resolveInner(pos, 1);
  let link: { from: number; to: number } | null = null;
  let url: { from: number; to: number; name: string } | null = null;
  for (let current: typeof node | null = node; current; current = current.parent) {
    if (!link && current.name === "Link") link = current;
    if (!url && (current.name === "URL" || current.name === "Autolink")) {
      url = current;
    }
  }
  if (link) {
    const text = state.doc.sliceString(link.from, link.to);
    const match = /\(([^)\s]+)\)/.exec(text);
    return match ? match[1] : null;
  }
  if (!url) return null;
  let raw = state.doc.sliceString(url.from, url.to);
  if (url.name === "Autolink") raw = raw.replace(/^</, "").replace(/>$/, "");
  return raw || null;
}

const WIKI_LINK = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;

function wikiTargetAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  const rel = pos - line.from;
  WIKI_LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK.exec(line.text))) {
    if (rel >= match.index && rel < match.index + match[0].length) return match[1];
  }
  return null;
}

function inViewMode(state: EditorState): boolean {
  const field = (globalThis as { __MARKABLE_VIEW_MODE_FIELD__?: { id: number } })
    .__MARKABLE_VIEW_MODE_FIELD__;
  if (!field) return false;
  return Boolean(state.field(field as never, false));
}

/** Href of a rendered link under the event, or null when the click is ordinary text. */
export function renderedLinkHref(view: EditorView, event: MouseEvent): string | null {
  const el = eventElement(event);
  if (!el || !view.dom.contains(el)) return null;

  const wiki = el.closest(".cm-wiki-link");
  if (wiki && view.dom.contains(wiki)) {
    const target = wiki.getAttribute("data-wiki-target");
    if (target) return target;
  }

  const link = el.closest(".cm-live-link, .cm-live-autolink");
  if (link && view.dom.contains(link)) {
    const href = link.getAttribute("data-link-href");
    if (href) return href;
    try {
      return hrefFromSyntax(view.state, view.posAtDOM(link));
    } catch {
      return null;
    }
  }

  if (!inViewMode(view.state)) return null;
  let pos: number | null = null;
  try {
    pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  } catch {
    pos = null;
  }
  if (pos == null) return null;
  return wikiTargetAt(view.state, pos);
}

function armWikiClickGuard(): void {
  (globalThis as Record<string, unknown>)[ARM_KEY] = Date.now();
}

/**
 * Capture the click before CodeMirror and before the wiki plugin.
 * The editor view is created first, so this listener is registered first
 * and can stop the plugin from opening the same note again.
 * Mousedown is cancelled so the selection stays put and view mode stays on.
 */
export function linkClickExtension(openers?: LinkOpeners) {
  const ports = openers ?? defaultOpeners();
  return ViewPlugin.define((view) => {
    let opened = false;

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const href = renderedLinkHref(view, event);
      if (href == null) return;
      event.preventDefault();
      event.stopPropagation();
      armWikiClickGuard();
      openEditorHref(href, ports);
      opened = true;
    };

    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const href = renderedLinkHref(view, event);
      if (href == null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!opened) openEditorHref(href, ports);
      opened = false;
      (globalThis as Record<string, unknown>)[ARM_KEY] = 0;
    };

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    return {
      destroy() {
        document.removeEventListener("mousedown", onMouseDown, true);
        document.removeEventListener("click", onClick, true);
      },
    };
  });
}
