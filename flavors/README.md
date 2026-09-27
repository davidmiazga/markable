# Flavors

A flavor is a first-run CX: name plus packs (and an optional plugin-list override). Every flavor uses the same engine; users can still enable any plugin later.

| File | Role |
|---|---|
| [packs.json](packs.json) | Host modules plus base / domain / book plugin packs |
| [markable.json](markable.json) | Minimal editor — `com.markable.editor`, `enabledPacks: ["base"]` |
| [remarkable.json](remarkable.json) | Re-markable — `com.markable.app`, `base` + `pkm` |
| [pkm.json](pkm.json) | Markable PKM — `com.markable.pkm`, `base` + `pkm` |
| [project.json](project.json) | Markable-Project — `com.markable.project`, `base` + `project` |
| [diary.json](diary.json) | Markable-Diary — `com.markable.diary`, `base` + `diary` |
| [quicknote.json](quicknote.json) | Markable-QuickNote — `com.markable.quicknote`, `base` + `quicknote` |
| [book.json](book.json) | Markable Book — `com.markable.book`, `base` + `book` |

`src-tauri/tauri.conf.json` stays `com.markable.app` so `npm run tauri dev` keeps using today’s Application Support folder.

Align frontend flavor + bundle id:

```bash
npm run dev:markable
npm run dev:remarkable
npm run dev:pkm
npm run dev:project
npm run dev:diary
npm run dev:quicknote
npm run dev:book
```

Same targets: `just markable`, `just remarkable`, `just pkm`, `just project`, `just diary`, `just quicknote`, `just book`. Local unsigned app: `just bundle markable` (or `npm run bundle:pkm`, etc.). `just <flavor> build` runs a full Tauri bundle. `npm run tauri dev` still uses `com.markable.app` without setting `VITE_FLAVOR`.

Each flavor file has `iconDir` (`icons/<id>/`). `scripts/tauri-flavor.mjs` passes that set to Tauri. Regenerate from the 1024 SVGs with `just icons`.

`npm run sync:plugins` copies built IIFEs into every flavor’s Application Support folder (from each file’s `identifier`).

That is not a live switcher. First-run enablement is the flavor’s `enabledPacks`. Saved `settings.plugins` entries still win.
