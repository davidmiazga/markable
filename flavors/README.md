# Flavors

A flavor is a first-run CX: name plus packs (and an optional plugin-list override). Every flavor uses the same engine; users can still enable any plugin later.

| File | Role |
|---|---|
| [packs.json](packs.json) | Host modules plus base / domain / added plugin packs |
| [markable.json](markable.json) | Minimal editor — `enabledPacks: ["base"]` |
| [remarkable.json](remarkable.json) | Re-markable — intended `base` + `pkm`; `defaultEnabledPlugins` is today’s kitchen-sink stub |

`src/lib/flavor.ts` loads packs and the active flavor at build time (default `markable`). Override with `VITE_FLAVOR=remarkable` to build the stub. That is not a live switcher and does not migrate existing app data.

Existing Application Support data is stamped `legacy-kitchen-sink` and uses the Re-markable `defaultEnabledPlugins` override until a migration exists.
