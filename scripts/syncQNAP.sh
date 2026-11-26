#!/usr/bin/env bash
# Keep the same work in three places:
#   1. this repo (26DM-003-markdownAppRewrite)
#   2. the local 26DM-020-SoftwareMachine copy
#   3. both jobs on the QNAP (WORK volume)
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
markable="$(cd "$script_dir/.." && pwd)"
job003="$(cd "$markable/../.." && pwd)"
job020="$(cd "$job003/../26DM-020-SoftwareMachine" && pwd)"
volume="/Volumes/WORK"
qnap="$volume/DM-DavesMiscStuff"

src_app="$markable/dm-software-machine/project tracker/Markable-Project.app"
dest_app="$job020/jobWorking/sm/dm-software-machine/project tracker/Markable-Project.app"

if [[ ! -d "$src_app" ]]; then
  echo "Project tracker app is missing: $src_app" >&2
  exit 1
fi

echo "Local copy → 26DM-020-SoftwareMachine"
mkdir -p "$(dirname "$dest_app")"
rsync -a "$src_app/" "$dest_app/"

if [[ ! -d "$volume" ]]; then
  echo "QNAP volume is not mounted: $volume" >&2
  exit 1
fi

echo "QNAP ← 26DM-003-markdownAppRewrite"
mkdir -p "$qnap/26DM-003-markdownAppRewrite/jobWorking/markable"
rsync -avuP \
  --exclude node_modules/ \
  --exclude dist/ \
  --exclude .astro/ \
  --exclude .DS_Store \
  --exclude src-tauri/target/ \
  --exclude .dm-software-machine/worktrees/ \
  --exclude .dm-software-machine/runs/ \
  "$markable/" \
  "$qnap/26DM-003-markdownAppRewrite/jobWorking/markable/"

echo "QNAP ← 26DM-020-SoftwareMachine"
mkdir -p "$qnap/26DM-020-SoftwareMachine/jobWorking/sm"
rsync -avuP \
  --exclude node_modules/ \
  --exclude .DS_Store \
  --exclude .venv/ \
  "$job020/jobWorking/sm/" \
  "$qnap/26DM-020-SoftwareMachine/jobWorking/sm/"

echo "Synced to local 26DM-020 and both jobs on the QNAP."
