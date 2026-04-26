/**
 * src/tabs/index.ts — Public re-export facade for the tab system.
 *
 * Consumers (main.ts, future settings panel integration) import from
 * "src/tabs/" or "../tabs/" without needing to know the internal file layout.
 *
 * The singleton `tabManager` export is the primary integration point for
 * main.ts. The class export `TabManager` is provided for isolated unit tests
 * that need to construct fresh instances.
 */

export { TabManager, tabManager } from "./tab-manager";
export type { TabEntry, ITabRenderer } from "./tab-types";
export { TAB_SOFT_WARNING_THRESHOLD } from "./tab-types";
