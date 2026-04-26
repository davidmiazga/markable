import type { TabEntry } from "../../src/tabs/tab-types";

export function makeTab(overrides: Partial<TabEntry> = {}): TabEntry {
  return {
    id: crypto.randomUUID(),
    filePath: null,
    title: "Untitled",
    isDirty: false,
    doc: "",
    scrollTop: 0,
    ...overrides,
  };
}

export function makeTabs(n: number): TabEntry[] {
  return Array.from({ length: n }, (_, i) =>
    makeTab({ title: `Tab ${i + 1}`, id: `tab-id-${i}` })
  );
}
