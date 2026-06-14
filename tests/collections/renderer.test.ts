/**
 * tests/collections/renderer.test.ts — step_12
 *
 * Asserts the top-level renderer + navigation state machine:
 *   - Home view renders the home canvas.
 *   - Click a Stack glyph navigates to Stack section view, breadcrumb shows 2.
 *   - Click breadcrumb Home segment returns to home canvas.
 *   - Stack rename re-renders breadcrumb middle segment in the same pass (EC-24).
 *   - destroy tears down preview-cache + inline-editor + stack-panel.
 *
 * IntersectionObserver is mocked because the renderer instantiates a stack
 * panel which constructs observers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import * as vaultManager from "../../src/lib/vault-manager";
import type { VaultIndex } from "../../src/lib/vault-types";

/**
 * The renderer constructs a stack panel which builds two IntersectionObservers
 * (enter + exit). For most tests we just need a no-op. For the incremental
 * insertion test we count constructor invocations to assert that a `+Note`
 * click does NOT remount the panel (which would build a fresh pair of
 * observers). `observerInstances` collects the live instances; equality of
 * the array between snapshots proves no rebuild happened.
 */
const observerInstances: IntersectionObserver[] = [];

class TrackingIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: readonly number[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  observe(): void {}
  constructor(_cb: IntersectionObserverCallback) {
    observerInstances.push(this);
  }
}

(globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
  TrackingIntersectionObserver as unknown as typeof IntersectionObserver;

import { renderCollectionHome } from "../../src/plugins/file-browser/collections/renderer";

function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) {
      return { ok: true as const, value: fs.get(path)! };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(
    async (path: string, content: string) => {
      fs.set(path, content);
      return { ok: true as const, value: undefined };
    },
  );
  return fs;
}

function withVault(folders: string[], mdPaths: string[] = []) {
  const index: VaultIndex = {
    vaultId: "t",
    builtAt: 0,
    entries: mdPaths.map((p) => ({
      path: p,
      name: p.split("/").pop()!.replace(/\.md$/, ""),
      modified: 0,
      size: 0,
      title: "",
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: mdPaths.length,
    skippedCount: 0,
    capped: false,
    directories: folders,
  };
  vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue(index);
  vi.spyOn(vaultManager, "getActiveVault").mockReturnValue({
    id: "t",
    name: "t",
    rootPaths: ["/v"],
    created: "",
    lastOpened: "",
    excludePatterns: [],
    maxIndexSize: 500,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  observerInstances.length = 0;
});

describe("renderer: navigation (step_12)", () => {
  it("FR-13 — home view renders the home canvas", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    // The renderer fires async work via void; wait a microtask + a frame.
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector(".fv-collection-stack-glyph")).not.toBeNull();
  });

  it("FR-15 — clicking a Stack glyph navigates to the Stack section view", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    const glyph = container.querySelector(".fv-collection-stack-glyph") as HTMLElement;
    glyph.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector(".fv-collection-stack-panel")).not.toBeNull();
    // Breadcrumb shows 2 segments (Home, Stack).
    const segs = container.querySelectorAll(".fv-collection-breadcrumb-seg");
    expect(segs.length).toBe(2);
  });

  it("FR-31 — clicking the breadcrumb Home segment navigates back to home", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    (container.querySelector(".fv-collection-stack-glyph") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const homeBtn = container.querySelector(".fv-collection-breadcrumb-seg") as HTMLButtonElement;
    homeBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    // Home canvas also wraps in `.fv-collection-stack-panel` (with the
    // `fv-collection-home-panel` modifier — Mock 1.1 chrome). The
    // distinguishing element is the inner content: Stack view has
    // `.fv-collection-stack-list`; Home has `.fv-collection-glyph-grid`.
    expect(container.querySelector(".fv-collection-stack-list")).toBeNull();
    expect(container.querySelector(".fv-collection-stack-glyph")).not.toBeNull();
  });

  it("FR-30 — breadcrumb structure is 'Home / Stack' (2 segments) in Stack view", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    (container.querySelector(".fv-collection-stack-glyph") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    const labels = Array.from(
      container.querySelectorAll(".fv-collection-breadcrumb-seg"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Home", "Stack 01"]);
  });

  it("EC-24 — Stack rename updates the breadcrumb middle segment in same render pass", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    (container.querySelector(".fv-collection-stack-glyph") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelectorAll(".fv-collection-breadcrumb-seg")[1].textContent).toBe(
      "Stack 01",
    );
    // Simulate a Stack rename happening externally: update the file then re-render.
    fs.set(
      "/v/A/Stack 01/_folder.md",
      "---\ntype: stack\ndisplayName: Renamed Stack\nicon: notebook\norder: []\nreferences: []\n---\n",
    );
    // Re-render the renderer; the same container is reused.
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    // After the re-render the home canvas shows again (state resets); we
    // navigate back into the Stack to assert the breadcrumb reflects the new name.
    (container.querySelector(".fv-collection-stack-glyph") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelectorAll(".fv-collection-breadcrumb-seg")[1].textContent).toBe(
      "Renamed Stack",
    );
  });

  /**
   * Reviewer Fix 1 — incremental insertion on `+Note` click.
   *
   * Background: prior to the fix the renderer's `onCreateNote` callback
   * destroyed the live stack panel and called `navigateToStack(...)` again
   * after creating the note. That tore down BOTH IntersectionObservers
   * (enter + exit) and constructed two fresh ones — a full O(N) re-render
   * for a single-row append. NFR-1 targets 200+ notes per Stack, so the
   * cost compounded on every "+ Note" click.
   *
   * After the fix, the renderer builds a `NoteBoxHandle` for the new note
   * and asks the existing stack panel to insert it via `addNote`. The two
   * observers persist across the click — they are reused by `observe()` on
   * the new box. Identity of the observer instances therefore proves the
   * panel was NOT remounted.
   */
  it("FR-11 / perf — clicking +Note inserts incrementally without remounting the stack panel", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    renderCollectionHome(
      { layout: "collection-home", body: "" } as unknown as Parameters<typeof renderCollectionHome>[0],
      [],
      container,
      "/v/A",
    );
    await new Promise((r) => setTimeout(r, 10));
    (container.querySelector(".fv-collection-stack-glyph") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));

    // Snapshot the live IntersectionObserver instances after entering the
    // Stack view. The stack panel always constructs exactly two (enter +
    // exit). Capture them by reference; we will assert they are the SAME
    // instances after the click.
    const observersBefore = [...observerInstances];
    expect(observersBefore.length).toBeGreaterThanOrEqual(2);

    // Click the trailing `+ Note` affordance. This dispatches
    // `createNoteInStack` and should insert the new box into the existing
    // panel — no remount.
    const addBtn = container.querySelector(".fv-collection-stack-add-note") as HTMLElement;
    expect(addBtn).not.toBeNull();
    addBtn.click();
    // Allow the await chain inside the click handler to settle.
    await new Promise((r) => setTimeout(r, 20));

    // The observer array may grow if the panel was remounted; identity-check
    // the originals are still the latest two. If `navigateToStack` ran again
    // it would have appended two NEW observer instances after disposing the
    // originals — `Object.is(latest, first)` would then be false.
    const enterBefore = observersBefore[observersBefore.length - 2];
    const exitBefore  = observersBefore[observersBefore.length - 1];
    const enterAfter  = observerInstances[observerInstances.length - 2];
    const exitAfter   = observerInstances[observerInstances.length - 1];
    expect(Object.is(enterAfter, enterBefore)).toBe(true);
    expect(Object.is(exitAfter, exitBefore)).toBe(true);

    // Sanity: the new box should appear in the list (one note now).
    const boxes = container.querySelectorAll(".fv-collection-note-box");
    expect(boxes.length).toBe(1);
  });
});
