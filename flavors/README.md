# Flavors

A flavor is a first-run CX: name plus packs (and an optional plugin-list override). Every flavor uses the same engine; users can still enable any plugin later.

| File | Role |
|---|---|
| [packs.json](packs.json) | Host modules plus base / domain / added plugin packs |
| [markable.json](markable.json) | Minimal editor — `com.markable.editor`, `enabledPacks: ["base"]` |
| [remarkable.json](remarkable.json) | Re-markable — `com.markable.app`, `base` + `pkm` |
| [knowledgebank.json](knowledgebank.json) | Markable-KnowledgeBank — `com.markable.knowledgebank`, `base` + `pkm` |

`src-tauri/tauri.conf.json` stays `com.markable.app` so `npm run tauri dev` keeps using today’s Application Support folder.

Align frontend flavor + bundle id:

```bash
npm run dev:markable
npm run dev:remarkable
npm run dev:knowledgebank
```

Same targets: `just markable`, `just remarkable`, `just knowledgebank`. `npm run tauri dev` still uses `com.markable.app` without setting `VITE_FLAVOR`.

That is not a live switcher. First-run enablement is the flavor’s `enabledPacks`. Saved `settings.plugins` entries still win. Project, QuickNote, and Diary flavor files wait until those packs have shipped features.
