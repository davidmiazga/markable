/**
 * tests/html-dashboard/window.test.ts
 *
 * Opening a vault HTML file in a second Markable window must not close
 * the window that requested it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { close, destroy } = vi.hoisted(() => ({
  close: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(),
  getCurrentWebviewWindow: vi.fn(() => ({
    close,
    destroy,
  })),
}));

import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  openInNewMarkableWindow,
  readHtmlOpenQuery,
} from "../../src/tabs/markable-window";

const mockWebviewWindow = WebviewWindow as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openInNewMarkableWindow", () => {
  it("constructs a window whose url contains the encoded path and whose label is not main", async () => {
    await openInNewMarkableWindow("/vault/dash.html");

    expect(mockWebviewWindow).toHaveBeenCalledTimes(1);
    const [label, options] = mockWebviewWindow.mock.calls[0] as [
      string,
      { url: string },
    ];
    expect(label).not.toBe("main");
    expect(label.startsWith("markable-")).toBe(true);
    expect(options.url).toContain(encodeURIComponent("/vault/dash.html"));
  });

  it("uses a different label for each call", async () => {
    await openInNewMarkableWindow("/vault/dash.html");
    await openInNewMarkableWindow("/vault/other.html");

    const labels = mockWebviewWindow.mock.calls.map((call) => call[0]);
    expect(labels).toHaveLength(2);
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("does not close or destroy the current window", async () => {
    const current = getCurrentWebviewWindow();
    await openInNewMarkableWindow("/vault/dash.html");

    expect(current.close).not.toHaveBeenCalled();
    expect(current.destroy).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});

describe("readHtmlOpenQuery", () => {
  it("decodes a present html parameter", () => {
    expect(readHtmlOpenQuery("?html=%2Fvault%2Fa.html")).toBe("/vault/a.html");
  });

  it("returns null when the parameter is absent or empty", () => {
    expect(readHtmlOpenQuery("")).toBeNull();
    expect(readHtmlOpenQuery("?html=")).toBeNull();
  });
});
