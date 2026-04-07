# Markable 2.0 — Quick Start Guide

**Status:** Phase 1 Architecture Complete → Ready for Implementation

---

## You Have Everything You Need

This repo now has a complete, repeatable process for implementing Phase 1. Here's what was created:

### 📋 Documentation Files (in root)

| File | Purpose | When to Read |
|------|---------|--------------|
| **PROGRESS.md** | Current status tracker | Every session start (2 min read) |
| **RESUME.md** | How to resume work | Every session start (5 min read) |
| **IMPLEMENTATION_CHECKLIST.md** | Detailed task breakdown | When you start a step (reference guide) |
| **QUICK_START.md** | This file | Right now (1 min read) |

### 🏗️ Architecture & Specs

| File | Purpose |
|------|---------|
| **docs/specs/phase1-infrastructure/00_index.md** | Master blueprint (architecture overview) |
| **docs/specs/phase1-infrastructure/step_00_*.md** through **step_06_*.md** | Individual step specs with code examples |
| **docs/requirements/active_task.md** | Requirements & edge cases (EC-1 through EC-20) |
| **docs/build-notes/macos-dmg-workaround.md** | Build troubleshooting guide |
| **docs/testing.md** | Testing patterns & conventions |

---

## Start a New Work Session (5 minutes)

### Step 1: Understand Current Status
```bash
cat PROGRESS.md
```
This tells you:
- ✅ What's complete
- 🟡 What's in progress (if anything)
- ⏸️ What's next
- ⚠️ Any blockers

### Step 2: Review How to Resume
```bash
# Open in editor
open RESUME.md
```
Read the "Quick Start" section (2 min) to understand the workflow.

### Step 3: Get Detailed Instructions
```bash
# Open the current step file, e.g., for Step 00:
open docs/specs/phase1-infrastructure/step_00_test_setup.md

# Or use the implementation checklist
open IMPLEMENTATION_CHECKLIST.md
```

### Step 4: Do the Work
Follow the step file tasks. Use the checklist to track progress.

### Step 5: Mark Progress When Done
```bash
# Update PROGRESS.md:
# 1. Change current step status to ✅ COMPLETE
# 2. Change next step status to 🟡 IN PROGRESS
# 3. Add brief notes about what you did

# Commit your progress
git add PROGRESS.md
git commit -m "Progress: Step XX complete, moving to Step YY"
```

---

## The 7 Steps of Phase 1

All steps are spec'd out with detailed code examples and acceptance criteria.

| Step | Task | Duration | Files |
|------|------|----------|-------|
| 00 | Test Infrastructure Setup | 1-2 hrs | Vitest, mocks, Rust tests |
| 01 | Tauri v2 + Vite + TypeScript Scaffolding | 30-45 min | npm create tauri-app |
| 02 | Tauri Capabilities & Permissions | 30 min | capabilities/default.json |
| 03 | macOS DMG Build & Code Signing ⚠️ | 1-2 hrs | CI=true workaround, signing |
| 04 | Rust File I/O Command Bridge | 2-3 hrs | read/write with atomic swap |
| 05 | CodeMirror 6 Markdown Editor | 1.5-2 hrs | CM6 + syntax highlighting |
| 06 | File Dialog Integration | 1.5-2 hrs | Open/Save UI with file ops |
| **Total Phase 1** | **~9-13 hours** | — | — |

---

## Key Files at a Glance

### For Quick Reference
- **PROGRESS.md** — "Where are we?" (always start here)
- **RESUME.md** — "How do I continue?" (troubleshooting included)
- **IMPLEMENTATION_CHECKLIST.md** — "What exactly do I need to do?" (step-by-step tasks)

### For Deep Dives
- **docs/specs/phase1-infrastructure/00_index.md** — Master blueprint (everything in one place)
- **docs/specs/phase1-infrastructure/step_NN_*.md** — Individual step details with code
- **docs/requirements/active_task.md** — Requirements & edge cases

### For Troubleshooting
- **RESUME.md** (section: "Troubleshooting Common Resume Issues")
- **docs/build-notes/macos-dmg-workaround.md** (code signing & build issues)
- **docs/testing.md** (test failures)

---

## Running Tests

Tests are built into each step. Here's how to run them:

```bash
# Frontend tests (TypeScript)
npm run test:run

# Watch mode (re-runs on file changes)
npm run test

# UI dashboard
npm run test:ui

# Backend tests (Rust)
cd src-tauri
cargo test

# Or from root
cargo test -p src-tauri
```

---

## Building the App

Once Step 03 is complete:

```bash
# Development (with hot reload)
npm run tauri dev

# Production build (with DMG)
CI=true npm run tauri build

# Fallback if CI=true fails
./scripts/build-dmg-fallback.sh
```

---

## Pausing Work Properly

**Before you stop working:**

1. **Update PROGRESS.md**
   - Mark current step status
   - Add brief session notes
   - Note any blockers or insights for next session

2. **Commit your work**
   ```bash
   git add .
   git commit -m "Progress: [clear message about what was done]"
   ```

3. **Push to remote** (optional but recommended)
   ```bash
   git push origin main
   ```

This ensures the next person (or you, next week) can resume instantly.

---

## Architecture Overview (30-second summary)

**Markable 2.0** = Tauri v2 (Rust backend) + CodeMirror 6 (TypeScript frontend)

**Phase 1** builds the infrastructure:
1. Test setup (so TDD works from the start)
2. Tauri scaffolding (Vite + TypeScript)
3. Build pipeline (CI=true workaround for macOS)
4. File I/O (atomic saves via Rust commands)
5. Editor (CodeMirror 6 with Markdown syntax)
6. File dialogs (Open/Save UI)
7. Complete end-to-end working editor

**Phase 2+** adds features (live preview, theming, plugins, menus, etc.)

---

## All Edge Cases Covered

Every edge case in the requirements (EC-1 through EC-20) is mapped to a specific step and tested. See:
- **docs/requirements/active_task.md** — Edge case definitions
- **docs/specs/phase1-infrastructure/00_index.md** → "Edge Case Coverage Matrix" — Which step handles which edge case

---

## Asking for Help

If you get stuck:

1. **Check RESUME.md** — Troubleshooting section
2. **Check the step spec** — May have explicit guidance
3. **Check git history** — See what was done previously
4. **Ask Claude** — Provide:
   - Current step you're on
   - Exact error message
   - What command failed
   - Any context about environment

---

## The Process is Repeatable

The beauty of this setup:

✅ **Human can pause anytime** → Update PROGRESS.md → Commit → Stop
✅ **AI can resume anytime** → Read PROGRESS.md → Check git log → Continue
✅ **Both stay in sync** → PROGRESS.md is the source of truth
✅ **No context loss** → Every session starts from clear status

---

## Estimated Timeline

- **Step 00:** 1-2 hours (one session)
- **Step 01-02:** 1-1.5 hours (one session)
- **Step 03:** 1-2 hours (one session, critical step)
- **Step 04:** 2-3 hours (likely two sessions)
- **Step 05:** 1.5-2 hours (one session)
- **Step 06:** 1.5-2 hours (one session, final)

**Total:** ~9-13 hours spread across multiple sessions

You can do one step per session, or combine quick steps. It's up to you.

---

## One More Thing

**PROGRESS.md is the hub.** Everything else flows from it:

```
PROGRESS.md (current status)
    ↓
RESUME.md (how to continue)
    ↓
IMPLEMENTATION_CHECKLIST.md or step_NN_*.md (what to do)
    ↓
Do the work
    ↓
Update PROGRESS.md & commit
    ↓
Ready for next session
```

Keep PROGRESS.md up-to-date, and you can pause/resume infinitely.

---

## Ready?

**To start Phase 1 implementation:**

1. Read PROGRESS.md (2 min)
2. Read RESUME.md → "Quick Start" section (5 min)
3. Open IMPLEMENTATION_CHECKLIST.md and find "Step 00"
4. Follow the tasks
5. Update PROGRESS.md when done
6. Commit
7. Stop whenever you want—next session will know exactly where to resume

Good luck! 🚀

---

**Files created/updated in this session:**
- ✅ PROGRESS.md — Progress tracker
- ✅ RESUME.md — Resume guide
- ✅ IMPLEMENTATION_CHECKLIST.md — Detailed tasks
- ✅ QUICK_START.md — This file
- ✅ docs/specs/phase1-infrastructure/step_00_test_setup.md — Test infrastructure spec
- ✅ docs/specs/phase1-infrastructure/00_index.md — Updated with adjustments
- ✅ Memory system updated (workflow_resume_process.md)

**All architecture complete. Ready for implementation!**
