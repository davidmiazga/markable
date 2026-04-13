/**
 * Public re-export facade for the sidebar module.
 *
 * Consumers (markable-plugin-api.ts, main.ts) import from "src/sidebar/"
 * without knowing the internal file layout.
 *
 * Named exports are chosen to be self-documenting at the call site in main.ts
 * and in plugin code. For example:
 *   import { initSidebar, restoreSidebarFromSettings } from "./sidebar";
 */
export type { SidebarPanelDescriptor } from "./sidebar-manager";
export {
  init as initSidebar,
  register as registerSidebarPanel,
  unregister as unregisterSidebarPanel,
  toggleSide as toggleSidebarSide,
  restoreFromSettings as restoreSidebarFromSettings,
  movePanel,
  movePanelToSide,
} from "./sidebar-manager";
