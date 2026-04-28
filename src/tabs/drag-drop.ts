type DragDropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

interface DragDropEvent {
  payload: DragDropPayload;
}

interface TabOpener {
  openFileInTab(path: string): Promise<boolean>;
}

/**
 * Returns the onDragDropEvent callback for the main window.
 *
 * Accepts .md and .txt paths only (case-sensitive). All other extensions
 * and event types are silently ignored. Files are opened sequentially to
 * preserve payload order and avoid TabManager state races.
 */
export function createDragDropHandler(
  tabManager: TabOpener,
  refreshRecentFilesMenu: () => Promise<void>
): (event: DragDropEvent) => Promise<void> {
  return async (event: DragDropEvent): Promise<void> => {
    if (event.payload.type !== "drop") return;
    const paths = event.payload.paths.filter(
      (p) => p.endsWith(".md") || p.endsWith(".txt")
    );
    if (paths.length === 0) return;
    for (const path of paths) {
      await tabManager.openFileInTab(path);
    }
    await refreshRecentFilesMenu();
  };
}
