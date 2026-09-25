# Flavors

A flavor is a first-run CX: name plus packs (and an optional plugin-list override). Every flavor uses the same engine; users can still enable any plugin later.

| File | Role |
|---|---|
| [packs.json](packs.json) | Host modules plus base / domain / added plugin packs |
| [markable.json](markable.json) | Minimal editor — `com.markable.editor`, `enabledPacks: ["base"]` |
| [remarkable.json](remarkable.json) | Re-markable — `com.markable.app` (existing data); kitchen-sink first-run override |
| [knowledgebank.json](knowledgebank.json) | Markable-KnowledgeBank — `com.markable.knowledgebank`, `base` + `pkm` |

`src-tauri/tauri.conf.json` stays `com.markable.app` so `npm run tauri dev` keeps using today’s Application Support folder.

Align frontend flavor + bundle id:

```bash
node scripts/tauri-flavor.mjs dev
VITE_FLAVOR=remarkable node scripts/tauri-flavor.mjs dev
VITE_FLAVOR=knowledgebank node scripts/tauri-flavor.mjs dev
```

That is not a live switcher and does not migrate existing app data. Project, QuickNote, and Diary flavor files wait until those packs have shipped features.

Existing Application Support data is stamped `legacy-kitchen-sink` and uses the Re-markable `defaultEnabledPlugins` override until a migration exists.
