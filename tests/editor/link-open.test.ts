/**
 * Readable link colors, and clicks that open a link without editing the line
 * or leaving view mode.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Autolink } from "@lezer/markdown";
import "../../src/lib/cm-globals";
import { livePreviewExtension, setViewMode, viewModeField } from "../../src/editor/live-preview";
import {
  applyReadableLinkColor,
  contrastRatio,
  DEFAULT_LINK_ON_DARK,
  DEFAULT_LINK_ON_LIGHT,
  MIN_LINK_BACKGROUND_CONTRAST,
  MIN_LINK_TEXT_CONTRAST,
  readableLinkColor,
} from "../../src/editor/link-color";
import {
  classifyEditorHref,
  linkClickExtension,
  openEditorHref,
  resolveNotePath,
} from "../../src/editor/link-click";
import { buildWikiLinkDecorationExtension } from "../../src/plugins/backlinks/backlinks.plugin";

const REPO = resolve(__dirname, "..", "..");

function firstBlock(css: string, header: RegExp): string {
  const match = header.exec(css);
  if (!match) throw new Error(`missing ${header}`);
  const start = css.indexOf("{", match.index);
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error(`unclosed ${header}`);
}

function token(block: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`missing ${name}`);
  return match[1].trim();
}

const stylesCss = readFileSync(join(REPO, "src/styles.css"), "utf8");
const lightBlock = firstBlock(stylesCss, /(?:^|\n):root\s*\{/);
const darkBlock = firstBlock(stylesCss, /\[data-theme="dark"\]\s*\{/);

const SHIPPED = [
  "dracula.css",
  "monokai.css",
  "nord.css",
  "solarized-light.css",
  "solarized-dark.css",
];

describe("link colors", () => {
  it("gives built-in light and dark a link color distinct from the note and the body text", () => {
    const light = {
      link: token(lightBlock, "--link-color"),
      bg: token(lightBlock, "--bg-primary"),
      text: token(lightBlock, "--text-primary"),
    };
    const dark = {
      link: token(darkBlock, "--link-color"),
      bg: token(darkBlock, "--bg-primary"),
      text: token(darkBlock, "--text-primary"),
    };

    expect(light.link).toBe(DEFAULT_LINK_ON_LIGHT);
    expect(dark.link).toBe(DEFAULT_LINK_ON_DARK);

    for (const theme of [light, dark]) {
      expect(contrastRatio(theme.link, theme.bg)).toBeGreaterThanOrEqual(MIN_LINK_BACKGROUND_CONTRAST);
      expect(contrastRatio(theme.link, theme.text)).toBeGreaterThanOrEqual(MIN_LINK_TEXT_CONTRAST);
    }
  });

  it("keeps a shipped theme link color when it is readable, and uses the default otherwise", () => {
    for (const file of SHIPPED) {
      const css = readFileSync(join(REPO, "src-tauri/themes", file), "utf8");
      const block = firstBlock(css, /:root\s*\{/);
      const declared = token(block, "--link-color");
      const background = token(block, "--bg-primary");
      const resolved = readableLinkColor(declared, background);

      expect(contrastRatio(resolved, background)).toBeGreaterThanOrEqual(MIN_LINK_BACKGROUND_CONTRAST);
      if (contrastRatio(declared, background) >= MIN_LINK_BACKGROUND_CONTRAST) {
        expect(resolved).toBe(declared);
      } else {
        expect(resolved).toBe(
          contrastRatio(DEFAULT_LINK_ON_LIGHT, background) >= MIN_LINK_BACKGROUND_CONTRAST
            ? DEFAULT_LINK_ON_LIGHT
            : DEFAULT_LINK_ON_DARK,
        );
      }
    }
  });

  it("writes the default onto the document when the theme link color is too dim", () => {
    const style = document.createElement("style");
    style.textContent = ":root { --bg-primary: #002b36; --link-color: #268bd2; }";
    document.head.appendChild(style);
    applyReadableLinkColor();
    expect(document.documentElement.style.getPropertyValue("--link-color").trim()).toBe(DEFAULT_LINK_ON_DARK);
    style.remove();
    document.documentElement.style.removeProperty("--link-color");
  });
});

describe("classify and resolve", () => {
  const current = "/vault/notes/current.md";

  it("opens http(s), ignores javascript and file, and resolves a note", () => {
    expect(classifyEditorHref("https://example.com/a")).toEqual({
      type: "external",
      url: "https://example.com/a",
    });
    expect(classifyEditorHref("http://example.com")).toEqual({
      type: "external",
      url: "http://example.com",
    });
    expect(classifyEditorHref("javascript:alert(1)")).toEqual({ type: "ignore" });
    expect(classifyEditorHref("file:///tmp/x")).toEqual({ type: "ignore" });
    expect(classifyEditorHref("other.md")).toEqual({ type: "note", target: "other.md" });
    expect(resolveNotePath(current, "other.md")).toBe("/vault/notes/other.md");
    expect(resolveNotePath(current, "Wiki Note")).toBe("/vault/notes/Wiki Note.md");
  });

  it("does not call an opener for a link that cannot be opened", () => {
    const external = viOpen();
    const note = viOpen();
    const openers = {
      openExternal: external.fn,
      openNote: note.fn,
      currentFile: () => null as string | null,
    };
    expect(openEditorHref("javascript:alert(1)", openers)).toBe("ignore");
    expect(openEditorHref("file:///tmp/x", openers)).toBe("ignore");
    expect(openEditorHref("missing.md", openers)).toBe("ignore");
    expect(external.calls).toEqual([]);
    expect(note.calls).toEqual([]);
  });
});

function viOpen() {
  const calls: unknown[][] = [];
  return {
    calls,
    fn: (...args: unknown[]) => {
      calls.push(args);
    },
  };
}

const DOC = [
  "[[Wiki Note]]",
  "[Example](https://example.com/a)",
  "https://bare.example/b",
  "[Note](other.md)",
  "[Bad](javascript:alert(1))",
  "[File](file:///tmp/x)",
].join("\n");

describe("clicking a rendered link", () => {
  const external = viOpen();
  const note = viOpen();
  let view: EditorView;
  let parent: HTMLElement;

  function mount(): void {
    parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: DOC,
        extensions: [
          markdown({ base: markdownLanguage, extensions: [Autolink] }),
          viewModeField,
          livePreviewExtension,
          ...buildWikiLinkDecorationExtension(),
          linkClickExtension({
            openExternal: external.fn,
            openNote: note.fn,
            currentFile: () => "/vault/notes/current.md",
          }),
        ],
      }),
    });
    view.dispatch({ effects: setViewMode.of(true) });
  }

  function linkByText(text: string): HTMLElement {
    const found = [...view.dom.querySelectorAll(".cm-live-link, .cm-wiki-link")].find(
      (el) => el.textContent === text,
    );
    if (!(found instanceof HTMLElement)) throw new Error(`missing link ${text}`);
    return found;
  }

  function click(el: HTMLElement): void {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  }

  function stayed(): void {
    expect(view.state.selection.main.head).toBe(0);
    expect(view.state.field(viewModeField)).toBe(true);
    expect(view.dom.querySelector(".cm-live-link, .cm-wiki-link")).not.toBeNull();
  }

  afterEach(() => {
    view.destroy();
    parent.remove();
  });

  it("opens a markdown link, a bare URL, and a wiki link without editing the line or leaving view mode", () => {
    mount();
    external.calls.length = 0;
    note.calls.length = 0;

    click(linkByText("Example"));
    click(linkByText("https://bare.example/b"));
    click(linkByText("Wiki Note"));
    click(linkByText("Note"));

    expect(external.calls).toEqual([
      ["https://example.com/a"],
      ["https://bare.example/b"],
    ]);
    expect(note.calls).toEqual([
      ["/vault/notes/Wiki Note.md"],
      ["/vault/notes/other.md"],
    ]);
    stayed();
  });

  it("leaves javascript and file links on the same line and in the same view", () => {
    mount();
    external.calls.length = 0;
    note.calls.length = 0;

    click(linkByText("Bad"));
    click(linkByText("File"));

    expect(external.calls).toEqual([]);
    expect(note.calls).toEqual([]);
    stayed();
    expect(linkByText("Bad").isConnected).toBe(true);
    expect(linkByText("File").isConnected).toBe(true);
  });
});
