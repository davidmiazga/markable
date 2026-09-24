#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""dm-software-machine CLI — deterministic task, gate, and progress commands."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field, ValidationError

SKILL_ROOT = Path(__file__).resolve().parent.parent
VERSION = (SKILL_ROOT / "VERSION").read_text().strip()
MACHINE_DIR = ".dm-software-machine"
KINDS = ("intent", "handoff", "work", "review", "quality", "acceptance")
TASK_STATUSES = (
    "queued",
    "claimed",
    "active",
    "gated",
    "reviewed",
    "accepted",
    "blocked",
)
GITIGNORE_ENTRIES = [
    ".dm-software-machine/runs/",
    ".dm-software-machine/install-manifest.json",
    ".env",
    ".DS_Store",
    "__pycache__/",
    "*.pyc",
]
MACHINE_OWNED_PREFIXES = (
    "specs/",
    ".dm-software-machine/",
)
NEVER_WRITE_DIRS = ("node_modules", "target", "dist", ".astro")
PLACEHOLDER_TEST = re.compile(r"no test specified", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def repo_root() -> Path:
    return Path.cwd().resolve()


def machine_path(root: Path | None = None) -> Path:
    return (root or repo_root()) / MACHINE_DIR


ENV_LAYOUT_KEYS = ("APP_FOLDER", "PROJ_APP_DIR")
UNSET = "SET_ME"
DEFAULT_DONE = (
    "the fast gate is green and the feature is visible in the profile dev command"
)
CONFIGURE_HINT = (
    "machine.yaml is not configured.\n"
    "Edit .dm-software-machine/machine.yaml (comments explain each field)\n"
    "or run: uv run dm-software-machine/scripts/dmsm.py configure --ask\n"
    "or answer the skill first-run questions."
)


def _is_unset(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() in ("", UNSET):
        return True
    return False


def layout_is_configured(cfg: dict, root: Path) -> bool:
    if cfg.get("configured") is False:
        return False
    app = cfg.get("app_folder")
    env = load_layout_env(root)
    app = env.get("APP_FOLDER") or env.get("PROJ_APP_DIR") or app
    if _is_unset(app):
        return False
    writes = cfg.get("writes") or []
    if writes and all(_is_unset(item) for item in writes):
        return False
    return True


def set_yaml_scalar(text: str, key: str, value: Any) -> str:
    rendered = "true" if value is True else "false" if value is False else str(value)
    pattern = re.compile(rf"^({re.escape(key)}:\s*).*$", re.MULTILINE)
    if not pattern.search(text):
        return text.rstrip() + f"\n{key}: {rendered}\n"
    return pattern.sub(rf"\g<1>{rendered}", text, count=1)


def set_yaml_str_list(text: str, key: str, items: list[str]) -> str:
    block = f"{key}:\n" + "".join(f"  - {item}\n" for item in items)
    pattern = re.compile(
        rf"^{re.escape(key)}:\n(?:^[ \t]+- .*\n)*",
        re.MULTILINE,
    )
    if not pattern.search(text):
        return text.rstrip() + "\n" + block
    return pattern.sub(block, text, count=1)


def write_layout(
    path: Path,
    *,
    app_folder: str,
    writes: list[str],
    done_means: str,
    configured: bool = True,
    profile: str | None = None,
    version: str | None = None,
    tracker: str | None = None,
    auto_advance: bool | None = None,
) -> None:
    text = path.read_text()
    if profile is not None:
        text = set_yaml_scalar(text, "profile", profile)
    if version is not None:
        text = set_yaml_scalar(text, "version", version)
    text = set_yaml_scalar(text, "configured", configured)
    text = set_yaml_scalar(text, "app_folder", app_folder)
    text = set_yaml_scalar(text, "done_means", done_means)
    if tracker is not None:
        text = set_yaml_scalar(text, "tracker", tracker)
    if auto_advance is not None:
        text = set_yaml_scalar(text, "auto_advance", auto_advance)
    text = set_yaml_str_list(text, "writes", writes)
    path.write_text(text)


def suggested_app_folder(store: "Store") -> str:
    return str(store.profile.get("app_dir") or store.cfg.get("app_folder") or "tauri-app")


def writes_for_app(app_folder: str, profile: dict | None = None) -> list[str]:
    app = app_folder.rstrip("/")
    profile = profile or {}
    items = [item for item in (profile.get("writes") or []) if not _is_unset(item)]
    if not items:
        items = ["src/", "src-tauri/src/", "index.html"]
    out: list[str] = []
    for item in items:
        rel = normalize_rel(str(item)).lstrip("/")
        if rel == app or rel.startswith(f"{app}/"):
            out.append(rel if rel.endswith("/") or Path(rel).suffix else f"{rel}/")
        else:
            joined = f"{app}/{rel}"
            out.append(joined)
    return out


def detect_package_manager(app: Path) -> str:
    if (app / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (app / "yarn.lock").exists():
        return "yarn"
    if (app / "bun.lockb").exists() or (app / "bun.lock").exists():
        return "bun"
    return "npm"


def package_scripts(app: Path) -> dict[str, str]:
    pkg = app / "package.json"
    if not pkg.exists():
        return {}
    try:
        data = json.loads(pkg.read_text())
    except json.JSONDecodeError:
        return {}
    scripts = data.get("scripts") or {}
    return {str(key): str(value) for key, value in scripts.items()}


def should_run_check(spec: dict, app: Path) -> bool:
    when = spec.get("when") or {}
    if not when:
        return True
    script = when.get("package_script")
    if script:
        body = package_scripts(app).get(script, "")
        if not body:
            return False
        if script == "test" and PLACEHOLDER_TEST.search(body):
            return False
        return True
    pattern = when.get("file")
    if pattern:
        return any(app.glob(pattern))
    return True


def rewrite_pm_argv(argv: list[str], app: Path) -> list[str]:
    pm = detect_package_manager(app)
    out = list(argv)
    if not out:
        return out
    if out[0] == "npm" and pm != "npm":
        out[0] = "bun" if pm == "bun" else pm
    if out[:2] == ["npx", "astro"] and pm != "npm":
        rest = out[2:]
        if pm == "pnpm":
            out = ["pnpm", "exec", "astro", *rest]
        elif pm == "yarn":
            out = ["yarn", "astro", *rest]
        elif pm == "bun":
            out = ["bunx", "astro", *rest]
    return out


def select_checks(store: "Store", kind: str) -> tuple[list[dict], list[str]]:
    raw = (store.profile.get("checks") or {}).get(kind) or []
    app = store.root / str(store.profile.get("app_dir") or store.cfg.get("app_folder") or ".")
    selected: list[dict] = []
    skipped: list[str] = []
    for spec in raw:
        name = str(spec.get("name") or "check")
        cwd = store.root / spec.get("cwd", ".")
        target = cwd if cwd.exists() else app
        if not should_run_check(spec, target):
            skipped.append(name)
            continue
        item = dict(spec)
        item["argv"] = rewrite_pm_argv(list(spec["argv"]), target)
        selected.append(item)
    return selected, skipped


def is_never_write(path: str, extra: list[str] | None = None) -> bool:
    rel = normalize_rel(path)
    if any(part in NEVER_WRITE_DIRS for part in rel.split("/")):
        return True
    return path_in_patterns(rel, extra or [])


def load_layout_env(root: Path) -> dict[str, str]:
    """Read only layout overrides from the process env and .env. Never print secrets."""
    found: dict[str, str] = {}
    env_file = root / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key in ENV_LAYOUT_KEYS and value.strip():
                found[key] = value.strip().strip("\"'")
    for key in ENV_LAYOUT_KEYS:
        if os.environ.get(key):
            found[key] = os.environ[key].strip()
    return found


def resolve_defaults(store: "Store") -> dict[str, Any]:
    env = load_layout_env(store.root)
    profile = store.profile
    cfg = store.cfg
    raw_app = (
        env.get("APP_FOLDER")
        or env.get("PROJ_APP_DIR")
        or cfg.get("app_folder")
        or profile.get("app_dir")
        or UNSET
    )
    app_folder = UNSET if _is_unset(raw_app) else str(raw_app).rstrip("/")
    raw_writes = cfg.get("writes") or profile.get("writes") or []
    writes = [item for item in raw_writes if not _is_unset(item)]
    if not writes and not _is_unset(app_folder):
        writes = writes_for_app(app_folder, profile)
    done = cfg.get("done_means")
    if _is_unset(done):
        done = DEFAULT_DONE
    dev_cwd = profile.get("dev_cwd") or app_folder
    dev_command = profile.get("dev_command") or ["npm", "run", "dev"]
    if isinstance(dev_command, str):
        dev_line = dev_command
    else:
        dev_line = " ".join(dev_command)
    return {
        "app_folder": app_folder,
        "writes": list(writes),
        "done_means": done,
        "dev_cwd": dev_cwd,
        "dev_command": dev_line,
        "profile": cfg.get("profile") or profile.get("id") or "",
        "tracker": cfg.get("tracker") or "none",
        "parallel": int(cfg.get("parallel") or 1),
        "auto_advance": bool(cfg.get("auto_advance", False)),
    }


def normalize_rel(path: str) -> str:
    rel = path.replace("\\", "/")
    while rel.startswith("./"):
        rel = rel[2:]
    return rel


def path_in_patterns(path: str, patterns: list[str]) -> bool:
    rel = normalize_rel(path)
    for raw in patterns:
        pat = normalize_rel(str(raw))
        if not pat:
            continue
        if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(rel, pat.rstrip("/") + "/*"):
            return True
        if rel == pat.rstrip("/") or rel.startswith(pat.rstrip("/") + "/"):
            return True
    return False


def git_changed_files(root: Path) -> list[str]:
    completed = subprocess.run(
        ["git", "status", "--porcelain", "--untracked-files=all"],
        cwd=root, capture_output=True, text=True,
    )
    if completed.returncode != 0:
        raise SystemExit(completed.stderr.strip() or "git status failed")
    files: list[str] = []
    for line in completed.stdout.splitlines():
        if not line.strip():
            continue
        body = line[3:] if len(line) > 3 else line.strip()
        if " -> " in body:
            body = body.split(" -> ", 1)[1]
        rel = normalize_rel(body.strip().strip('"'))
        if not rel or (root / rel).is_dir():
            continue
        files.append(rel)
    return sorted(set(files))


def file_digest(root: Path, rel: str) -> str | None:
    path = root / rel
    if not path.is_file():
        return None
    return file_hash(path)


def classify_changes(store: "Store", writes: list[str]) -> dict[str, list[str]]:
    protected = list(store.cfg.get("protected_paths") or [])
    ignore = list(MACHINE_OWNED_PREFIXES)
    ignore.extend(protected)
    ignore.extend(store.cfg.get("ignore_dirty") or [])
    never = list(store.cfg.get("never_write") or [])
    never.extend(store.profile.get("never_write") or [])
    dirty = git_changed_files(store.root)
    inside, protected_hits, ignored, unscoped = [], [], [], []
    for path in dirty:
        if is_never_write(path, never):
            ignored.append(path)
        elif path_in_patterns(path, writes):
            inside.append(path)
        elif path_in_patterns(path, protected):
            protected_hits.append(path)
        elif path_in_patterns(path, ignore):
            ignored.append(path)
        else:
            unscoped.append(path)
    return {
        "inside": inside,
        "protected": protected_hits,
        "ignored": ignored,
        "unscoped": unscoped,
    }


def scope_snapshot(store: "Store", writes: list[str]) -> dict[str, str | None]:
    scope = classify_changes(store, writes)
    snap: dict[str, str | None] = {}
    for path in scope["unscoped"] + scope["protected"] + scope["ignored"]:
        snap[path] = file_digest(store.root, path)
    return snap


def unscoped_violations(store: "Store", writes: list[str], baseline: dict | None) -> list[str]:
    scope = classify_changes(store, writes)
    if not baseline:
        return [f"{path} (outside writes)" for path in scope["unscoped"]]
    violations = []
    for path in scope["unscoped"]:
        now = file_digest(store.root, path)
        if path not in baseline:
            violations.append(f"{path} (new outside writes)")
        elif baseline.get(path) != now:
            violations.append(f"{path} (changed outside writes)")
    return violations


def print_scope(scope: dict[str, list[str]]) -> None:
    if scope["inside"]:
        print("writes:")
        for path in scope["inside"]:
            print(f"  {path}")
    if scope["protected"]:
        print("protected (excluded):")
        for path in scope["protected"]:
            print(f"  {path}")
    if scope["unscoped"]:
        print("outside writes:")
        for path in scope["unscoped"]:
            print(f"  {path}")


def apply_work_envelope(store: Store, task_id: str, envelope: Envelope) -> Path:
    envelope.kind = "work"
    envelope.task_id = task_id
    envelope.validate_kind()
    dest = store.write_envelope(envelope)
    state = store.load_state()
    task = state["tasks"][task_id]
    task["status"] = "active"
    task["phase"] = "work"
    task["changed_files"] = envelope.changed_files
    store.save_state(state)
    store.emit("handoff", {"kind": "work", "path": str(dest)}, task_id)
    return dest


def work_from_git(store: Store, task: dict) -> Envelope:
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    scope = classify_changes(store, writes)
    print_scope(scope)
    violations = unscoped_violations(store, writes, task.get("scope_baseline"))
    if violations:
        raise SystemExit(
            "finish refused: dirty files outside writes\n"
            + "\n".join(f"  {path}" for path in violations)
        )
    if not scope["inside"]:
        raise SystemExit("finish refused: no dirty files inside writes")
    title = task.get("title") or task["id"]
    return Envelope(
        status="success",
        kind="work",
        task_id=task["id"],
        summary=title,
        changed_files=scope["inside"],
        writes=writes,
        notes_for_next="work envelope from git status; protected/unscoped paths excluded",
    )


def apply_review_envelope(store: Store, task_id: str, envelope: Envelope) -> Path:
    envelope.kind = "review"
    envelope.task_id = task_id
    envelope.validate_kind()
    dest = store.write_envelope(envelope)
    state = store.load_state()
    task = state["tasks"][task_id]
    task["last_review"] = {"approved": bool(envelope.approved), "at": now_iso()}
    task["status"] = "reviewed" if envelope.approved else "active"
    task["phase"] = "review"
    if envelope.approved is False:
        task["repair_count"] = int(task.get("repair_count", 0)) + 1
        if task["repair_count"] > task["max_repairs"]:
            task["status"] = "blocked"
    store.save_state(state)
    store.emit("review", {"approved": envelope.approved, "path": str(dest)}, task_id)
    return dest


def review_from_diff(store: Store, task: dict) -> Envelope:
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    scope = classify_changes(store, writes)
    blocking = []
    violations = unscoped_violations(store, writes, task.get("scope_baseline"))
    if violations:
        blocking.append("dirty files outside writes: " + ", ".join(violations))
    changed = task.get("changed_files") or scope["inside"]
    extra = [path for path in changed if not path_in_patterns(path, writes)]
    if extra:
        blocking.append("work envelope lists files outside writes: " + ", ".join(extra))
    if not (task.get("changed_files") or scope["inside"]):
        blocking.append("no files inside writes")
    approved = not blocking
    return Envelope(
        status="success" if approved else "fail",
        kind="review",
        task_id=task["id"],
        summary="diff stays inside writes" if approved else "diff left writes",
        approved=approved,
        blocking=blocking,
        changed_files=scope["inside"],
        writes=writes,
    )


class Envelope(BaseModel):
    status: str
    kind: str
    task_id: str
    summary: str = ""
    artifacts: list[str] = Field(default_factory=list)
    notes_for_next: str = ""
    changed_files: list[str] = Field(default_factory=list)
    writes: list[str] = Field(default_factory=list)
    commit_message: str = ""
    approved: Optional[bool] = None
    blocking: list[str] = Field(default_factory=list)
    passed: Optional[bool] = None
    failures: list[str] = Field(default_factory=list)
    log_paths: list[str] = Field(default_factory=list)
    accepted: Optional[bool] = None

    def validate_kind(self) -> None:
        if self.status not in ("success", "fail"):
            raise ValueError("status must be success or fail")
        if self.kind not in KINDS:
            raise ValueError(f"kind must be one of {KINDS}")
        if self.kind == "review" and self.approved is None:
            raise ValueError("review envelope requires approved")
        if self.kind == "quality" and self.passed is None:
            raise ValueError("quality envelope requires passed")
        if self.kind == "acceptance" and self.accepted is None:
            raise ValueError("acceptance envelope requires accepted")


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.machine_dir = machine_path(root)
        self.cfg = self._load_yaml(self.machine_dir / "machine.yaml") if (
            self.machine_dir / "machine.yaml"
        ).exists() else {}
        self.profile = self._load_yaml(self.machine_dir / "profile.yaml") if (
            self.machine_dir / "profile.yaml"
        ).exists() else {}

    @staticmethod
    def _load_yaml(path: Path) -> dict:
        return yaml.safe_load(path.read_text()) or {}

    def require_installed(self) -> None:
        if not (self.machine_dir / "machine.yaml").exists():
            raise SystemExit("dm-software-machine is not installed. Run: "
                             "uv run dm-software-machine/scripts/dmsm.py init --profile tauri")

    def require_configured(self) -> None:
        self.require_installed()
        if not layout_is_configured(self.cfg, self.root):
            raise SystemExit(CONFIGURE_HINT)

    def runs_dir(self) -> Path:
        path = self.machine_dir / "runs"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def current_run_id(self) -> str:
        pointer = self.machine_dir / "current-run"
        if pointer.exists():
            return pointer.read_text().strip()
        raise SystemExit("no active run — add a task first")

    def set_current_run(self, run_id: str) -> None:
        (self.machine_dir / "current-run").write_text(run_id + "\n")

    def run_dir(self, run_id: str | None = None) -> Path:
        rid = run_id or self.current_run_id()
        path = self.runs_dir() / rid
        path.mkdir(parents=True, exist_ok=True)
        return path

    def state_path(self, run_id: str | None = None) -> Path:
        return self.run_dir(run_id) / "state.json"

    def events_path(self, run_id: str | None = None) -> Path:
        return self.run_dir(run_id) / "events.jsonl"

    def load_state(self, run_id: str | None = None) -> dict:
        path = self.state_path(run_id)
        if not path.exists():
            raise SystemExit("run state missing")
        return json.loads(path.read_text())

    def save_state(self, state: dict) -> None:
        path = self.state_path(state["run_id"])
        path.write_text(json.dumps(state, indent=2) + "\n")

    def emit(self, event_type: str, payload: dict | None = None, task_id: str = "",
             run_id: str | None = None) -> None:
        record = {
            "ts": now_iso(),
            "type": event_type,
            "task_id": task_id,
            "payload": payload or {},
        }
        path = self.events_path(run_id)
        with path.open("a") as handle:
            handle.write(json.dumps(record) + "\n")

    def task_dir(self, task_id: str) -> Path:
        path = self.run_dir() / "tasks" / task_id
        path.mkdir(parents=True, exist_ok=True)
        (path / "envelopes").mkdir(exist_ok=True)
        (path / "logs").mkdir(exist_ok=True)
        return path

    def write_envelope(self, envelope: Envelope) -> Path:
        envelope.validate_kind()
        dest = self.task_dir(envelope.task_id) / "envelopes" / f"{envelope.kind}.json"
        dest.write_text(envelope.model_dump_json(indent=2) + "\n")
        return dest

    def latest_envelope(self, task_id: str) -> Optional[dict]:
        env_dir = self.task_dir(task_id) / "envelopes"
        files = sorted(env_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
        if not files:
            return None
        return json.loads(files[-1].read_text())


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure_gitignore(root: Path) -> list[str]:
    gitignore = root / ".gitignore"
    existing = gitignore.read_text().splitlines() if gitignore.exists() else []
    missing = [entry for entry in GITIGNORE_ENTRIES if entry not in existing]
    if missing:
        with gitignore.open("a") as handle:
            handle.write("\n# dm-software-machine runtime\n" + "\n".join(missing) + "\n")
    return missing


def stamp_file(src: Path, dest: Path, force: bool, manifest: dict) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    src_digest = file_hash(src)
    key = str(dest.relative_to(repo_root())) if dest.is_relative_to(repo_root()) else str(dest)
    previous = (manifest.get("files") or {}).get(key, {})
    if dest.exists() and not force:
        dest_digest = file_hash(dest)
        if dest_digest == src_digest:
            return "unchanged"
        if dest_digest == previous.get("hash"):
            shutil.copy2(src, dest)
            return "replaced"
        return "skipped-local"
    shutil.copy2(src, dest)
    return "stamped"


VENDOR_NAMES = ("SKILL.md", "VERSION", "scripts", "profiles", "templates", "references")


def vendor_skill(root: Path) -> str:
    dest = root / "dm-software-machine"
    if SKILL_ROOT.resolve() == dest.resolve():
        return "vendor skipped (already in-repo)"
    if dest.exists():
        return "vendor skipped (dm-software-machine/ exists)"
    dest.mkdir(parents=True)
    for name in VENDOR_NAMES:
        src = SKILL_ROOT / name
        if not src.exists():
            continue
        target = dest / name
        if src.is_dir():
            shutil.copytree(src, target)
        else:
            shutil.copy2(src, target)
    return "vendored dm-software-machine/"


def _yes(reply: str, default: bool = False) -> bool:
    text = reply.strip().lower()
    if not text:
        return default
    return text in ("y", "yes")


def ensure_bd_binary() -> str:
    if shutil.which("bd"):
        return "bd already on PATH"
    if shutil.which("brew"):
        _run_live(["brew", "install", "beads"], Path.cwd())
        if shutil.which("bd"):
            return "brew install beads"
    if shutil.which("npm"):
        _run_live(["npm", "install", "-g", "@beads/bd"], Path.cwd())
        if shutil.which("bd"):
            return "npm install -g @beads/bd"
    raise SystemExit(
        "tracker=beads but bd is not on PATH. Install it, then re-run "
        "configure --tracker beads\n"
        "  brew install beads\n"
        "  npm install -g @beads/bd"
    )


def ensure_beads(root: Path) -> str:
    notes = [ensure_bd_binary()]
    if (root / ".beads").exists():
        notes.append("beads repo already initialized")
        return "; ".join(notes)
    argv = ["bd", "init", "--quiet", "--role", "maintainer"]
    print(f"$ {' '.join(argv)}  (cwd {root})")
    completed = subprocess.run(argv, cwd=root)
    if completed.returncode != 0:
        raise SystemExit(f"bd init failed ({completed.returncode})")
    notes.append("bd init")
    return "; ".join(notes)


def apply_tracker(root: Path, tracker: str) -> str:
    tracker = (tracker or "none").strip().lower()
    if tracker not in ("none", "beads"):
        raise SystemExit("tracker must be none or beads")
    machine_yaml = machine_path(root) / "machine.yaml"
    if machine_yaml.exists():
        machine_yaml.write_text(set_yaml_scalar(machine_yaml.read_text(), "tracker", tracker))
    if tracker == "beads":
        return f"tracker=beads ({ensure_beads(root)})"
    return "tracker=none"


def tracker_is_beads(store: Store) -> bool:
    return str(store.cfg.get("tracker") or "none").strip().lower() == "beads"


def _bd_json(argv: list[str], root: Path) -> Any:
    completed = subprocess.run(argv, cwd=root, capture_output=True, text=True)
    if completed.returncode != 0:
        raise SystemExit(
            f"{' '.join(argv)} failed ({completed.returncode})\n"
            f"{(completed.stderr or completed.stdout).strip()}"
        )
    text = (completed.stdout or "").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def beads_create(root: Path, *, title: str, task_id: str, run_id: str, spec_path: str) -> str:
    if not shutil.which("bd"):
        raise SystemExit("tracker=beads but bd is not on PATH. Run: configure --tracker beads")
    if not (root / ".beads").exists():
        raise SystemExit("tracker=beads but .beads/ is missing. Run: configure --tracker beads")
    desc = f"sm task {task_id} (run {run_id})\nSpec: {spec_path}"
    payload = _bd_json(
        [
            "bd", "create", title,
            "--type", "task",
            "--external-ref", f"sm:{task_id}",
            "--description", desc,
            "--json",
        ],
        root,
    )
    if isinstance(payload, list) and payload:
        payload = payload[0]
    bead_id = (payload or {}).get("id") if isinstance(payload, dict) else None
    if not bead_id:
        raise SystemExit(f"bd create returned no id: {payload}")
    return str(bead_id)


def beads_close(root: Path, bead_id: str, reason: str) -> None:
    _bd_json(["bd", "close", bead_id, "--reason", reason, "--json"], root)


def ensure_justfile(root: Path) -> str:
    snippet = (SKILL_ROOT / "templates" / "justfile.sm").read_text()
    justfile = root / "justfile"
    if not justfile.exists():
        justfile.write_text("set dotenv-load\nset positional-arguments\n\n" + snippet)
        return "stamped justfile"
    text = justfile.read_text()
    if "sm-finish" not in text:
        justfile.write_text(text.rstrip() + "\n\n" + snippet)
        return "justfile +sm recipes"
    if "sm-auto" not in text:
        justfile.write_text(text.rstrip() + "\n\nsm-auto MODE:\n    {{sm}} auto {{MODE}}\n")
        return "justfile +sm-auto"
    return "justfile unchanged"


def cmd_init(args: argparse.Namespace) -> int:
    root = repo_root()
    profile_id = args.profile
    profile_src = SKILL_ROOT / "profiles" / f"{profile_id}.yaml"
    if not profile_src.exists():
        available = ", ".join(sorted(p.stem for p in (SKILL_ROOT / "profiles").glob("*.yaml")))
        raise SystemExit(f"unknown profile {profile_id!r} (have {available})")

    dest_dir = machine_path(root)
    dest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = dest_dir / "install-manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "version": VERSION, "files": {}
    }
    actions: list[str] = []

    stamps = [
        (SKILL_ROOT / "templates" / "machine.yaml", dest_dir / "machine.yaml"),
        (profile_src, dest_dir / "profile.yaml"),
        (SKILL_ROOT / "templates" / "PROJECT.md", dest_dir / "PROJECT.md"),
        (SKILL_ROOT / "SKILL.md", dest_dir / "SKILL.md"),
        (SKILL_ROOT / "references" / "contracts.md", dest_dir / "contracts.md"),
        (SKILL_ROOT / "templates" / "permissions.json", root / ".cursor" / "permissions.json"),
    ]
    for src, dest in stamps:
        action = stamp_file(src, dest, args.force, manifest)
        rel = str(dest.relative_to(root))
        actions.append(f"{action} {rel}")
        if action != "skipped-local":
            manifest["files"][rel] = {"hash": file_hash(dest), "version": VERSION}

    machine_yaml = dest_dir / "machine.yaml"
    text = machine_yaml.read_text()
    text = set_yaml_scalar(text, "profile", profile_id)
    text = set_yaml_scalar(text, "version", VERSION)
    machine_yaml.write_text(text)

    store = Store(root)
    tracker = getattr(args, "tracker", "") or ""
    if args.accept_defaults:
        app_folder = str(store.profile.get("app_dir") or "tauri-app")
        write_layout(
            machine_yaml,
            app_folder=app_folder,
            writes=writes_for_app(app_folder, store.profile),
            done_means=store.cfg.get("done_means") or DEFAULT_DONE,
            configured=True,
            profile=profile_id,
            version=VERSION,
            tracker=tracker or "none",
            auto_advance=False,
        )
        actions.append(f"configured defaults app_folder={app_folder}")
        if (tracker or "none") == "beads":
            actions.append(apply_tracker(root, "beads"))
    elif args.ask:
        rc = run_configure(store, ask=True, tracker=tracker)
        if rc != 0:
            return rc
        actions.append("configured via questions")
    elif tracker == "beads":
        actions.append(apply_tracker(root, "beads"))
    elif not layout_is_configured(store.cfg, root):
        print(CONFIGURE_HINT)

    actions.append(vendor_skill(root))
    actions.append(ensure_justfile(root))

    ignored = ensure_gitignore(root)
    if ignored:
        actions.append(f"gitignore +{len(ignored)}")

    (root / "specs").mkdir(exist_ok=True)

    if not (root / ".git").exists():
        subprocess.run(["git", "init"], cwd=root, check=True)
        actions.append("git init")
    has_commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True
    ).returncode == 0
    if not has_commit:
        subprocess.run(["git", "add", "-A"], cwd=root, check=True)
        subprocess.run(["git", "commit", "-m", "init dm-software-machine fixture"],
                       cwd=root, check=True)
        actions.append("initial commit")
        # Prefer a narrow add if this is a later re-init; first commit still
        # needs a repo HEAD so later task commits can run.

    profile = yaml.safe_load(profile_src.read_text())
    if args.scaffold and profile.get("scaffold"):
        dest = root / profile["scaffold"]["dest"]
        if dest.exists():
            actions.append(f"scaffold skipped ({dest.name} exists)")
        else:
            _run_live(profile["scaffold"]["argv"], root)
            install_cwd = root / profile["scaffold"].get("install_cwd", dest)
            install_argv = profile["scaffold"].get("install_argv")
            if install_argv:
                _run_live(install_argv, install_cwd)
            after_argv = profile["scaffold"].get("after_argv")
            if after_argv:
                _run_live(after_argv, install_cwd)
            actions.append(f"scaffolded {dest.name}")

    missing = _prereq_report(profile)
    if missing:
        print("prereq gaps:")
        for item in missing:
            print(f"  - {item}")

    manifest["version"] = VERSION
    manifest["profile"] = profile_id
    manifest["installed_at"] = now_iso()
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"dm-software-machine {VERSION} installed into {root}")
    for line in actions:
        print(f"  {line}")
    print("next: uv run dm-software-machine/scripts/dmsm.py status")
    return 0


def _run_live(argv: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(argv)}  (cwd {cwd})")
    env = os.environ.copy()
    env.setdefault("CI", "1")
    completed = subprocess.run(argv, cwd=cwd, env=env)
    if completed.returncode != 0:
        raise SystemExit(f"command failed ({completed.returncode}): {' '.join(argv)}")


def _prereq_report(profile: dict) -> list[str]:
    needed = {"uv", "git"}
    if profile.get("id") == "tauri":
        needed.update({"npm", "cargo", "rustc"})
    if profile.get("id") == "astro":
        needed.update({"npm", "node"})
    missing = []
    for name in sorted(needed):
        if shutil.which(name) is None:
            missing.append(f"{name} not on PATH")
    return missing


def ensure_run(store: Store) -> dict:
    pointer = store.machine_dir / "current-run"
    if pointer.exists():
        return store.load_state()
    run_id = uuid.uuid4().hex[:8]
    state = {
        "run_id": run_id,
        "profile": store.cfg.get("profile"),
        "created_at": now_iso(),
        "paused": not bool(store.cfg.get("auto_advance", False)),
        "auto_advance": bool(store.cfg.get("auto_advance", False)),
        "tasks": {},
    }
    store.set_current_run(run_id)
    store.save_state(state)
    store.emit("run_started", {"profile": state["profile"]}, run_id=run_id)
    return state


def _prompt(label: str, default: str) -> str:
    suffix = f" [{default}]" if default else ""
    try:
        reply = input(f"{label}{suffix}: ").strip()
    except EOFError:
        raise SystemExit("configure --ask needs a terminal, or pass --app-folder")
    return reply or default


def run_configure(
    store: Store,
    *,
    ask: bool,
    app_folder: str = "",
    writes: list[str] | None = None,
    done: str = "",
    accept_defaults: bool = False,
    tracker: str = "",
    auto_advance: bool | None = None,
) -> int:
    store.require_installed()
    suggested = suggested_app_folder(store)
    if suggested == UNSET:
        suggested = "tauri-app"
    current_done = store.cfg.get("done_means") or DEFAULT_DONE
    if _is_unset(current_done):
        current_done = DEFAULT_DONE

    if accept_defaults:
        app_folder = suggested
        done = current_done
        writes = writes_for_app(app_folder, store.profile)
        tracker = tracker or "none"
        auto_advance = False if auto_advance is None else auto_advance
    elif ask:
        if not sys.stdin.isatty():
            if layout_is_configured(store.cfg, store.root):
                raise SystemExit("configure --ask needs a terminal, or pass --app-folder")
            print(CONFIGURE_HINT)
            return 2
        print("First-run layout. Press enter to keep the default.")
        app_folder = _prompt("App folder (relative to repo root)", app_folder or suggested)
        done = _prompt("Done means", done or current_done)
        default_writes = ", ".join(writes or writes_for_app(app_folder, store.profile))
        writes_line = _prompt("Writes (comma-separated)", default_writes)
        writes = [part.strip() for part in writes_line.split(",") if part.strip()]
        if not tracker:
            tracker_reply = _prompt(
                "Is this a large complex project that would benefit from a project tracker?",
                "n",
            )
            tracker = "beads" if _yes(tracker_reply, default=False) else "none"
        if auto_advance is None:
            auto_reply = _prompt(
                "Keep going through queued tasks until idle or a red gate (no pause after accept)?",
                "n",
            )
            auto_advance = _yes(auto_reply, default=False)
    else:
        if not app_folder:
            raise SystemExit("pass --app-folder, --ask, or --accept-defaults")
        done = done or current_done
        writes = writes or writes_for_app(app_folder, store.profile)
        tracker = tracker or "none"
        if auto_advance is None:
            auto_advance = bool(store.cfg.get("auto_advance", False))

    app_folder = app_folder.rstrip("/")
    writes = [
        item if item.endswith("/") or Path(item).suffix else f"{item}/"
        for item in writes
    ]
    write_layout(
        store.machine_dir / "machine.yaml",
        app_folder=app_folder,
        writes=writes,
        done_means=done,
        configured=True,
        profile=store.cfg.get("profile"),
        version=VERSION,
        tracker=tracker or "none",
        auto_advance=bool(auto_advance),
    )
    note = apply_tracker(store.root, tracker or "none")
    print(f"configured app_folder={app_folder} writes={', '.join(writes)}")
    print(note)
    return 0


def cmd_auto(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    on = args.switch == "on"
    path = store.machine_dir / "machine.yaml"
    path.write_text(set_yaml_scalar(path.read_text(), "auto_advance", on))
    pointer = store.machine_dir / "current-run"
    paused = not on
    if pointer.exists():
        state = store.load_state()
        state["auto_advance"] = on
        state["paused"] = paused
        store.save_state(state)
        store.emit("auto_advance", {"on": on, "paused": paused})
    print(f"auto_advance={on} paused={paused}")
    return 0


def cmd_configure(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    return run_configure(
        store,
        ask=args.ask,
        app_folder=args.app_folder,
        writes=args.writes or None,
        done=args.done,
        accept_defaults=args.accept_defaults,
        tracker=args.tracker,
        auto_advance=args.auto_advance,
    )


def cmd_defaults(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    defaults = resolve_defaults(store)
    print(f"profile     {defaults['profile']}")
    print(f"app_folder  {defaults['app_folder']}")
    print(f"writes      {', '.join(defaults['writes'])}")
    print(f"done_means  {defaults['done_means']}")
    print(f"dev         (cd {defaults['dev_cwd']} && {defaults['dev_command']})")
    print(f"tracker     {defaults['tracker']}")
    print(f"parallel    {defaults['parallel']}")
    print(f"auto_advance {defaults['auto_advance']}")
    return 0


def cmd_scope(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    writes = resolve_defaults(store)["writes"]
    print(f"writes      {', '.join(writes)}")
    scope = classify_changes(store, writes)
    print_scope(scope)
    print(f"inside={len(scope['inside'])}  unscoped={len(scope['unscoped'])}  "
          f"protected={len(scope['protected'])}  ignored={len(scope['ignored'])}")
    return 0


def cmd_task_add(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    state = ensure_run(store)
    defaults = resolve_defaults(store)
    task_id = "t-" + uuid.uuid4().hex[:4]
    writes = args.writes or defaults["writes"]
    done = args.done or defaults["done_means"]
    spec_path = Path(store.cfg.get("specs_dir", "specs")) / f"{task_id}.md"
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    if not spec_path.exists():
        spec_path.write_text(
            f"# {args.title}\n\nDone means: {done}\n"
            f"Writes: {', '.join(writes)}\n"
            f"Dev: cd {defaults['dev_cwd']} && {defaults['dev_command']}\n"
        )
    task = {
        "id": task_id,
        "title": args.title,
        "status": "queued",
        "depends_on": args.depends or [],
        "writes": writes,
        "spec_path": str(spec_path),
        "claimed_by": None,
        "repair_count": 0,
        "max_repairs": int(store.cfg.get("max_repairs", 2)),
        "phase": None,
        "last_gate": None,
        "last_review": None,
        "created_at": now_iso(),
        "bead_id": None,
    }
    if tracker_is_beads(store):
        task["bead_id"] = beads_create(
            store.root,
            title=args.title,
            task_id=task_id,
            run_id=state["run_id"],
            spec_path=str(spec_path),
        )
    state["tasks"][task_id] = task
    store.save_state(state)
    store.emit(
        "task_added",
        {"title": args.title, "writes": writes, "bead_id": task.get("bead_id")},
        task_id,
    )
    intent = Envelope(
        status="success", kind="intent", task_id=task_id,
        summary=args.title, writes=writes, artifacts=[str(spec_path)],
    )
    store.write_envelope(intent)
    print(task_id)
    if task.get("bead_id"):
        print(f"bead {task['bead_id']}")
    return 0


IN_FLIGHT = ("claimed", "active", "gated", "reviewed")


def writes_overlap(left: list[str], right: list[str]) -> bool:
    if not left or not right:
        return True
    for a in left:
        for b in right:
            if path_in_patterns(a, [b]) or path_in_patterns(b, [a]):
                return True
    return False


def in_flight_tasks(state: dict) -> list[dict]:
    return [task for task in state["tasks"].values() if task["status"] in IN_FLIGHT]


def overlapping_inflight(task: dict, flying: list[dict]) -> list[str]:
    hits = []
    for other in flying:
        if other["id"] == task.get("id"):
            continue
        if writes_overlap(task.get("writes") or [], other.get("writes") or []):
            hits.append(other["id"])
    return hits


def ready_tasks(state: dict) -> list[dict]:
    accepted = {tid for tid, task in state["tasks"].items() if task["status"] == "accepted"}
    ready = []
    for task in state["tasks"].values():
        if task["status"] != "queued":
            continue
        if all(dep in accepted for dep in task.get("depends_on") or []):
            ready.append(task)
    return ready


def cmd_task_next(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    flying = in_flight_tasks(state)
    parallel = int(store.cfg.get("parallel") or 1)
    if len(flying) >= parallel and not args.force:
        print(f"paused on {flying[0]['id']} ({flying[0]['status']}) parallel={parallel}")
        return 2
    ready = ready_tasks(state)
    if not ready:
        print("no ready tasks")
        return 1
    for candidate in ready:
        if args.force or not overlapping_inflight(candidate, flying):
            return _claim(store, state, candidate["id"], args.agent, force=args.force)
    print("no ready tasks with disjoint writes")
    return 2


def cmd_task_claim(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    return _claim(store, state, args.task_id, args.agent, force=args.force)


def _claim(store: Store, state: dict, task_id: str, agent: str, force: bool = False) -> int:
    task = state["tasks"].get(task_id)
    if not task:
        raise SystemExit(f"unknown task {task_id}")
    accepted = {tid for tid, item in state["tasks"].items() if item["status"] == "accepted"}
    unmet = [dep for dep in task.get("depends_on") or [] if dep not in accepted]
    if unmet:
        raise SystemExit(f"{task_id} blocked by {unmet}")
    if task["status"] not in ("queued", "claimed"):
        raise SystemExit(f"{task_id} is {task['status']}")
    if task["status"] == "queued" and not force:
        flying = in_flight_tasks(state)
        hits = overlapping_inflight(task, flying)
        if hits:
            raise SystemExit(f"{task_id} serialized: writes overlap {', '.join(hits)}")
        parallel = int(store.cfg.get("parallel") or 1)
        if len(flying) >= parallel:
            raise SystemExit(
                f"{task_id} paused: {len(flying)} in-flight (parallel={parallel})"
            )
    task["status"] = "claimed"
    task["claimed_by"] = agent
    task["phase"] = "claimed"
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    task["scope_baseline"] = scope_snapshot(store, writes)
    store.save_state(state)
    store.emit("task_claimed", {"agent": agent}, task_id)
    print(task_id)
    return 0


def cmd_handoff(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    if args.print:
        payload = store.latest_envelope(args.task)
        if payload is None:
            raise SystemExit(f"no envelope for {args.task}")
        print(json.dumps(payload, indent=2))
        return 0
    if args.from_git:
        state = store.load_state()
        task = state["tasks"].get(args.task)
        if not task:
            raise SystemExit(f"unknown task {args.task}")
        envelope = work_from_git(store, task)
        dest = apply_work_envelope(store, args.task, envelope)
        print(dest)
        return 0
    raw = Path(args.file).read_text() if args.file else sys.stdin.read()
    try:
        envelope = Envelope.model_validate_json(raw)
    except ValidationError as error:
        raise SystemExit(f"invalid envelope:\n{error}") from error
    if envelope.task_id != args.task:
        raise SystemExit("envelope task_id does not match --task")
    if args.kind:
        envelope.kind = args.kind
    if envelope.kind == "work":
        dest = apply_work_envelope(store, args.task, envelope)
    else:
        dest = store.write_envelope(envelope)
        state = store.load_state()
        task = state["tasks"][args.task]
        task["status"] = "active"
        task["phase"] = envelope.kind
        store.save_state(state)
        store.emit("handoff", {"kind": envelope.kind, "path": str(dest)}, args.task)
    print(dest)
    return 0


def cmd_progress(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    payload = {"message": args.message, "estimate": args.estimate, "estimated": args.estimate is not None}
    store.emit("checkpoint", payload, args.task)
    print("checkpoint recorded")
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if not task:
        raise SystemExit(f"unknown task {args.task}")
    checks, skipped = select_checks(store, args.kind)
    if not checks:
        raise SystemExit(f"profile has no checks for {args.kind}")
    store.emit("phase_start", {"phase": f"gate:{args.kind}"}, args.task)
    results = []
    logs = []
    for spec in checks:
        result = _run_check(store, args.task, spec)
        results.append(result)
        logs.append(result["log"])
        if not result["passed"] and args.fail_fast:
            break
    passed = all(item["passed"] for item in results)
    failures = [
        f"{item['name']}: `{item['command']}` exited {item['returncode']}\n{item['tail']}"
        for item in results if not item["passed"]
    ]
    envelope = Envelope(
        status="success" if passed else "fail",
        kind="quality",
        task_id=args.task,
        summary=f"{args.kind} gate {'passed' if passed else 'failed'}",
        passed=passed,
        failures=failures,
        log_paths=logs,
        artifacts=logs,
    )
    dest = store.write_envelope(envelope)
    task["last_gate"] = {"kind": args.kind, "passed": passed, "at": now_iso()}
    if passed:
        task["status"] = "gated"
        task["phase"] = f"gate:{args.kind}"
        task["repair_count"] = task.get("repair_count", 0)
    else:
        task["repair_count"] = int(task.get("repair_count", 0)) + 1
        if task["repair_count"] > task["max_repairs"]:
            task["status"] = "blocked"
        else:
            task["status"] = "active"
        task["phase"] = f"gate:{args.kind}:fail"
    store.save_state(state)
    store.emit("gate", {"kind": args.kind, "passed": passed, "envelope": str(dest)}, args.task)
    store.emit("phase_end", {"phase": f"gate:{args.kind}", "passed": passed}, args.task)
    print(f"{args.kind}: {'pass' if passed else 'fail'}")
    for name in skipped:
        print(f"  skip {name} (not configured)")
    for item in results:
        mark = "ok" if item["passed"] else "FAIL"
        print(f"  {mark} {item['name']} ({item['duration_s']:.1f}s)")
    if failures:
        print(failures[0][:1200])
    return 0 if passed else 1


def _run_check(store: Store, task_id: str, spec: dict) -> dict:
    argv = list(spec["argv"])
    cwd = repo_root() / spec["cwd"]
    timeout = int(spec.get("timeout_seconds") or 120)
    log_path = store.task_dir(task_id) / "logs" / f"{spec['name']}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    store.emit("command_start", {"name": spec["name"], "argv": argv, "cwd": str(cwd)}, task_id)
    started = time.monotonic()
    stop = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(10):
            store.emit(
                "heartbeat",
                {"name": spec["name"], "elapsed_s": round(time.monotonic() - started, 1)},
                task_id,
            )

    worker = threading.Thread(target=heartbeat, daemon=True)
    worker.start()
    try:
        completed = subprocess.run(
            argv, cwd=cwd, capture_output=True, text=True, timeout=timeout,
            env=os.environ.copy(),
        )
        returncode = completed.returncode
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
    except FileNotFoundError as error:
        returncode = 127
        stdout = ""
        stderr = str(error)
    except subprocess.TimeoutExpired as error:
        returncode = 124
        stdout = error.stdout or ""
        stderr = (error.stderr or "") + f"\nTimed out after {timeout}s"
    finally:
        stop.set()

    duration = time.monotonic() - started
    log_path.write_text(
        f"$ {' '.join(argv)}\nexit: {returncode}\nduration_seconds: {duration:.3f}\n"
        f"\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}\n"
    )
    store.emit(
        "command_end",
        {"name": spec["name"], "returncode": returncode, "duration_s": round(duration, 3),
         "log": str(log_path)},
        task_id,
    )
    tail = (stdout + stderr)[-4000:]
    return {
        "name": spec["name"],
        "command": " ".join(argv),
        "returncode": returncode,
        "passed": returncode == 0,
        "duration_s": duration,
        "log": str(log_path),
        "tail": tail,
    }


def cmd_review(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if not task:
        raise SystemExit(f"unknown task {args.task}")
    if args.from_diff:
        envelope = review_from_diff(store, task)
    else:
        raw = Path(args.file).read_text() if args.file else sys.stdin.read()
        envelope = Envelope.model_validate_json(raw)
    dest = apply_review_envelope(store, args.task, envelope)
    print(dest)
    print("approved" if envelope.approved else "rejected")
    if envelope.blocking:
        for item in envelope.blocking:
            print(f"  {item}")
    return 0 if envelope.approved else 1


def cmd_finish(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if not task:
        raise SystemExit(f"unknown task {args.task}")
    if task["status"] == "accepted":
        raise SystemExit(f"{args.task} is already accepted")
    store.emit("checkpoint", {"message": "finish: work from git"}, args.task)
    envelope = work_from_git(store, task)
    dest = apply_work_envelope(store, args.task, envelope)
    print(dest)
    gate_args = argparse.Namespace(task=args.task, kind=args.kind, fail_fast=False)
    gate_rc = cmd_gate(gate_args)
    if gate_rc != 0:
        print("finish stopped: gate failed (accept refused until green)")
        return gate_rc
    review = review_from_diff(store, store.load_state()["tasks"][args.task])
    apply_review_envelope(store, args.task, review)
    print("approved" if review.approved else "rejected")
    if review.blocking:
        for item in review.blocking:
            print(f"  {item}")
        return 1
    print(f"ready to accept {args.task}")
    return 0


def cmd_accept(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if not task:
        raise SystemExit(f"unknown task {args.task}")
    gate = task.get("last_gate") or {}
    review = task.get("last_review") or {}
    if not gate.get("passed"):
        raise SystemExit("accept refused: last gate did not pass")
    if not review.get("approved"):
        raise SystemExit("accept refused: review is not approved")
    writes = task.get("writes") or []
    if writes:
        violations = unscoped_violations(store, writes, task.get("scope_baseline"))
        if violations:
            raise SystemExit(
                "accept refused: dirty files outside writes\n"
                + "\n".join(f"  {path}" for path in violations)
            )
    task["status"] = "accepted"
    task["phase"] = "accepted"
    state["paused"] = not state.get("auto_advance")
    envelope = Envelope(
        status="success", kind="acceptance", task_id=args.task,
        summary=f"accepted {args.task}", accepted=True,
    )
    dest = store.write_envelope(envelope)
    store.save_state(state)
    store.emit("accepted", {"envelope": str(dest), "paused": state["paused"]}, args.task)
    if tracker_is_beads(store) and task.get("bead_id"):
        try:
            beads_close(store.root, task["bead_id"], f"accepted {args.task}")
            store.emit("bead_closed", {"bead_id": task["bead_id"]}, args.task)
            print(f"bead {task['bead_id']} closed")
        except SystemExit as error:
            print(f"bead close failed (sm already accepted): {error}")
    print(f"accepted {args.task}")
    if state["paused"]:
        print("paused — run task next to continue")
    else:
        print("auto_advance on — claim the next ready task")
    return 0


def bar(done: int, total: int, width: int = 20) -> str:
    if total <= 0:
        return "[" + "-" * width + "]"
    filled = int(width * done / total)
    return "[" + "#" * filled + "-" * (width - filled) + f"] {done}/{total}"


def cmd_status(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    pointer = store.machine_dir / "current-run"
    if not pointer.exists():
        print("installed, no run yet")
        return 0
    state = store.load_state()
    tasks = list(state["tasks"].values())
    accepted = sum(1 for task in tasks if task["status"] == "accepted")
    print(f"run {state['run_id']}  profile={state.get('profile')}  "
          f"paused={state.get('paused')}  auto_advance={state.get('auto_advance')}")
    print(f"tasks {bar(accepted, len(tasks))}")
    for task in tasks:
        gate = (task.get("last_gate") or {}).get("passed")
        review = (task.get("last_review") or {}).get("approved")
        print(f"  {task['id']}  {task['status']:<9}  phase={task.get('phase') or '-':<16}  "
              f"gate={_yn(gate)} review={_yn(review)}  {task['title']}")
    events = _read_events(store, limit=1)
    if events:
        last = events[-1]
        print(f"last {last['ts']} {last['type']} {last.get('task_id', '')}")
    return 0


def _yn(value: Any) -> str:
    if value is True:
        return "pass"
    if value is False:
        return "fail"
    return "-"


def _read_events(store: Store, limit: int = 50, task_id: str | None = None) -> list[dict]:
    path = store.events_path()
    if not path.exists():
        return []
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if task_id:
        rows = [row for row in rows if row.get("task_id") == task_id]
    return rows[-limit:]


def cmd_tail(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    for row in _read_events(store, limit=args.limit, task_id=args.task):
        extra = row.get("payload") or {}
        hint = extra.get("message") or extra.get("name") or extra.get("kind") or ""
        print(f"{row['ts']}  {row['type']:<14}  {row.get('task_id', ''):<8}  {hint}")
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    cycles = 1 if args.once else None
    seen = 0
    while True:
        if os.name != "nt" and not args.once:
            sys.stdout.write("\033[2J\033[H")
        cmd_status(args)
        events = _read_events(store, limit=200)
        if len(events) > seen:
            print("-- latest --")
            for row in events[seen:][-8:]:
                print(f"  {row['type']} {row.get('task_id', '')} {row.get('payload', {})}")
            seen = len(events)
        if cycles == 1:
            return 0
        time.sleep(args.interval)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dmsm", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    defaults = sub.add_parser("defaults", help="print app folder, writes, and done-means")
    defaults.set_defaults(func=cmd_defaults)

    scope = sub.add_parser("scope", help="classify current dirty files against writes")
    scope.set_defaults(func=cmd_scope)

    init = sub.add_parser("init", help="stamp machine files and optional fixture")
    init.add_argument("--profile", default="tauri")
    init.add_argument("--force", action="store_true")
    init.add_argument("--scaffold", action=argparse.BooleanOptionalAction, default=True)
    init.add_argument("--ask", action="store_true", help="ask layout questions after stamp")
    init.add_argument(
        "--accept-defaults",
        action="store_true",
        help="fill app_folder/writes from the profile without asking",
    )
    init.add_argument(
        "--tracker",
        default="",
        choices=("", "none", "beads"),
        help="none (default) or beads — beads also runs when first-run tracker question is yes",
    )
    init.set_defaults(func=cmd_init)

    configure = sub.add_parser("configure", help="first-run layout questions or flags")
    configure.add_argument("--ask", action="store_true", help="prompt in the terminal")
    configure.add_argument("--accept-defaults", action="store_true")
    configure.add_argument("--app-folder", default="")
    configure.add_argument("--done", default="")
    configure.add_argument("--writes", action="append", default=[])
    configure.add_argument("--tracker", default="", choices=("", "none", "beads"))
    configure.add_argument(
        "--auto-advance",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="keep claiming after accept until idle or a red gate",
    )
    configure.set_defaults(func=cmd_configure)

    auto = sub.add_parser("auto", help="turn auto-advance on or off")
    auto.add_argument("switch", choices=("on", "off"))
    auto.set_defaults(func=cmd_auto)

    add = sub.add_parser("task-add", help="queue a task")
    add.add_argument("--title", required=True)
    add.add_argument("--done", default="")
    add.add_argument("--writes", action="append", default=[])
    add.add_argument("--depends", action="append", default=[])
    add.set_defaults(func=cmd_task_add)

    nxt = sub.add_parser("task-next", help="claim next ready task")
    nxt.add_argument("--agent", default=os.environ.get("USER", "agent"))
    nxt.add_argument("--force", action="store_true")
    nxt.set_defaults(func=cmd_task_next)

    claim = sub.add_parser("task-claim", help="claim a task")
    claim.add_argument("task_id")
    claim.add_argument("--agent", default=os.environ.get("USER", "agent"))
    claim.add_argument("--force", action="store_true")
    claim.set_defaults(func=cmd_task_claim)

    handoff = sub.add_parser("handoff", help="store or print an envelope")
    handoff.add_argument("--task", required=True)
    handoff.add_argument("--kind", choices=KINDS)
    handoff.add_argument("--file")
    handoff.add_argument("--print", action="store_true")
    handoff.add_argument("--from-git", action="store_true", help="build a work envelope from git status")
    handoff.set_defaults(func=cmd_handoff)

    progress = sub.add_parser("progress", help="record a checkpoint")
    progress.add_argument("--task", required=True)
    progress.add_argument("--message", required=True)
    progress.add_argument("--estimate", type=int)
    progress.set_defaults(func=cmd_progress)

    gate = sub.add_parser("gate", help="run profile checks")
    gate.add_argument("--task", required=True)
    gate.add_argument("--kind", choices=("fast", "full", "package"), default="fast")
    gate.add_argument("--fail-fast", action="store_true")
    gate.set_defaults(func=cmd_gate)

    review = sub.add_parser("review", help="store a review envelope")
    review.add_argument("--task", required=True)
    review.add_argument("--file")
    review.add_argument("--from-diff", action="store_true", help="approve only if dirty files stay in writes")
    review.set_defaults(func=cmd_review)

    finish = sub.add_parser("finish", help="work from git, run gate, review from diff; does not accept")
    finish.add_argument("--task", required=True)
    finish.add_argument("--kind", choices=("fast", "full", "package"), default="fast")
    finish.set_defaults(func=cmd_finish)

    accept = sub.add_parser("accept", help="accept a gated + approved task")
    accept.add_argument("--task", required=True)
    accept.set_defaults(func=cmd_accept)

    status = sub.add_parser("status", help="print run status")
    status.set_defaults(func=cmd_status)

    tail = sub.add_parser("tail", help="print recent events")
    tail.add_argument("--task")
    tail.add_argument("--limit", type=int, default=25)
    tail.set_defaults(func=cmd_tail)

    watch = sub.add_parser("watch", help="live status from the event log")
    watch.add_argument("--interval", type=float, default=1.0)
    watch.add_argument("--once", action="store_true")
    watch.set_defaults(func=cmd_watch)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
