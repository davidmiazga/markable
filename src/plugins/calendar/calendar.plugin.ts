/**
 * Calendar — plugin id that reveals Daily Note's month calendar.
 *
 * Daily Note owns the grid and opens that day's note. This plugin stays
 * registered so a saved enable does not crash. The plugin manager enables
 * Daily Note before this onEnable runs. onEnable only reveals that panel.
 * It does not register a second month grid.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

const PLUGIN_ID = "calendar";
const DAILY_NOTE_CALENDAR_PANEL = "daily-note-calendar";

export default {
  id: PLUGIN_ID,
  name: "Calendar",
  version: "1.1.0",
  description: "Shows Daily Note's month calendar.",
  detail:
    "Turns Daily Note on and reveals its calendar panel. That panel opens the day's note. This plugin does not draw its own month grid.",

  onEnable(api: MarkablePluginAPI): void {
    api.focusSidebarPanel(DAILY_NOTE_CALENDAR_PANEL);
  },

  onDisable(_api: MarkablePluginAPI): void {},
};
