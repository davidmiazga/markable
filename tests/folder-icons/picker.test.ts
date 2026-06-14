/**
 * tests/folder-icons/picker.test.ts — step_06
 *
 * Asserts the folder-icon picker modal:
 *   - EC-9: highlights the currently assigned icon (catalog AND custom).
 *   - Apply button gating (disabled until selection differs from current).
 *   - EC-10: Apply is disabled while the write is in flight.
 *   - Remove button calls setFolderIcon(folderPath, undefined).
 *   - Cancel closes without calling setFolderIcon.
 *   - Custom section renders one tile per `customFolderIcons` entry.
 *   - EC-18 / EC-19: Add custom SVG flow surfaces validator errors.
 *   - EC-20: Add at cap surfaces refuse-add error without opening dialog.
 *   - Remove-from-Custom × button calls removeCustomIcon + re-renders.
 *
 * Modules are imported lazily inside `it()` blocks (via `await import`) so
 * each test can apply its own `vi.spyOn` before the module evaluates side-
 * effecting code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
}));

import * as store from "../../src/plugins/file-browser/folder-icon-store";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("openFolderIconPicker — curated section + Apply/Remove/Cancel (step_06)", () => {
  it("EC-9 — highlights the currently assigned icon when the modal opens", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    const selected = document.querySelector(".folder-icon-tile-selected");
    expect(selected?.getAttribute("data-icon-id")).toBe("book");
  });

  it("no tile selected when no current icon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    expect(
      document.querySelectorAll(".folder-icon-tile-selected").length,
    ).toBe(0);
  });

  it("Apply disabled until the user picks a different icon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    const apply = document.querySelector(
      ".folder-icon-picker-apply",
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    (document.querySelector(
      `.folder-icon-tile[data-icon-id="lightbulb"]`,
    ) as HTMLElement).click();
    expect(apply.disabled).toBe(false);
  });

  it("EC-10 — Apply is disabled while the write is in flight; onChange fires on resolve", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    let resolveWrite: (() => void) | null = null;
    vi.spyOn(store, "setFolderIcon").mockImplementation(
      () =>
        new Promise((res) => {
          resolveWrite = () => res({ ok: true, value: undefined });
        }),
    );
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const onChange = vi.fn();
    const done = openFolderIconPicker("/v/A", { onChange });
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      `.folder-icon-tile[data-icon-id="book"]`,
    ) as HTMLElement).click();
    const apply = document.querySelector(
      ".folder-icon-picker-apply",
    ) as HTMLButtonElement;
    apply.click();
    expect(apply.disabled).toBe(true);
    resolveWrite!();
    await done;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector(".folder-icon-picker-overlay"),
    ).toBeNull();
  });

  it("Remove button calls setFolderIcon with undefined", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const setSpy = vi
      .spyOn(store, "setFolderIcon")
      .mockResolvedValue({ ok: true, value: undefined });
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const done = openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      ".folder-icon-picker-remove",
    ) as HTMLButtonElement).click();
    await done;
    expect(setSpy).toHaveBeenCalledWith("/v/A", undefined);
  });

  it("Cancel closes without calling setFolderIcon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const setSpy = vi.spyOn(store, "setFolderIcon");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const done = openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      ".folder-icon-picker-cancel",
    ) as HTMLButtonElement).click();
    await done;
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("openFolderIconPicker — Custom section (step_06 amendment)", () => {
  it("renders one tile per entry in customFolderIcons", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([
      { path: "/u/a.svg", label: "a", addedAt: 1 },
      { path: "/u/b.svg", label: "b", addedAt: 2 },
    ]);
    const cache = await import(
      "../../src/plugins/file-browser/folder-icon-custom-cache"
    );
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(
      `<svg><circle r="3"/></svg>`,
    );

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 20));
    const tiles = document.querySelectorAll(".folder-icon-tile-custom");
    expect(tiles.length).toBe(2);
    // Ordering is owned by `getCustomIcons` (sorted by addedAt desc in
    // production). In this test the mock returns the array verbatim — the
    // picker iterates in mock order, so the first tile is the first mock
    // entry. The sort itself is unit-tested in custom-settings.test.ts.
    expect((tiles[0] as HTMLElement).dataset.iconPath).toBe("/u/a.svg");
  });

  it("EC-9 — highlights the custom tile when current icon is a custom path", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("/u/a.svg");
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([
      { path: "/u/a.svg", label: "a", addedAt: 1 },
    ]);
    const cache = await import(
      "../../src/plugins/file-browser/folder-icon-custom-cache"
    );
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg/>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 20));
    const selected = document.querySelector(
      ".folder-icon-tile-selected",
    ) as HTMLElement;
    expect(selected.dataset.iconPath).toBe("/u/a.svg");
  });

  it("EC-18 — Add custom SVG with invalid file shows validator error and does not call addCustomIcon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([]);
    const addSpy = vi.spyOn(settings, "addCustomIcon");

    const dialogs = await import("../../src/lib/dialogs");
    vi.spyOn(dialogs, "openAssetDialog").mockResolvedValue({
      cancelled: false,
      path: "/u/bad.svg",
    });

    const bridge = await import("../../src/lib/bridge");
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: "not an svg",
    });

    const validator = await import(
      "../../src/plugins/file-browser/svg-validator"
    );
    vi.spyOn(validator, "validateSvgFile").mockReturnValue({
      ok: false,
      reason: "parse_error",
    });

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      ".folder-icon-picker-add",
    ) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(addSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/not a valid svg/i);
  });

  it("EC-19 — Add custom SVG above 32 KB shows size error", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([]);
    const addSpy = vi.spyOn(settings, "addCustomIcon");
    const dialogs = await import("../../src/lib/dialogs");
    vi.spyOn(dialogs, "openAssetDialog").mockResolvedValue({
      cancelled: false,
      path: "/u/big.svg",
    });
    const bridge = await import("../../src/lib/bridge");
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: "x".repeat(33 * 1024),
    });
    const validator = await import(
      "../../src/plugins/file-browser/svg-validator"
    );
    vi.spyOn(validator, "validateSvgFile").mockReturnValue({
      ok: false,
      reason: "too_large",
    });

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      ".folder-icon-picker-add",
    ) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(addSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/32 ?kb/i);
  });

  it("EC-19 — Add custom SVG passes UTF-8 BYTE length to validator (not JS string length)", async () => {
    // Issue 3 (Reviewer): the picker previously passed `content.length` (UTF-16
    // code units) as the second argument to `validateSvgFile(content, byteLength)`.
    // For ASCII content the two coincide, so the existing EC-19 test missed
    // this. With multibyte UTF-8 content the byte length is strictly larger
    // than the JS string length — the picker MUST pass the encoded byte count
    // so the validator's 32 KB cap is enforced in true file-size terms.
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([]);
    vi.spyOn(settings, "addCustomIcon").mockResolvedValue({
      ok: true,
      value: undefined,
    } as never);
    const dialogs = await import("../../src/lib/dialogs");
    vi.spyOn(dialogs, "openAssetDialog").mockResolvedValue({
      cancelled: false,
      path: "/u/multibyte.svg",
    });
    const bridge = await import("../../src/lib/bridge");
    // 4-byte UTF-8 char (U+10080). Byte length = 4 * count; JS length = 2 * count.
    const astral = "\u{10080}";
    const content = `<svg><desc>${astral.repeat(10)}</desc></svg>`;
    const expectedByteLength = new TextEncoder().encode(content).length;
    // Sanity: the two differ for multibyte content.
    expect(content.length).not.toBe(expectedByteLength);
    vi.spyOn(bridge, "readFile").mockResolvedValue({
      ok: true,
      value: content,
    });
    const validator = await import(
      "../../src/plugins/file-browser/svg-validator"
    );
    const validateSpy = vi
      .spyOn(validator, "validateSvgFile")
      .mockReturnValue({ ok: true });

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 10));
    (document.querySelector(
      ".folder-icon-picker-add",
    ) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));

    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledWith(content, expectedByteLength);
  });

  it("EC-20 — Add custom SVG at cap surfaces refuse-add error and does not open dialog", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    const full = Array.from({ length: 100 }, (_, i) => ({
      path: `/u/${i}.svg`,
      label: `${i}`,
      addedAt: i,
    }));
    vi.spyOn(settings, "getCustomIcons").mockReturnValue(full);
    const dialogs = await import("../../src/lib/dialogs");
    const dlgSpy = vi.spyOn(dialogs, "openAssetDialog");
    const cache = await import(
      "../../src/plugins/file-browser/folder-icon-custom-cache"
    );
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg/>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 20));
    (document.querySelector(
      ".folder-icon-picker-add",
    ) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(dlgSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/limit reached/i);
  });

  it("Remove-from-Custom × button calls removeCustomIcon and re-renders without that tile", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import(
      "../../src/plugins/file-browser/folder-icon-custom-settings"
    );
    const stub = [{ path: "/u/a.svg", label: "a", addedAt: 1 }];
    vi.spyOn(settings, "getCustomIcons").mockImplementation(() =>
      stub.slice(),
    );
    const removeSpy = vi
      .spyOn(settings, "removeCustomIcon")
      .mockImplementation(async (p: string) => {
        const i = stub.findIndex((e) => e.path === p);
        if (i >= 0) stub.splice(i, 1);
      });
    const cache = await import(
      "../../src/plugins/file-browser/folder-icon-custom-cache"
    );
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg/>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise((r) => setTimeout(r, 20));
    (document.querySelector(
      ".folder-icon-tile-remove",
    ) as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(removeSpy).toHaveBeenCalledWith("/u/a.svg");
    expect(
      document.querySelectorAll(".folder-icon-tile-custom").length,
    ).toBe(0);
  });
});
