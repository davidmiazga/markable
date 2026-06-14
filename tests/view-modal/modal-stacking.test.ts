/**
 * tests/view-modal/modal-stacking.test.ts (step_06)
 *
 * EC-12 — modal stacking refusal. When ANY other modal is open,
 * calling `openViewModal(...)` is a silent no-op. Uses the sentinel
 * id/selector list in `src/lib/active-modal.ts` (AD-8).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  openViewModal,
  VIEW_MODAL_OVERLAY_ID,
} from "../../src/lib/codeblock-modal";
import {
  isAnyModalOpen,
  currentModalSource,
  KNOWN_MODAL_OVERLAY_IDS,
} from "../../src/lib/active-modal";

function cleanup(): void {
  document.body.innerHTML = "";
}

beforeEach(cleanup);
afterEach(cleanup);

describe("isAnyModalOpen unit (step_06)", () => {
  it("returns false when no overlay exists", () => {
    expect(isAnyModalOpen()).toBe(false);
    expect(currentModalSource()).toBeNull();
  });

  it("returns true for each id in KNOWN_MODAL_OVERLAY_IDS", () => {
    for (const id of KNOWN_MODAL_OVERLAY_IDS) {
      const stub = document.createElement("div");
      stub.id = id;
      document.body.appendChild(stub);
      expect(isAnyModalOpen()).toBe(true);
      stub.remove();
    }
  });

  it("returns true for class-based folder-icon-picker overlay", () => {
    const stub = document.createElement("div");
    stub.className = "folder-icon-picker-overlay";
    document.body.appendChild(stub);
    expect(isAnyModalOpen()).toBe(true);
  });

  it("returns true for settings-overlay when NOT hidden, false when hidden", () => {
    const stub = document.createElement("div");
    stub.id = "settings-overlay";
    document.body.appendChild(stub);
    expect(isAnyModalOpen()).toBe(true);
    // The settings panel toggles `.hidden` on close; we treat hidden as closed.
    stub.classList.add("hidden");
    expect(isAnyModalOpen()).toBe(false);
  });
});

describe("openViewModal — EC-12 refusal (step_06)", () => {
  it("EC-12 — no-op when settings panel is the open modal", () => {
    const stub = document.createElement("div");
    stub.id = "settings-overlay";
    document.body.appendChild(stub);
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(document.getElementById(VIEW_MODAL_OVERLAY_ID)).toBeNull();
  });

  it("EC-12 — no-op when folder-icon picker is open", () => {
    const stub = document.createElement("div");
    stub.className = "folder-icon-picker-overlay";
    document.body.appendChild(stub);
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(document.getElementById(VIEW_MODAL_OVERLAY_ID)).toBeNull();
  });

  it("EC-12 — no-op when command bar is open", () => {
    const stub = document.createElement("div");
    stub.id = "markable-command-bar-overlay";
    document.body.appendChild(stub);
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(document.getElementById(VIEW_MODAL_OVERLAY_ID)).toBeNull();
  });

  it("EC-12 — double-open guard: a second open while the view modal is already open is a no-op", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    openViewModal("create", { folderPath: "/v/Foo" });
    const overlays = document.querySelectorAll(`#${VIEW_MODAL_OVERLAY_ID}`);
    expect(overlays.length).toBe(1);
  });

  it("EC-12 — silent: no console.error, no toast", () => {
    const stub = document.createElement("div");
    stub.id = "settings-overlay";
    document.body.appendChild(stub);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("opens normally when no other modal is mounted", () => {
    openViewModal("create", { folderPath: "/v/Foo" });
    expect(document.getElementById(VIEW_MODAL_OVERLAY_ID)).toBeTruthy();
  });
});
