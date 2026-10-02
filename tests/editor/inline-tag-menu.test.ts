import { afterEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  closeInlineTagMenu,
  handleInlineTagContext,
  inlineTagAt,
  inlineTagMenuExtension,
} from "../../src/editor/inline-tag-menu";

const doc = [
  "Cook #recipe tonight.",
  "Not a tag.",
  "Use `#hidden` in code.",
  "```",
  "#fenced",
  "```",
  "# Title #also",
].join("\n");

function state(): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe("inlineTagAt", () => {
  it("reads a #tag and ignores plain text, code spans, and fences", () => {
    const editor = state();
    expect(inlineTagAt(editor, doc.indexOf("#recipe") + 2)).toBe("recipe");
    expect(inlineTagAt(editor, doc.indexOf("Not a tag"))).toBeNull();
    expect(inlineTagAt(editor, doc.indexOf("#hidden") + 1)).toBeNull();
    expect(inlineTagAt(editor, doc.indexOf("#fenced") + 1)).toBeNull();
    expect(inlineTagAt(editor, doc.indexOf("#also") + 1)).toBe("also");
  });
});

describe("inline tag context menu", () => {
  afterEach(() => {
    closeInlineTagMenu();
    delete (window as unknown as { __MARKABLE_TAG_SEARCH__?: unknown }).__MARKABLE_TAG_SEARCH__;
    document.querySelector(".cm-editor")?.remove();
  });

  it("right-click on a tag offers include and exclude queries", () => {
    const search = vi.fn();
    (window as unknown as { __MARKABLE_TAG_SEARCH__: typeof search }).__MARKABLE_TAG_SEARCH__ =
      search;
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "#recipe",
        extensions: [markdown(), inlineTagMenuExtension()],
      }),
    });

    expect(handleInlineTagContext(view, 1, 8, 8)).toBe(true);

    const include = document.querySelector(".it-search-include") as HTMLButtonElement;
    const exclude = document.querySelector(".it-search-exclude") as HTMLButtonElement;
    expect(include.textContent).toBe("Search notes with this");
    expect(exclude.textContent).toBe("Exclude this from search");
    include.click();
    expect(search).toHaveBeenCalledWith("tag:#recipe", "include");
    handleInlineTagContext(view, 1, 8, 8);
    (document.querySelector(".it-search-exclude") as HTMLButtonElement).click();
    expect(search).toHaveBeenCalledWith("-tag:#recipe", "exclude");
    expect(document.querySelector(".it-pop")).toBeNull();
    view.destroy();
    parent.remove();
  });

  it("right-click on plain text does not open the menu", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "plain words only",
        extensions: [markdown(), inlineTagMenuExtension()],
      }),
    });
    expect(handleInlineTagContext(view, 0, 8, 8)).toBe(false);
    view.dom.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
    );
    expect(document.querySelector(".it-pop")).toBeNull();
    view.destroy();
    parent.remove();
  });
});
