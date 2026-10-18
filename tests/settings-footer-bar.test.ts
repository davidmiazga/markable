/**
 * The settings footer uses the same solid panel surface as the title bar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const css = readFileSync(join(process.cwd(), "src/settings/settings-panel.css"), "utf8");

describe("settings footer bar", () => {
  beforeEach(() => {
    document.documentElement.style.setProperty("--bg-primary", "rgb(22, 24, 28)");
    const style = document.createElement("style");
    style.id = "settings-panel-css";
    style.textContent = css;
    document.head.appendChild(style);
  });

  afterEach(() => {
    document.getElementById("settings-panel-css")?.remove();
    document.body.innerHTML = "";
  });

  it("paints the footer with the title bar background so content cannot show through", () => {
    const panel = document.createElement("div");
    panel.className = "settings-panel";
    panel.innerHTML = `
      <div class="settings-header"></div>
      <div class="settings-footer"><button class="btn btn-tertiary settings-btn-reset">Reset All</button></div>
    `;
    document.body.appendChild(panel);
    const header = panel.querySelector(".settings-header") as HTMLElement;
    const footer = panel.querySelector(".settings-footer") as HTMLElement;
    const headerBg = getComputedStyle(header).backgroundColor;
    const footerBg = getComputedStyle(footer).backgroundColor;
    expect(footerBg).toBe(headerBg);
    expect(footerBg).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(footer).flexShrink).toBe("0");
  });
});
