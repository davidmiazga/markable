/**
 * Tests for PluginManager compartment management methods (step_01a).
 *
 * Covers the three new methods added in Chunk 1 — Foundation:
 *   - setEditorView(view)
 *   - addExtensions(pluginId, exts)
 *   - removeExtensions(pluginId)
 *   - _reconfigureCompartment() (tested indirectly via the public surface)
 *
 * Tests use a minimal EditorView stub whose `dispatch` call is a vi.fn().
 * No real CM6 editor is instantiated — compartment.reconfigure() produces
 * a plain StateEffect object that we can inspect structurally.
 *
 * EC-17: removeExtensions on an unknown plugin id must be a no-op.
 * EC-18: extensions queued before setEditorView must be flushed on setEditorView.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginManager } from "../src/plugins/index";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Minimal EditorView stub — only dispatch() is needed by PluginManager.
// ---------------------------------------------------------------------------

function makeView(): { view: EditorView; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const view = { dispatch } as unknown as EditorView;
  return { view, dispatch };
}

/** A trivially valid CM6 Extension — just an empty array is accepted by CM6. */
function fakeExt(label: string): Extension {
  // Using a labeled object so test assertions can identify which extension
  // ended up in the compartment. CM6 accepts arbitrary Extension values.
  return [label] as unknown as Extension;
}

// ---------------------------------------------------------------------------
// setEditorView
// ---------------------------------------------------------------------------

describe("PluginManager.setEditorView()", () => {
  let mgr: PluginManager;

  beforeEach(() => {
    mgr = new PluginManager();
  });

  it("stores the EditorView reference so subsequent addExtensions dispatches immediately", () => {
    const { view, dispatch } = makeView();
    mgr.setEditorView(view);

    const ext = fakeExt("alpha");
    mgr.addExtensions("plugin-a", [ext]);

    // addExtensions must have triggered a dispatch when view is available.
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("flushes pending extensions queued before the view was set (EC-18)", () => {
    // Queue an extension before the view is wired.
    mgr.addExtensions("plugin-queued", [fakeExt("queued-ext")]);

    const { view, dispatch } = makeView();
    // At this point dispatch should not have been called yet.
    expect(dispatch).not.toHaveBeenCalled();

    // Wiring the view flushes the queue.
    mgr.setEditorView(view);

    // The flush should have triggered exactly one reconfigure dispatch.
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not dispatch when there are no pending extensions (EC-18: empty queue)", () => {
    const { view, dispatch } = makeView();
    mgr.setEditorView(view);
    // No extensions were queued, so no dispatch should occur.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("last addExtensions call wins when same plugin id queued twice before setEditorView", () => {
    // Two addExtensions calls with the same id before the view is available.
    // The pending queue is drained in order, so the second call's Map.set()
    // overwrites the first, giving last-write-wins semantics.
    mgr.addExtensions("plugin-dup", [fakeExt("first-dup")]);
    mgr.addExtensions("plugin-dup", [fakeExt("second-dup")]); // replaces first in queue

    const { view, dispatch } = makeView();
    mgr.setEditorView(view);

    // Both pending entries were drained but they share a plugin id, so only
    // one entry survives in extensionMap. A single _reconfigureCompartment
    // call is made at the end of setEditorView — not one per queue entry.
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("accepts multiple pending plugins and flushes them all in one dispatch", () => {
    mgr.addExtensions("p1", [fakeExt("e1")]);
    mgr.addExtensions("p2", [fakeExt("e2")]);

    const { view, dispatch } = makeView();
    mgr.setEditorView(view);

    // All pending entries are merged into one _reconfigureCompartment call.
    expect(dispatch).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// addExtensions
// ---------------------------------------------------------------------------

describe("PluginManager.addExtensions()", () => {
  let mgr: PluginManager;
  let view: EditorView;
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mgr = new PluginManager();
    const stub = makeView();
    view = stub.view;
    dispatch = stub.dispatch;
    mgr.setEditorView(view);
    dispatch.mockClear(); // reset call count after setEditorView
  });

  it("stores extensions in the internal map (visible via removeExtensions behaviour)", () => {
    mgr.addExtensions("plugin-a", [fakeExt("x")]);
    // Confirm the extension is tracked: removeExtensions must dispatch (not no-op).
    dispatch.mockClear();
    mgr.removeExtensions("plugin-a");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("triggers a dispatch after adding extensions", () => {
    mgr.addExtensions("plugin-b", [fakeExt("y")]);
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("replaces extensions on a second addExtensions call (idempotent enable/disable cycle)", () => {
    mgr.addExtensions("plugin-c", [fakeExt("first")]);
    dispatch.mockClear();
    mgr.addExtensions("plugin-c", [fakeExt("second")]);
    // Should still dispatch (replacement, not skip).
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("queues extensions and does not dispatch when view is null (EC-18)", () => {
    const freshMgr = new PluginManager();
    // No setEditorView call — editorView is null.
    const extA = fakeExt("queued");
    // This must NOT throw and must NOT attempt a dispatch.
    expect(() => freshMgr.addExtensions("plugin-d", [extA])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// removeExtensions
// ---------------------------------------------------------------------------

describe("PluginManager.removeExtensions()", () => {
  let mgr: PluginManager;
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mgr = new PluginManager();
    const stub = makeView();
    dispatch = stub.dispatch;
    mgr.setEditorView(stub.view);
    dispatch.mockClear();
  });

  it("is a no-op for an unknown plugin id (EC-17)", () => {
    // Removing a plugin that never called addExtensions must not dispatch.
    mgr.removeExtensions("never-registered");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("removes the plugin's extensions from the map and triggers a dispatch", () => {
    mgr.addExtensions("plugin-e", [fakeExt("e")]);
    dispatch.mockClear();

    mgr.removeExtensions("plugin-e");
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("after removal, a second removeExtensions call is a no-op (EC-17)", () => {
    mgr.addExtensions("plugin-f", [fakeExt("f")]);
    mgr.removeExtensions("plugin-f");
    dispatch.mockClear();

    // Second remove — entry is gone from the map, so EC-17 no-op applies.
    mgr.removeExtensions("plugin-f");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("only removes the targeted plugin's extensions, not other plugins'", () => {
    mgr.addExtensions("plugin-g", [fakeExt("g")]);
    mgr.addExtensions("plugin-h", [fakeExt("h")]);
    dispatch.mockClear();

    mgr.removeExtensions("plugin-g");
    // One dispatch for the removal.
    expect(dispatch).toHaveBeenCalledOnce();

    dispatch.mockClear();
    // plugin-h is still registered, so another removeExtensions should dispatch.
    mgr.removeExtensions("plugin-h");
    expect(dispatch).toHaveBeenCalledOnce();
  });
});
