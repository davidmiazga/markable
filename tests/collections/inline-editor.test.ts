/**
 * tests/collections/inline-editor.test.ts — step_11
 *
 * Asserts the persistent CM6 EditorView lifecycle:
 *   - mount inserts the editor host element into the box body.
 *   - mount on B after editing A commits A first (EC-19).
 *   - unmount writes the new content via bridge.writeFile.
 *   - unchanged content does NOT trigger a write.
 *   - commit error keeps the editor mounted (resilience).
 *   - reuses the same EditorView across mount cycles (perf, 1.8.E).
 *
 * The EditorView constructor is dependency-injected so the test can supply
 * a lightweight fake. The production module exports a default factory.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import {
  createInlineEditor,
  type EditorViewFactory,
} from "../../src/plugins/file-browser/collections/inline-editor";
import type { NoteBoxHandle } from "../../src/plugins/file-browser/collections/note-box";

/**
 * Build a minimal NoteBoxHandle suitable for tests. The handle's `el` has a
 * body element the inline editor reparents into.
 */
function makeBox(notePath: string): NoteBoxHandle {
  const el = document.createElement("article");
  el.className = "fv-collection-note-box";
  const body = document.createElement("div");
  body.className = "fv-collection-note-box-body";
  el.appendChild(body);
  return {
    el,
    notePath,
    kind: { kind: "canonical", stackPath: "/v/A/Stack 01", noteFilename: "x.md" },
    state: "placeholder",
    lastRenderedHeight: null,
  };
}

/**
 * Mock EditorView factory — returns a fake view with mutable doc.toString().
 */
function makeFakeFactory(): { ctor: ReturnType<typeof vi.fn>; factory: EditorViewFactory } {
  const ctor = vi.fn();
  const factory: EditorViewFactory = (initialContent: string, parent: HTMLElement) => {
    ctor(initialContent, parent);
    let doc = initialContent;
    const fakeEditor = document.createElement("div");
    fakeEditor.className = "cm-editor";
    parent.appendChild(fakeEditor);
    return {
      destroy: vi.fn(() => fakeEditor.remove()),
      focus: vi.fn(),
      setState: (s: string) => { doc = s; },
      getDoc: () => doc,
      // Setter used by some tests to simulate user typing.
      _setDoc: (s: string) => { doc = s; },
    };
  };
  return { ctor, factory };
}

beforeEach(() => vi.restoreAllMocks());

describe("inline-editor: mount/unmount (step_11)", () => {
  it("FR-10 — mount inserts EditorView (.cm-editor) into the box body", async () => {
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "hello");
    expect(box.el.querySelector(".cm-editor")).not.toBeNull();
    expect(editor.isMounted()).toBe(true);
    expect(editor.currentPath()).toBe("/v/A/Stack 01/x.md");
    editor.destroy();
    box.el.remove();
    host.remove();
  });

  it("EC-19 — mounting B after editing A first commits A", async () => {
    vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const a = makeBox("/v/A/Stack 01/a.md");
    const b = makeBox("/v/A/Stack 01/b.md");
    document.body.append(a.el, b.el);
    await editor.mount(a, "original A");
    // Simulate the user typing into A.
    (editor as unknown as { _setDoc: (s: string) => void })._setDoc("edited A");
    await editor.mount(b, "original B");
    // bridge.writeFile must have fired for A's path.
    const calls = (bridge.writeFile as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => c[0] === "/v/A/Stack 01/a.md")).toBe(true);
    editor.destroy();
    [a, b].forEach((x) => x.el.remove());
    host.remove();
  });

  it("perf — unmount with unchanged content does NOT write", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "same");
    // No edits — doc stays equal.
    await editor.unmount();
    expect(writeSpy).not.toHaveBeenCalled();
    editor.destroy();
    box.el.remove();
    host.remove();
  });

  it("FR-10 — unmount with changed content writes via bridge.writeFile", async () => {
    const writeSpy = vi.spyOn(bridge, "writeFile").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "original");
    (editor as unknown as { _setDoc: (s: string) => void })._setDoc("changed");
    await editor.unmount();
    expect(writeSpy).toHaveBeenCalledWith("/v/A/Stack 01/x.md", "changed");
    editor.destroy();
    box.el.remove();
    host.remove();
  });

  it("FR-10 — unmount fires onSave with the new content", async () => {
    vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onSave = vi.fn();
    const editor = createInlineEditor({
      hostParent: host,
      onSave,
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "old");
    (editor as unknown as { _setDoc: (s: string) => void })._setDoc("new");
    await editor.unmount();
    expect(onSave).toHaveBeenCalledWith("/v/A/Stack 01/x.md", "new");
    editor.destroy();
    box.el.remove();
    host.remove();
  });

  it("resilience — commit error keeps editor mounted; onCommitError called", async () => {
    vi.spyOn(bridge, "writeFile").mockResolvedValue({
      ok: false,
      error: { message: "disk full", command: "write_file" },
    });
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onCommitError = vi.fn();
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError,
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "old");
    (editor as unknown as { _setDoc: (s: string) => void })._setDoc("new");
    await editor.unmount();
    expect(onCommitError).toHaveBeenCalled();
    expect(editor.isMounted()).toBe(true);
    editor.destroy();
    box.el.remove();
    host.remove();
  });

  it("basic — currentPath returns null when unmounted", () => {
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    expect(editor.currentPath()).toBeNull();
    expect(editor.isMounted()).toBe(false);
    editor.destroy();
    host.remove();
  });

  it("leak — destroy disposes EditorView and removes hostEl", async () => {
    const { factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const box = makeBox("/v/A/Stack 01/x.md");
    document.body.appendChild(box.el);
    await editor.mount(box, "x");
    editor.destroy();
    expect(host.querySelector(".cm-editor")).toBeNull();
    box.el.remove();
    host.remove();
  });

  it("perf / 1.8.E — reuses the same EditorView across multiple mount cycles", async () => {
    vi.spyOn(bridge, "writeFile").mockResolvedValue({ ok: true, value: undefined });
    const { ctor, factory } = makeFakeFactory();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = createInlineEditor({
      hostParent: host,
      onSave: vi.fn(),
      onCommitError: vi.fn(),
      viewFactory: factory,
    });
    const boxes = [1, 2, 3, 4, 5].map((i) => makeBox(`/v/A/Stack 01/x${i}.md`));
    boxes.forEach((b) => document.body.appendChild(b.el));
    for (const b of boxes) {
      await editor.mount(b, "content");
    }
    await editor.unmount();
    expect(ctor).toHaveBeenCalledTimes(1);
    editor.destroy();
    boxes.forEach((b) => b.el.remove());
    host.remove();
  });
});
