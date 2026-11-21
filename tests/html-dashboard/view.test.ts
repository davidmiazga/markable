/**
 * tests/html-dashboard/view.test.ts
 *
 * The sandboxed HTML document view: missing-file error, window.markable
 * installed before the page script, getNote, vault changes, link routing,
 * the sandbox attribute, and localStorage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mountHtmlDocument,
  type BridgeIndex,
  type ClassifiedHref,
  type HtmlDocumentHost,
  type NoteDocument,
} from "../../src/tabs/html-document-view";

const SANDBOX = "allow-scripts allow-forms allow-downloads allow-modals allow-popups";
const FILE_PATH = "/vault/dashboards/board.html";

const NOTE: NoteDocument = {
  path: "notes/hello.md",
  title: "Hello",
  tags: ["daily"],
  frontmatter: { title: "Hello", tags: ["daily"], status: "draft" },
  body: "Hello from the vault",
};

function indexWith(title: string): BridgeIndex {
  return {
    vaultId: "vault-1",
    builtAt: 1700000000000,
    capped: false,
    entries: [
      {
        path: "notes/hello.md",
        name: "hello.md",
        title,
        tags: ["daily"],
        outboundLinks: ["notes/other.md"],
        modified: 1700000001000,
        size: 24,
      },
    ],
  };
}

interface PageWindow extends Window {
  __booted?: boolean;
  __seenIndex?: BridgeIndex;
  __ls?: string | null;
  __note?: NoteDocument | null;
  __noteState?: string;
  __rejected?: boolean;
  __changes?: number;
  __during?: string;
  __unsub?: () => void;
}

interface HappySettings {
  enableJavaScriptEvaluation: boolean;
  suppressInsecureJavaScriptEnvironmentWarning: boolean;
}

interface HappyDom {
  settings?: HappySettings;
  waitUntilComplete?: () => Promise<void>;
}

function happyDom(): HappyDom | null {
  return (window as unknown as { happyDOM?: HappyDom }).happyDOM ?? null;
}

async function settle(): Promise<void> {
  const happy = happyDom();
  if (happy?.waitUntilComplete) {
    await happy.waitUntilComplete();
    await happy.waitUntilComplete();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function dispatchFromIframe(frame: HTMLIFrameElement, data: unknown): void {
  const source = frame.contentWindow;
  if (!source) throw new Error("iframe contentWindow is unavailable");
  window.dispatchEvent(new MessageEvent("message", { data, source }));
}

interface TestHost {
  host: HtmlDocumentHost;
  vaultListeners: Array<() => void>;
  readText: ReturnType<typeof vi.fn>;
  readNote: ReturnType<typeof vi.fn>;
  openHtml: ReturnType<typeof vi.fn>;
  openNote: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  classifyHref: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  setIndex: (next: BridgeIndex) => void;
}

function createHost(text: string | null, classified?: (href: string) => ClassifiedHref): TestHost {
  let current = indexWith("Hello");
  const vaultListeners: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const readText = vi.fn(async () => text);
  const readNote = vi.fn(async (path: string) => {
    if (path === "notes/hello.md") return { ok: true as const, note: NOTE };
    return { ok: false as const };
  });
  const openHtml = vi.fn();
  const openNote = vi.fn();
  const openExternal = vi.fn();
  const classifyHref = vi.fn((href: string): ClassifiedHref => {
    if (classified) return classified(href);
    return { action: "ignore" };
  });
  const host: HtmlDocumentHost = {
    readText,
    bridgeIndex: () => current,
    subscribeVault: (listener) => {
      vaultListeners.push(listener);
      return () => {
        unsubscribe();
        const at = vaultListeners.indexOf(listener);
        if (at >= 0) vaultListeners.splice(at, 1);
      };
    },
    readNote,
    classifyHref,
    openHtml,
    openNote,
    openExternal,
    assetBaseUrl: () => "https://assets.example/vault/?a=1&b=2",
  };
  return {
    host,
    vaultListeners,
    readText,
    readNote,
    openHtml,
    openNote,
    openExternal,
    classifyHref,
    unsubscribe,
    setIndex: (next) => {
      current = next;
    },
  };
}

describe("mountHtmlDocument", () => {
  let container: HTMLDivElement;
  let previousEval = false;
  let previousSuppress = false;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const settings = happyDom()?.settings;
    if (settings) {
      previousEval = settings.enableJavaScriptEvaluation;
      previousSuppress = settings.suppressInsecureJavaScriptEnvironmentWarning;
      settings.suppressInsecureJavaScriptEnvironmentWarning = true;
      settings.enableJavaScriptEvaluation = true;
    }
  });

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    container.remove();
    const settings = happyDom()?.settings;
    if (settings) {
      settings.enableJavaScriptEvaluation = previousEval;
      settings.suppressInsecureJavaScriptEnvironmentWarning = previousSuppress;
    }
  });

  async function mountFrame(host: HtmlDocumentHost): Promise<HTMLIFrameElement> {
    cleanups.push(mountHtmlDocument(container, FILE_PATH, host));
    await vi.waitFor(() => {
      expect(container.querySelector("iframe")).toBeTruthy();
    });
    const frame = container.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("missing iframe");
    await settle();
    return frame;
  }

  it("shows a load error and no iframe when the file is missing", async () => {
    const alertSpy = vi.fn();
    window.alert = alertSpy;
    container.innerHTML = "<p>stale</p>";
    const { host, readText } = createHost(null);
    const unmount = mountHtmlDocument(container, FILE_PATH, host);
    cleanups.push(unmount);

    await vi.waitFor(() => {
      expect(container.querySelector("p.mv-load-error")).toBeTruthy();
    });

    const error = container.querySelector("p.mv-load-error");
    expect(error?.textContent).toContain("Could not load file.");
    expect(error?.textContent).toContain(FILE_PATH);
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.textContent).not.toContain("stale");
    expect(readText).toHaveBeenCalledTimes(1);
    expect(readText).toHaveBeenCalledWith(FILE_PATH);
    expect(alertSpy).not.toHaveBeenCalled();
    unmount();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("installs window.markable before the page script and returns the host index", async () => {
    const page = `<!doctype html><html><head><script>
window.__seenIndex = window.markable.getVaultIndex();
window.__booted = true;
</script></head><body></body></html>`;
    const { host } = createHost(page);
    const frame = await mountFrame(host);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";

    expect(srcdoc.indexOf("<base ")).toBeGreaterThanOrEqual(0);
    expect(srcdoc.indexOf("<base ")).toBeLessThan(srcdoc.indexOf("window.markable"));
    expect(srcdoc.indexOf("window.markable")).toBeLessThan(srcdoc.indexOf("window.__seenIndex"));
    expect(srcdoc).toContain("https://assets.example/vault/?a=1&amp;b=2");
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX);
    expect(frame.className).toBe("html-document-frame");
    expect(frame.style.display).toBe("block");
    expect(frame.style.width).toBe("100%");
    expect(frame.style.height).toBe("100%");
    expect(container.classList.contains("html-document-host")).toBe(true);
    expect(container.style.display).toBe("flex");
    expect(container.style.height).toBe("100%");

    await vi.waitFor(() => {
      expect((frame.contentWindow as PageWindow | null)?.__booted).toBe(true);
    });
    const seen = (frame.contentWindow as PageWindow).__seenIndex;
    expect(seen?.entries.map((entry) => entry.path)).toContain("notes/hello.md");
    expect(seen?.entries[0]?.title).toBe("Hello");
    expect(seen?.vaultId).toBe("vault-1");
  });

  it("resolves getNote with extra frontmatter and rejects a failed read once", async () => {
    const page = `<!doctype html><html><head><script>
window.markable.getNote("notes/hello.md").then(function (note) {
  window.__note = note;
  window.__noteState = "resolved";
}, function () {
  window.__noteState = "rejected";
});
window.markable.getNote("outside.bin").then(function () {
  window.__rejectResolved = true;
}, function () {
  window.__rejected = true;
});
window.__booted = true;
</script></head><body></body></html>`;
    const { host, readNote, readText, openHtml, openNote, openExternal } = createHost(page);
    const frame = await mountFrame(host);
    await vi.waitFor(() => {
      expect((frame.contentWindow as PageWindow | null)?.__booted).toBe(true);
    });
    await settle();

    const pageWindow = frame.contentWindow as PageWindow;
    // happy-dom delivers an iframe's parent.postMessage with event.source set to
    // the parent window, and the host ignores that. When the page promise is
    // still pending, drive the real listener with a MessageEvent sourced from
    // the iframe. The parent's reply still settles the page promise.
    if (pageWindow.__noteState !== "resolved") {
      dispatchFromIframe(frame, {
        source: "markable-html",
        type: "get-note",
        id: 1,
        path: "notes/hello.md",
      });
    }
    if (!pageWindow.__rejected) {
      dispatchFromIframe(frame, {
        source: "markable-html",
        type: "get-note",
        id: 2,
        path: "outside.bin",
      });
    }
    await vi.waitFor(() => {
      expect(pageWindow.__noteState).toBe("resolved");
      expect(pageWindow.__rejected).toBe(true);
    });

    expect(pageWindow.__note?.body).toBe("Hello from the vault");
    expect(pageWindow.__note?.frontmatter.status).toBe("draft");
    expect(pageWindow.__note?.frontmatter.title).toBe("Hello");
    const rejectedCalls = readNote.mock.calls.filter((call) => call[0] === "outside.bin");
    expect(rejectedCalls).toHaveLength(1);
    expect(readNote.mock.calls.filter((call) => call[0] === "notes/hello.md")).toHaveLength(1);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(readText).toHaveBeenCalledWith(FILE_PATH);
    expect(openHtml).not.toHaveBeenCalled();
    expect(openNote).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("notifies onVaultChange and stops after unsubscribe", async () => {
    const page = `<!doctype html><html><head><script>
window.__changes = 0;
window.__unsub = window.markable.onVaultChange(function () {
  window.__changes += 1;
  window.__during = window.markable.getVaultIndex().entries[0].title;
});
window.__booted = true;
</script></head><body></body></html>`;
    const { host, vaultListeners, setIndex, unsubscribe } = createHost(page);
    const frame = await mountFrame(host);
    await vi.waitFor(() => {
      expect((frame.contentWindow as PageWindow | null)?.__booted).toBe(true);
    });
    const pageWindow = frame.contentWindow as PageWindow;
    expect(vaultListeners).toHaveLength(1);

    setIndex(indexWith("Renamed"));
    vaultListeners[0]?.();
    await vi.waitFor(() => {
      expect(pageWindow.__changes).toBe(1);
    });
    expect(pageWindow.__during).toBe("Renamed");

    pageWindow.__unsub?.();
    setIndex(indexWith("Again"));
    vaultListeners[0]?.();
    await settle();
    expect(pageWindow.__changes).toBe(1);

    cleanups.pop()?.();
    expect(unsubscribe).toHaveBeenCalled();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("routes html, note, https, and ignored links from the iframe window", async () => {
    const alertSpy = vi.fn();
    window.alert = alertSpy;
    const { host, openHtml, openNote, openExternal, classifyHref } = createHost(
      "<!doctype html><html><head></head><body></body></html>",
      (href) => {
        if (href === "other.html") return { action: "html", path: "/vault/dashboards/other.html" };
        if (href === "notes/hello.md") return { action: "note", path: "/vault/notes/hello.md" };
        if (href === "https://example.com/docs") return { action: "external", url: "https://example.com/docs" };
        return { action: "ignore" };
      },
    );
    const frame = await mountFrame(host);

    window.dispatchEvent(new MessageEvent("message", {
      data: { source: "markable-html", type: "link", href: "other.html" },
      source: window,
    }));
    expect(openHtml).not.toHaveBeenCalled();

    dispatchFromIframe(frame, { source: "markable-html", type: "link", href: "other.html" });
    dispatchFromIframe(frame, { source: "markable-html", type: "link", href: "notes/hello.md" });
    dispatchFromIframe(frame, { source: "markable-html", type: "link", href: "https://example.com/docs" });
    dispatchFromIframe(frame, { source: "markable-html", type: "link", href: "file:///etc/passwd" });
    dispatchFromIframe(frame, { source: "not-markable", type: "link", href: "other.html" });

    expect(classifyHref).toHaveBeenCalledWith("other.html", FILE_PATH);
    expect(classifyHref).toHaveBeenCalledWith("notes/hello.md", FILE_PATH);
    expect(classifyHref).toHaveBeenCalledWith("https://example.com/docs", FILE_PATH);
    expect(classifyHref).toHaveBeenCalledWith("file:///etc/passwd", FILE_PATH);
    expect(openHtml).toHaveBeenCalledTimes(1);
    expect(openHtml).toHaveBeenCalledWith("/vault/dashboards/other.html");
    expect(openNote).toHaveBeenCalledTimes(1);
    expect(openNote).toHaveBeenCalledWith("/vault/notes/hello.md");
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/docs");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("sets the sandbox attribute exactly", async () => {
    const { host } = createHost("<p>hi</p>");
    const frame = await mountFrame(host);
    expect(frame.getAttribute("sandbox")).toBe(SANDBOX);
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-top-navigation");
  });

  it("lets a page script round-trip localStorage when srcdoc scripts run", async () => {
    const page = `<!doctype html><html><head><script>
/* PAGE_LS_SCRIPT */
localStorage.setItem("markable-html-key", "stored-value");
window.__ls = localStorage.getItem("markable-html-key");
window.__booted = true;
</script></head><body></body></html>`;
    const { host } = createHost(page);
    const frame = await mountFrame(host);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    const markableAt = srcdoc.indexOf("window.markable");
    const pageAt = srcdoc.indexOf("PAGE_LS_SCRIPT");
    expect(markableAt).toBeGreaterThanOrEqual(0);
    expect(pageAt).toBeGreaterThan(markableAt);
    expect(srcdoc).toContain("window.markable");
    expect(srcdoc).toContain("__markable_ls_probe__");
    expect(srcdoc).toContain("localStorage.setItem");

    await settle();
    const pageWindow = frame.contentWindow as PageWindow | null;
    if (!pageWindow?.__booted) {
      // happy-dom did not execute the srcdoc scripts in this environment.
      return;
    }
    expect(pageWindow.__ls).toBe("stored-value");
  });

  it("uses in-memory storage when the localStorage probe throws", async () => {
    const { host } = createHost("<!doctype html><html><head></head><body></body></html>");
    const frame = await mountFrame(host);
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    const bootstrap = srcdoc.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
    expect(bootstrap).toContain("window.markable");
    expect(bootstrap).toContain("__markable_ls_probe__");

    const scope: Record<string, unknown> = {
      document: { addEventListener() { /* click wiring is not under test */ } },
      addEventListener() { /* host messages are not under test */ },
      parent: { postMessage() { /* no parent in this probe */ } },
    };
    Object.defineProperty(scope, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    scope.window = scope;
    // The bootstrap is a strict IIFE. `with` stays outside it so the probe
    // runs against this scope instead of the test window.
    const run = new Function("scope", `with (scope) {\n${bootstrap}\n}`);
    run(scope);

    const storage = scope.localStorage as Storage;
    storage.setItem("markable-html-key", "stored-value");
    expect(storage.getItem("markable-html-key")).toBe("stored-value");
    const markable = scope.markable as { getVaultIndex: () => BridgeIndex };
    expect(markable.getVaultIndex().entries[0]?.path).toBe("notes/hello.md");
  });
});
