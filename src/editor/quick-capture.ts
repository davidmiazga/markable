import { ensureDirectory, getHomeDir, writeFile } from "../lib/bridge";
import { getCurrentSettings } from "../lib/settings";

// ── QuickCaptureWidget ────────────────────────────────────────────────────────

export class QuickCaptureWidget {
  private root: HTMLDivElement;
  private titleInput: HTMLInputElement;
  private contentArea: HTMLTextAreaElement;
  private inboxLabel: HTMLSpanElement;
  private _titleDirty = false;

  constructor() {
    this.root = document.createElement("div");
    this.titleInput = document.createElement("input");
    this.contentArea = document.createElement("textarea");
    this.inboxLabel = document.createElement("span");
    this._buildDom();
    this._attachEvents();
    document.body.appendChild(this.root);
  }

  open(): void {
    this._titleDirty = false;
    this.contentArea.value = "";
    this.titleInput.value = "";
    this.inboxLabel.textContent = this._getInboxPath();
    this.root.style.display = "";
    this.titleInput.focus();
  }

  close(): void {
    this.root.style.display = "none";
  }

  destroy(): void {
    this.root.remove();
  }

  // ── Exposed for testing ─────────────────────────────────────────────────────

  _deriveTitle(content: string): string {
    const firstLine = content.split("\n")[0] ?? "";
    // Strip Markdown heading markers, bold/italic/code delimiters
    const stripped = firstLine
      .replace(/^#+\s*/, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (!stripped) return "capture";
    return stripped.slice(0, 60);
  }

  _buildFilename(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "capture";
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const ts = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      "T",
      pad(now.getHours()),
      "-",
      pad(now.getMinutes()),
      "-",
      pad(now.getSeconds()),
    ].join("");
    return `${slug}-${ts}.md`;
  }

  _getInboxPath(): string {
    const settings = getCurrentSettings();
    const qc = settings.quickCapture ?? { inboxFolder: "Inbox", fallbackPath: "~/Documents/Markable Inbox" };
    const vault = (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVault?.();
    if (vault?.rootPaths?.[0]) {
      return vault.rootPaths[0] + "/" + qc.inboxFolder;
    }
    return qc.fallbackPath;
  }

  async _expandHome(p: string): Promise<string> {
    if (!p.startsWith("~/")) return p;
    try {
      const home = await getHomeDir();
      return home + p.slice(1);
    } catch {
      return p;
    }
  }

  async _save(): Promise<void> {
    const title = this.titleInput.value.trim() || this._deriveTitle(this.contentArea.value);
    const filename = this._buildFilename(title);
    const rawDir = this._getInboxPath();
    const inboxDir = await this._expandHome(rawDir);
    const filepath = inboxDir + "/" + filename;

    try {
      await ensureDirectory(inboxDir);
    } catch (e) {
      this.inboxLabel.textContent = `Error: ${e}`;
      return;
    }

    const result = await writeFile(filepath, this.contentArea.value);
    if (result.ok) {
      this.close();
    } else {
      this.inboxLabel.textContent = `Error: ${result.error.message}`;
    }
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private _buildDom(): void {
    this.root.id = "quick-capture-overlay";
    this.root.style.display = "none";

    // Panel (centered card inside the backdrop)
    const panel = document.createElement("div");
    panel.className = "qc-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Quick Capture");

    // Header
    const header = document.createElement("div");
    header.className = "qc-header";
    const headerLabel = document.createElement("span");
    headerLabel.className = "qc-header-label";
    headerLabel.textContent = "Quick Capture";
    const closeBtn = document.createElement("button");
    closeBtn.className = "qc-close";
    closeBtn.textContent = "Esc";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(headerLabel);
    header.appendChild(closeBtn);

    // Title row
    const titleRow = document.createElement("div");
    titleRow.className = "qc-title-row";
    const titlePrefix = document.createElement("span");
    titlePrefix.className = "qc-title-prefix";
    titlePrefix.textContent = "Title";
    this.titleInput.className = "qc-title-input";
    this.titleInput.type = "text";
    this.titleInput.spellcheck = false;
    this.titleInput.setAttribute("autocomplete", "off");
    titleRow.appendChild(titlePrefix);
    titleRow.appendChild(this.titleInput);

    // Content textarea
    this.contentArea.className = "qc-content";
    this.contentArea.rows = 10;
    this.contentArea.placeholder = "Start typing…";

    // Footer
    const footer = document.createElement("div");
    footer.className = "qc-footer";
    this.inboxLabel.className = "qc-inbox-label";
    const hint = document.createElement("span");
    hint.className = "qc-hint";
    hint.textContent = "⌘↵";
    footer.appendChild(this.inboxLabel);
    footer.appendChild(hint);

    panel.appendChild(header);
    panel.appendChild(titleRow);
    panel.appendChild(this.contentArea);
    panel.appendChild(footer);
    this.root.appendChild(panel);
  }

  private _attachEvents(): void {
    // Content auto-derives title when not dirty
    this.contentArea.addEventListener("input", () => {
      if (!this._titleDirty) {
        this.titleInput.value = this._deriveTitle(this.contentArea.value);
      }
    });

    // Title pre-selects on focus; marks dirty on input
    this.titleInput.addEventListener("focus", () => {
      this.titleInput.select();
    });
    this.titleInput.addEventListener("input", () => {
      this._titleDirty = true;
    });

    // Tab in content area → move focus to title
    this.contentArea.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        this.titleInput.focus();
      }
    });

    // Keyboard shortcuts on the overlay (capture phase)
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        void this._save();
      }
    });

    // Click on backdrop (the overlay root itself, not a child) closes
    this.root.addEventListener("mousedown", (e) => {
      if (e.target === this.root) this.close();
    });
  }
}
