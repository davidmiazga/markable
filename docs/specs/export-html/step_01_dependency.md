# Step 01 — Add `marked` Dependency

**Goal:** Install `marked` v18 as a production dependency. This is a hard prerequisite for step_03. No TypeScript is written in this step.

**Requirement references:** Dependency Notice (active_task.md p.1), FR-3.2, TC-2, EC-20, AC-23

---

## Context

`marked` is not present in `package.json` and is not installed in `node_modules`. The build will fail at the TypeScript import stage (EC-20) if this step is skipped.

`marked` v18 bundles its own TypeScript declarations (`./lib/marked.d.ts`). No `@types/marked` devDependency is needed or should be added.

**API shape (confirmed via npmjs.com, 2026-04-09):**
- Package: `marked` version `^18.0.0`
- Import: `import { marked } from 'marked'`
- Primary call: `marked.parse(src: string): string` — synchronous by default
- Async mode is NOT used. Do not set `async: true`. No `await` on `marked.parse()`.
- GFM (GitHub Flavored Markdown) including tables and task lists: enabled by default.

---

## Files to Change

### `package.json`

Add one entry to the `"dependencies"` block:

```json
"marked": "^18.0.0"
```

The `"devDependencies"` block is NOT modified. Do not add `@types/marked`.

**Before (dependencies block):**
```json
"dependencies": {
  "@codemirror/basic-setup": "^0.20.0",
  ...
  "codemirror": "^6.0.2"
}
```

**After (dependencies block):**
```json
"dependencies": {
  "@codemirror/basic-setup": "^0.20.0",
  ...
  "codemirror": "^6.0.2",
  "marked": "^18.0.0"
}
```

---

## Commands to Run

```bash
npm install marked
```

This will:
1. Download `marked` and its transitive dependencies.
2. Update `package-lock.json`.
3. Confirm the version installed in `node_modules/marked/package.json`.

After the command completes, verify:

```bash
node -e "const { marked } = require('./node_modules/marked/lib/marked.cjs'); console.log(typeof marked.parse)"
```

Expected output: `function`

---

## Acceptance Criteria for This Step

- [ ] `package.json` contains `"marked": "^18.0.0"` under `"dependencies"` (not `"devDependencies"`).
- [ ] `node_modules/marked/` directory exists.
- [ ] Running `npm install` a second time produces no changes (lockfile is stable).
- [ ] `npx tsc --noEmit` still passes (no new TypeScript errors introduced by the dependency alone).
- [ ] AC-23 satisfied: `marked` is in `dependencies`.

---

## What NOT to Do

- Do not add `@types/marked` — types are bundled in `marked` v5+.
- Do not add `marked` to `devDependencies` — it is a runtime dependency that is bundled into the frontend by Vite.
- Do not run `npm install --save-dev marked`.
- Do not set `marked.setOptions({ async: true })` anywhere in the codebase.
