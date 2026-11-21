/**
 * html-document-view.ts — sandboxed interactive view of a vault HTML file.
 *
 * The iframe is a unique origin: sandbox does not include allow-same-origin,
 * so the page cannot read the editor DOM or call Tauri. The host injects
 * window.markable in srcdoc before the page's own scripts. The page talks to
 * the host only through postMessage. The host reads notes and opens links.
 */

export interface BridgeIndex {
  vaultId: string;
  builtAt: number;
  capped: boolean;
  entries: Array<{
    path: string;
    name: string;
    title: string;
    tags: string[];
    outboundLinks: string[];
    modified: number;
    size: number;
  }>;
}

export interface NoteDocument {
  path: string;
  title: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  body: string;
}

export type ClassifiedHref =
  | { action: "html"; path: string }
  | { action: "note"; path: string }
  | { action: "external"; url: string }
  | { action: "ignore" };

export interface HtmlDocumentHost {
  readText(path: string): Promise<string | null>;
  bridgeIndex(): BridgeIndex;
  subscribeVault(listener: () => void): () => void;
  readNote(path: string): Promise<{ ok: true; note: NoteDocument | null } | { ok: false }>;
  classifyHref(href: string, pagePath: string): ClassifiedHref;
  openHtml(path: string): void;
  openNote(path: string): void;
  openExternal(url: string): void;
  assetBaseUrl(filePath: string): string;
}

/** Scripts, forms, downloads, dialogs, and popups. Not same-origin, not top navigation. */
const SANDBOX = "allow-scripts allow-forms allow-downloads allow-modals allow-popups";

interface ChildMessage {
  type: string;
  id: unknown;
  path?: string;
  href?: string;
}

/**
 * Mount a vault HTML file into container. The returned function removes the
 * iframe, the window message listener, and the vault subscription. It is safe
 * to call before the file read finishes. A missing file shows an inline error
 * and the returned function does nothing.
 */
export function mountHtmlDocument(
  container: HTMLElement,
  filePath: string,
  host: HtmlDocumentHost,
): () => void {
  container.replaceChildren();

  let disposed = false;
  let iframe: HTMLIFrameElement | null = null;
  let unsubscribe: (() => void) | null = null;

  const onMessage = (event: MessageEvent): void => {
    if (disposed || !iframe || event.source !== iframe.contentWindow) return;
    const message = readChildMessage(event.data);
    if (!message) return;
    if (message.type === "get-note" && message.path !== undefined) {
      const requestId = message.id;
      const notePath = message.path;
      void host.readNote(notePath).then((result) => {
        if (disposed || !iframe?.contentWindow) return;
        if (result.ok) {
          iframe.contentWindow.postMessage(
            {
              source: "markable-host",
              type: "note-result",
              id: requestId,
              ok: true,
              note: result.note,
            },
            "*",
          );
          return;
        }
        iframe.contentWindow.postMessage(
          {
            source: "markable-host",
            type: "note-result",
            id: requestId,
            ok: false,
          },
          "*",
        );
      });
      return;
    }
    if (message.type === "link" && message.href !== undefined) {
      const classified = host.classifyHref(message.href, filePath);
      if (classified.action === "html") host.openHtml(classified.path);
      else if (classified.action === "note") host.openNote(classified.path);
      else if (classified.action === "external") host.openExternal(classified.url);
    }
  };

  const notifyVault = (): void => {
    if (disposed || !iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      {
        source: "markable-host",
        type: "vault-changed",
        index: host.bridgeIndex(),
      },
      "*",
    );
  };

  void host.readText(filePath).then(
    (text) => {
      if (disposed) return;
      if (text == null) {
        showLoadError(container, filePath);
        return;
      }
      const frame = document.createElement("iframe");
      frame.className = "html-document-frame";
      frame.style.display = "block";
      frame.style.width = "100%";
      frame.style.height = "100%";
      frame.style.border = "0";
      frame.style.flex = "1 1 auto";
      frame.setAttribute("sandbox", SANDBOX);
      frame.srcdoc = buildSrcdoc(text, host.assetBaseUrl(filePath), host.bridgeIndex());
      if (disposed) return;

      container.classList.add("html-document-host");
      container.style.display = "flex";
      container.style.flexDirection = "column";
      container.style.height = "100%";
      iframe = frame;
      window.addEventListener("message", onMessage);
      container.appendChild(frame);
      unsubscribe = host.subscribeVault(notifyVault);
    },
    () => {
      if (disposed) return;
      showLoadError(container, filePath);
    },
  );

  return () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", onMessage);
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
  };
}

function showLoadError(container: HTMLElement, filePath: string): void {
  const paragraph = document.createElement("p");
  paragraph.className = "mv-load-error";
  paragraph.textContent = `Could not load file. ${filePath}`;
  container.appendChild(paragraph);
}

function readChildMessage(data: unknown): ChildMessage | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.source !== "markable-html" || typeof record.type !== "string") return null;
  return {
    type: record.type,
    id: record.id,
    path: typeof record.path === "string" ? record.path : undefined,
    href: typeof record.href === "string" ? record.href : undefined,
  };
}

function buildSrcdoc(fileText: string, assetHref: string, index: BridgeIndex): string {
  const script = protectScript(bootstrapScript(jsonForScript(index)));
  const preamble = `<base href="${escapeAttribute(assetHref)}"><script>${script}</script>`;
  return insertAfterHeadOpen(ensureHead(fileText), preamble);
}

function ensureHead(source: string): string {
  if (/<head\b[^>]*>/i.test(source)) return source;
  const htmlOpen = /<html\b[^>]*>/i.exec(source);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return source.slice(0, at) + "<head></head>" + source.slice(at);
  }
  if (/<body\b/i.test(source)) {
    return source.replace(/<body\b/i, "<head></head><body");
  }
  return `<!doctype html><html><head></head><body>${source}</body></html>`;
}

function insertAfterHeadOpen(html: string, insertion: string): string {
  const match = /<head\b[^>]*>/i.exec(html);
  if (!match) return html;
  const at = match.index + match[0].length;
  return html.slice(0, at) + insertion + html.slice(at);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");
}

function jsonForScript(value: unknown): string {
  return (JSON.stringify(value) ?? "null").replace(/</g, "\\u003c");
}

function protectScript(code: string): string {
  return code.replace(/<\/script/gi, "<\\/script");
}

function bootstrapScript(indexJson: string): string {
  return `(function () {
  "use strict";
  var index = ${indexJson};
  var listeners = [];
  var pending = Object.create(null);
  var nextId = 1;

  function copyIndex(value) {
    return JSON.parse(JSON.stringify(value));
  }

  window.markable = {
    getVaultIndex: function () {
      return copyIndex(index);
    },
    getNote: function (path) {
      var id = nextId++;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        window.parent.postMessage({ source: "markable-html", type: "get-note", id: id, path: path }, "*");
      });
    },
    onVaultChange: function (listener) {
      listeners.push(listener);
      return function () {
        var at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    }
  };

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "markable-host") return;
    if (data.type === "note-result") {
      var request = pending[data.id];
      if (!request) return;
      delete pending[data.id];
      if (data.ok === false) request.reject(new Error("getNote failed"));
      else request.resolve(data.note == null ? null : data.note);
      return;
    }
    if (data.type === "vault-changed") {
      index = copyIndex(data.index);
      var current = listeners.slice();
      for (var i = 0; i < current.length; i++) current[i]();
    }
  });

  document.addEventListener("click", function (event) {
    var node = event.target;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (!node || !node.closest) return;
    var anchor = node.closest("a");
    if (!anchor || !anchor.hasAttribute("href") || anchor.hasAttribute("download")) return;
    event.preventDefault();
    window.parent.postMessage({ source: "markable-html", type: "link", href: anchor.getAttribute("href") }, "*");
  }, true);

  try {
    var probeKey = "__markable_ls_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
  } catch (probeError) {
    var store = Object.create(null);
    var order = [];
    var memoryStorage = {
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem: function (key, value) {
        key = String(key);
        if (!Object.prototype.hasOwnProperty.call(store, key)) order.push(key);
        store[key] = String(value);
      },
      removeItem: function (key) {
        key = String(key);
        if (!Object.prototype.hasOwnProperty.call(store, key)) return;
        delete store[key];
        order = order.filter(function (item) { return item !== key; });
      },
      clear: function () {
        store = Object.create(null);
        order = [];
      },
      key: function (index) {
        return order[index] == null ? null : order[index];
      },
      get length() {
        return order.length;
      }
    };
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        enumerable: true,
        get: function () { return memoryStorage; }
      });
    } catch (defineError) {
      try {
        window.localStorage = memoryStorage;
      } catch (assignError) {
        /* The opaque origin blocked both the probe and a replacement. */
      }
    }
  }
})();`;
}
