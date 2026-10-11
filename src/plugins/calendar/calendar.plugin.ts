/**
 * Calendar — retired duplicate of Daily Note's month grid.
 *
 * The diary calendar lives in Daily Note and opens that day's note.
 * This plugin stays registered so an older enable flag does not crash,
 * and it no longer draws a second month grid.
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

const PLUGIN_ID = "calendar";

export default {
  id: PLUGIN_ID,
  name: "Calendar",
  version: "1.1.0",
  description: "Retired. Daily Note owns the month calendar.",
  detail:
    "The diary month calendar lives in Daily Note and opens that day's note. This plugin no longer draws a second grid.",

  onEnable(_api: MarkablePluginAPI): void {},

  onDisable(_api: MarkablePluginAPI): void {},
};
