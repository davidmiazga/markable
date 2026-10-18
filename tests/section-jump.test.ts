import { describe, expect, it, vi } from "vitest";
import { scrollSectionIntoPane } from "../src/lib/section-jump";

describe("section jump tail", () => {
  it("adds a pane-height of space so a bottom section can reach the top", () => {
    const pane = document.createElement("div");
    const section = document.createElement("div");
    pane.append(section);
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 280 });
    vi.spyOn(pane, "scrollTo").mockImplementation(() => {});

    scrollSectionIntoPane(pane, section);

    expect(pane.style.paddingBottom).toBe("280px");
  });
});
