#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""dm-software-machine CLI — deterministic task, gate, and progress commands."""

from __future__ import annotations

import argparse
import fcntl
import fnmatch
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

import yaml
from pydantic import BaseModel, Field, ValidationError

SKILL_ROOT = Path(__file__).resolve().parent.parent
VERSION = (SKILL_ROOT / "VERSION").read_text().strip()
MACHINE_DIR = ".dm-software-machine"
KINDS = ("intent", "handoff", "work", "review", "quality", "acceptance")
TASK_STATUSES = (
    "briefing",
    "queued",
    "claimed",
    "active",
    "gated",
    "reviewed",
    "accepted",
    "blocked",
    "failed",
)
GITIGNORE_ENTRIES = [
    ".dm-software-machine/runs/",
    ".dm-software-machine/current-run",
    ".dm-software-machine/project-tasks.json",
    ".dm-software-machine/export.json",
    ".dm-software-machine/board.html",
    ".dm-software-machine/board-overrides.json",
    ".dm-software-machine/worktrees/",
    ".dm-software-machine/install-manifest.json",
    "node_modules/",
    "**/node_modules/",
    "target/",
    "**/target/",
    "dist/",
    "**/.astro/",
    ".env",
    ".DS_Store",
    "__pycache__/",
    "*.pyc",
]
PROJECT_STORE_SCHEMA = "0.5-smdm"
EXPORT_SCHEMA = "0.5-smdm"
OVERRIDES_SCHEMA = "0.5-smdm-overrides"
DEFAULT_CLAIM_LEASE_HOURS = 24
PRIORITIES = ("P1", "P2", "P3", "P4")
TASK_KINDS = ("task", "subtask", "subcard")
BOARD_STATUS = {
    "briefing": "ready",
    "queued": "ready",
    "claimed": "claimed",
    "active": "running",
    "gated": "review",
    "reviewed": "review",
    "accepted": "done",
    "blocked": "blocked",
    "failed": "failed",
}
BOARD_STATE_TO_STATUS = {
    "ready": "queued",
    "claimed": "claimed",
    "running": "active",
    "review": "gated",
    "blocked": "blocked",
    "failed": "failed",
    # "done" / accepted: not importable from the board — use sm-accept
}
MACHINE_OWNED_PREFIXES = (
    "specs/",
    ".dm-software-machine/",
)
NEVER_WRITE_DIRS = ("node_modules", "target", "dist", ".astro")
PLACEHOLDER_TEST = re.compile(r"no test specified", re.I)

SPEC_HEADINGS = (
    "Problem",
    "In scope",
    "Out of scope",
    "UX / behavior",
    "Tests",
)
SPEC_PLACEHOLDER = re.compile(r"\b(TODO|TBD|fill me)\b", re.I)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
DEFAULT_PROBLEM_HINT = (
    "<!-- What is wrong or missing. Quote the user if they wrote it. Do not invent. -->"
)
TICKET_OPEN = ("briefing", "queued", "claimed", "active", "gated", "reviewed")
TICKET_STOPWORDS = frozenset(
    "a an the to for of and or in on at is be this that with from into "
    "just use sm ticket spec".split()
)
WORD_RE = re.compile(r"[a-z0-9]+")

# Lane titles the Markable kanban reads from specs/board.md. status: on each
# card is one of these titles. Dragging a card rewrites that line.
BOARD_LANES = (
    ("Ready", "#4c78e8"),
    ("Claimed", "#7a6bb5"),
    ("Running", "#e6a23c"),
    ("Review", "#3aa0c8"),
    ("Blocked", "#b32e35"),
    ("Failed", "#8a3d3d"),
    ("Done", "#3d9a6a"),
)
CARD_FIELDS = (
    "title",
    "status",
    "priority",
    "assignee",
    "tags",
    "blocked-by",
    "writes",
    "claimed-by",
    "claim-lease",
    "repairs",
    "order",
    "reason",
    "working",
    "agent",
)


def lane_title(status: str, existing: str = "") -> str:
    """Column name for a machine status. A Done card that is not accepted stays Done."""
    if status == "reviewed" and existing.strip().lower() == "done":
        return "Done"
    return {
        "briefing": "Ready",
        "queued": "Ready",
        "claimed": "Claimed",
        "active": "Running",
        "gated": "Review",
        "reviewed": "Review",
        "blocked": "Blocked",
        "failed": "Failed",
        "accepted": "Done",
    }.get(status, "Ready")


def status_from_lane(lane: str, current: str) -> str:
    """Machine status for a lane. Done is reviewed until sm-accept writes accepted."""
    key = lane.strip().lower()
    if key == "ready":
        return "briefing" if current == "briefing" else "queued"
    if key == "review":
        return "reviewed" if current == "reviewed" else "gated"
    if key == "done":
        return "accepted" if current == "accepted" else "reviewed"
    return {
        "claimed": "claimed",
        "running": "active",
        "blocked": "blocked",
        "failed": "failed",
    }.get(key, current or "queued")


def one_line(value: str) -> str:
    """A card field is one line. A newline would split the note from the ticket."""
    return " ".join(str(value).split())


def yaml_quote(value: str) -> str:
    if value == "":
        return '""'
    if any(ch in value for ch in ':#{}[],&*!|>%@`"\'\n\\') or value.strip() != value:
        escaped = (
            value.replace("\\", "\\\\")
            .replace('"', '\\"')
            .replace("\n", "\\n")
            .replace("\r", "")
        )
        return f'"{escaped}"'
    return value


def yaml_unquote(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        inner = text[1:-1]
        if text[0] == '"':
            out: list[str] = []
            index = 0
            while index < len(inner):
                if inner[index] == "\\" and index + 1 < len(inner):
                    nxt = inner[index + 1]
                    out.append({"n": "\n", "\\": "\\", '"': '"'}.get(nxt, nxt))
                    index += 2
                    continue
                out.append(inner[index])
                index += 1
            return "".join(out)
        return inner
    return text


def split_note(text: str) -> tuple[dict[str, str], str]:
    """Split a card into frontmatter scalars and the spec body."""
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        return {}, normalized
    end = normalized.find("\n---\n", 4)
    if end < 0:
        return {}, normalized
    meta: dict[str, str] = {}
    for line in normalized[4:end].splitlines():
        if not line.strip() or line[0] in " \t" or ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = yaml_unquote(value.strip())
    return meta, normalized[end + 5 :]


def task_spec_path(store: "Store", task: dict) -> Path:
    specs = str(store.cfg.get("specs_dir") or "specs").strip("/")
    rel = task.get("spec_path") or f"{specs}/{task['id']}.md"
    path = Path(str(rel))
    if not path.is_absolute():
        path = store.root / path
    return path


def board_dir(store: "Store") -> Path:
    specs = str(store.cfg.get("specs_dir") or "specs").strip("/")
    return store.root / specs


def board_markdown(title: str = "Project") -> str:
    lanes = "\n".join(
        f"  - {yaml_quote(name + '|' + color)}" for name, color in BOARD_LANES
    )
    return (
        "---\n"
        "kanban: board\n"
        f"title: {yaml_quote(title)}\n"
        "show-title: yes\n"
        "show-tags: yes\n"
        "show-progress: yes\n"
        "lane:\n"
        f"{lanes}\n"
        "---\n"
        "\n"
        "This folder is the project. This file is the board. Every other note here is a task.\n"
    )


def ensure_board_file(store: "Store") -> Path:
    path = board_dir(store) / "board.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(board_markdown())
    return path


def pid_alive(raw: str) -> bool:
    """True when that process is still running. The pattern is a live agent."""
    try:
        pid = int(str(raw).strip())
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def card_frontmatter(task: dict, existing: dict[str, str]) -> dict[str, str]:
    fields: dict[str, str] = {
        "title": str(task.get("title") or ""),
        "status": lane_title(str(task.get("status") or ""), existing.get("status", "")),
        "priority": str(task.get("priority") or "P2"),
    }
    owner = str(task.get("owner") or "").strip()
    if owner and owner != "unassigned":
        fields["assignee"] = owner
    labels = [str(item) for item in (task.get("labels") or []) if str(item).strip()]
    if labels:
        fields["tags"] = ", ".join(labels)
    deps = [str(item) for item in (task.get("depends_on") or []) if str(item).strip()]
    if deps:
        fields["blocked-by"] = ", ".join(deps)
    writes = [str(item) for item in (task.get("writes") or []) if str(item).strip()]
    if writes:
        fields["writes"] = ", ".join(writes)
    holder = str(task.get("claimed_by") or "").strip()
    if holder:
        fields["claimed-by"] = holder
    lease = str(task.get("claim_lease") or "").strip()
    if lease:
        fields["claim-lease"] = lease
    repairs = int(task.get("repair_count") or 0)
    if repairs:
        fields["repairs"] = str(repairs)
    if existing.get("order"):
        fields["order"] = existing["order"]
    reason = one_line(str(task.get("reason") or ""))
    if reason:
        fields["reason"] = reason
    agent_pid = str(task.get("agent_pid") or existing.get("agent") or "").strip()
    was_working = str(existing.get("working") or "").strip().lower() in ("yes", "true", "1", "on")
    settled = str(task.get("status") or "") in (
        "gated",
        "reviewed",
        "accepted",
        "failed",
        "blocked",
    )
    if agent_pid and pid_alive(agent_pid):
        fields["working"] = "yes"
        fields["agent"] = agent_pid
    elif was_working or agent_pid:
        if not settled and not fields.get("reason"):
            fields["reason"] = "The agent stopped."
    for key, value in existing.items():
        if key in fields or key in CARD_FIELDS:
            continue
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", key):
            continue
        fields[key] = value
    return fields


def compose_note(fields: dict[str, str], body: str) -> str:
    ordered = [key for key in CARD_FIELDS if key in fields]
    ordered.extend(key for key in fields if key not in ordered)
    lines = [f"{key}: {yaml_quote(fields[key])}" for key in ordered]
    if not body.startswith("\n"):
        body = "\n" + body
    if not body.endswith("\n"):
        body += "\n"
    return "---\n" + "\n".join(lines) + "\n---\n" + body


def write_task_note(store: "Store", task: dict) -> None:
    path = task_spec_path(store, task)
    if path.name == "board.md" or not path.is_file():
        return
    existing, body = split_note(path.read_text(encoding="utf-8"))
    path.write_text(compose_note(card_frontmatter(task, existing), body), encoding="utf-8")


def apply_note_to_task(task: dict, meta: dict[str, str]) -> None:
    """Copy the visible card fields onto the task. The note wins."""
    if "status" not in meta:
        return
    title = meta.get("title", "").strip()
    if title:
        task["title"] = title
    task["status"] = status_from_lane(meta.get("status", ""), str(task.get("status") or ""))
    if meta.get("priority") in PRIORITIES:
        task["priority"] = meta["priority"]
    if "assignee" in meta:
        task["owner"] = meta["assignee"].strip() or task.get("owner") or "unassigned"
    if "tags" in meta:
        task["labels"] = [part.strip() for part in meta["tags"].split(",") if part.strip()]
    if "blocked-by" in meta:
        task["depends_on"] = [
            part.strip()
            for part in meta["blocked-by"].split(",")
            if part.strip().startswith("t-")
        ]
    task["kind"] = "task"
    task["parent"] = None


def apply_notes_to_state(store: "Store", state: dict) -> None:
    for task in (state.get("tasks") or {}).values():
        path = task_spec_path(store, task)
        if not path.is_file():
            continue
        try:
            meta, _body = split_note(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        apply_note_to_task(task, meta)


def write_notes_from_state(store: "Store", state: dict) -> None:
    for task in (state.get("tasks") or {}).values():
        write_task_note(store, task)


def drop_missing_notes(store: "Store", state: dict) -> list[str]:
    """A deleted note is gone. A later board update does not write it back."""
    folder = board_dir(store)
    if not folder.is_dir():
        return []
    messages: list[str] = []
    tasks = state.get("tasks") or {}
    root = folder.resolve()
    for task_id, task in list(tasks.items()):
        path = task_spec_path(store, task)
        if path.name == "board.md":
            continue
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        if path.is_file():
            continue
        tasks.pop(task_id, None)
        messages.append(f"{task_id} deleted")
    return messages


def spec_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current: str | None = None
    buf: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current is not None:
                sections[current] = "\n".join(buf).strip()
            current = line[3:].strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf).strip()
    return sections


def _section_has_content(body: str) -> bool:
    stripped = HTML_COMMENT.sub("", body or "").strip()
    if not stripped:
        return False
    if SPEC_PLACEHOLDER.search(stripped):
        return False
    return True


def spec_complete(path: Path) -> tuple[bool, list[str]]:
    if not path.exists():
        return False, ["missing spec file"]
    sections = spec_sections(path.read_text())
    missing: list[str] = []
    for heading in SPEC_HEADINGS:
        if heading not in sections:
            missing.append(f"missing heading ## {heading}")
        elif not _section_has_content(sections[heading]):
            missing.append(f"empty or placeholder ## {heading}")
    return (not missing, missing)


def spec_refuse_message(task_id: str, missing: list[str], spec_path: str) -> str:
    lines = [f"{task_id} spec is incomplete ({spec_path})"]
    lines.extend(f"  {item}" for item in missing)
    lines.append(f"Fill the spec, then: just sm-ready {task_id}")
    return "\n".join(lines)


def render_spec_template(
    *,
    title: str,
    done: str,
    writes: list[str],
    defaults: dict,
    problem: str = "",
) -> str:
    template = (SKILL_ROOT / "templates" / "spec.md").read_text()
    problem_block = problem.strip() if problem.strip() else DEFAULT_PROBLEM_HINT
    return (
        template
        .replace("{{title}}", title)
        .replace("{{done}}", done)
        .replace("{{writes}}", ", ".join(writes))
        .replace("{{dev}}", f"cd {defaults['dev_cwd']} && {defaults['dev_command']}")
        .replace("{{problem}}", problem_block)
    )


def require_brief(store: "Store") -> bool:
    return bool(store.cfg.get("require_brief", False))


def ticket_tokens(text: str) -> set[str]:
    return {
        word for word in WORD_RE.findall((text or "").lower())
        if word not in TICKET_STOPWORDS and len(word) > 1
    }


def ticket_score(query: str, task: dict) -> int:
    raw = (query or "").strip().lower()
    tid = str(task.get("id") or "").lower()
    title = str(task.get("title") or "").lower()
    spec = str(task.get("spec_path") or "").replace("\\", "/").lower()
    if raw in {tid, spec, f"{tid}.md", f"specs/{tid}.md"}:
        return 100
    if raw.startswith("t-") and raw == tid:
        return 100
    q_tokens = ticket_tokens(query)
    t_tokens = ticket_tokens(task.get("title") or "")
    if raw and title and (raw in title or title in raw) and len(raw) >= 6:
        return 85
    if not q_tokens:
        return 0
    overlap = len(q_tokens & t_tokens)
    if overlap == 0:
        return 0
    ratio = overlap / len(q_tokens)
    if ratio >= 0.6:
        return int(60 + 30 * ratio)
    if overlap >= 2:
        return 50 + overlap
    return 0


def resolve_ticket(query: str, tasks: list[dict]) -> dict | list[dict] | None:
    exact: list[dict] = []
    scored: list[tuple[int, dict]] = []
    for task in tasks:
        score = ticket_score(query, task)
        if score >= 100:
            exact.append(task)
        elif score >= 70:
            scored.append((score, task))
    if exact:
        return exact[0] if len(exact) == 1 else exact
    if len(scored) == 1:
        return scored[0][1]
    if len(scored) > 1:
        return [task for _, task in scored]
    return None


def print_ticket_ask(store: "Store", task: dict, *, action: str) -> None:
    spec_rel = task.get("spec_path") or f"specs/{task['id']}.md"
    spec_path = store.root / spec_rel
    ok, missing = spec_complete(spec_path)
    print(f"action {action}")
    print(task["id"])
    print(task["status"])
    print(f"spec {spec_rel}")
    if ok:
        if task["status"] == "briefing":
            print(f"Spec is complete. Then: just sm-ready {task['id']}")
        else:
            print(f"Spec is complete. Then: just sm-claim {task['id']}")
        return
    missing_heads = [
        heading for heading in SPEC_HEADINGS
        if any(heading in item for item in missing)
    ]
    print()
    print("Description is the brief. Translate it into the empty headings.")
    print("Ask only when the description cannot be carried out.")
    print()
    for heading in SPEC_HEADINGS:
        mark = "MISSING" if heading in missing_heads else "ok"
        print(f"  [{mark}] {heading}")
    print()
    print(f"File: {spec_rel}")
    print(f"When the translation is in the file: just sm-ready {task['id']}")



def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    text = str(ts).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def claim_lease_hours(store: "Store") -> float:
    return float(store.cfg.get("claim_lease_hours") or DEFAULT_CLAIM_LEASE_HOURS)


def claim_is_stale(
    task: dict, *, hours: float, now: datetime | None = None
) -> bool:
    if task.get("status") != "claimed":
        return False
    lease = parse_iso(task.get("claim_lease"))
    if lease is None:
        return True
    current = now or datetime.now(timezone.utc)
    return current - lease > timedelta(hours=hours)


def release_claim(
    task: dict,
    reason: str,
    *,
    store: "Store | None" = None,
    force_remove: bool = False,
) -> None:
    if store is not None:
        if force_remove and task.get("worktree_path"):
            dest = store.root / str(task["worktree_path"])
            precious = worktree_has_precious_work(store, task, dest) if dest.exists() else []
            if precious:
                print(
                    f"warning: force-removing worktree with {'; '.join(precious)}"
                )
        remove_task_worktree(store, task, force=force_remove)
    task["status"] = "queued"
    task["claimed_by"] = None
    task["claim_lease"] = None
    task["phase"] = "reclaimed"
    task["reason"] = reason


def refresh_claim_lease(task: dict) -> None:
    """Keep an in-flight claim from expiring during long gates / progress."""
    if task.get("status") in ("claimed", "active", "gated", "reviewed"):
        task["claim_lease"] = now_iso()


def release_stale_claims(store: "Store", state: dict) -> list[str]:
    hours = claim_lease_hours(store)
    released: list[str] = []
    for task in state.get("tasks", {}).values():
        if claim_is_stale(task, hours=hours):
            holder = task.get("claimed_by") or "unknown"
            release_claim(
                task,
                f"Stale claim lease released (was {holder}).",
                store=store,
            )
            released.append(task["id"])
    return released


def mark_over_repair_failed(task: dict, *, kind: str) -> None:
    task["status"] = "failed"
    task["reason"] = (
        f"{kind} red after {task.get('repair_count', 0)} repairs "
        f"(max {task.get('max_repairs', 2)}); stopped for review."
    )
    task["claimed_by"] = None
    task["claim_lease"] = None


def repo_root() -> Path:
    """Resolve the main project root even when cwd is a task worktree."""
    cwd = Path.cwd().resolve()
    parts = cwd.parts
    marker = (MACHINE_DIR, "worktrees")
    for index in range(len(parts) - 1):
        if parts[index : index + 2] == marker:
            root = Path(*parts[:index]) if parts[:index] else Path("/")
            return root.resolve()
    common = subprocess.run(
        ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if common.returncode == 0:
        git_dir = Path(common.stdout.strip())
        main = git_dir.parent if git_dir.name == ".git" else git_dir
        if (main / MACHINE_DIR / "machine.yaml").exists():
            return main.resolve()
        listed = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=str(main),
            capture_output=True,
            text=True,
        )
        if listed.returncode == 0:
            for line in listed.stdout.splitlines():
                if line.startswith("worktree "):
                    candidate = Path(line.split(" ", 1)[1]).resolve()
                    if (candidate / MACHINE_DIR / "machine.yaml").exists():
                        return candidate
                    return candidate
    top = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if top.returncode == 0:
        return Path(top.stdout.strip()).resolve()
    for parent in (cwd, *cwd.parents):
        if (parent / MACHINE_DIR / "machine.yaml").exists():
            return parent
    return cwd


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


def _rewrite_profile_cwd(raw_cwd: str, profile_app: str, app_folder: str) -> str:
    """Map profile-hardcoded app paths onto the configured app_folder."""
    cwd = normalize_rel(str(raw_cwd or "."))
    prof = normalize_rel(str(profile_app or "")).rstrip("/")
    app = normalize_rel(str(app_folder or "")).rstrip("/")
    if not prof or not app or prof == app:
        return cwd
    if cwd == prof:
        return app
    if cwd.startswith(f"{prof}/"):
        return f"{app}/{cwd[len(prof) + 1:]}"
    return cwd


def select_checks(
    store: "Store",
    kind: str,
    *,
    checkout: Path | None = None,
) -> tuple[list[dict], list[str]]:
    raw = (store.profile.get("checks") or {}).get(kind) or []
    root = checkout or store.root
    defaults = resolve_defaults(store)
    app_folder = str(defaults.get("app_folder") or store.cfg.get("app_folder") or ".")
    profile_app = str(store.profile.get("app_dir") or app_folder)
    app = root / app_folder
    selected: list[dict] = []
    skipped: list[str] = []
    for spec in raw:
        name = str(spec.get("name") or "check")
        rel_cwd = _rewrite_profile_cwd(spec.get("cwd", "."), profile_app, app_folder)
        cwd = root / rel_cwd
        target = cwd if cwd.exists() else app
        if not should_run_check(spec, target):
            skipped.append(name)
            continue
        item = dict(spec)
        item["cwd"] = rel_cwd
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
    profile_app = str(profile.get("app_dir") or app_folder or "")
    raw_dev_cwd = profile.get("dev_cwd") or app_folder
    dev_cwd = _rewrite_profile_cwd(str(raw_dev_cwd), profile_app, app_folder)
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
        "claim_lease_hours": float(
            cfg.get("claim_lease_hours") or DEFAULT_CLAIM_LEASE_HOURS
        ),
        "require_brief": bool(cfg.get("require_brief", False)),
        "worktrees": worktrees_enabled(store),
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


def scoped_paths(checkout: Path, writes: list[str]) -> list[str]:
    """Tracked + dirty files under write scopes (for gate fingerprints)."""
    found: set[str] = set()
    for raw in writes:
        rel = normalize_rel(str(raw))
        if not rel:
            continue
        path = checkout / rel.rstrip("/")
        if path.is_file():
            found.add(normalize_rel(rel.rstrip("/")))
            continue
        if path.is_dir():
            for child in path.rglob("*"):
                if not child.is_file():
                    continue
                if any(part in NEVER_WRITE_DIRS for part in child.parts):
                    continue
                found.add(normalize_rel(str(child.relative_to(checkout))))
    for rel in git_changed_files(checkout):
        if path_in_patterns(rel, writes):
            found.add(rel)
    return sorted(found)


def scoped_tree_digest(checkout: Path, writes: list[str]) -> str:
    digest = hashlib.sha256()
    for rel in scoped_paths(checkout, writes):
        body = file_digest(checkout, rel) or "missing"
        digest.update(f"{rel}:{body}\n".encode())
    return digest.hexdigest()


def worktrees_enabled(store: "Store") -> bool:
    raw = store.cfg.get("worktrees")
    if raw is None:
        return True
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return bool(raw)


def run_git(
    root: Path,
    *args: str,
    check: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=root,
        capture_output=True,
        text=True,
        env=env or os.environ.copy(),
    )
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise SystemExit(
            f"git {' '.join(args)} failed ({completed.returncode})"
            + (f"\n{detail}" if detail else "")
        )
    return completed


def task_branch_name(task_id: str) -> str:
    return f"sm/{task_id}"


def worktree_relpath(task_id: str) -> str:
    return f".dm-software-machine/worktrees/{task_id}"


def task_checkout_root(store: "Store", task: dict | None) -> Path:
    if not task:
        return store.root
    rel = (task.get("worktree_path") or "").strip()
    if not rel:
        return store.root
    path = Path(rel)
    if not path.is_absolute():
        path = store.root / path
    return path if path.is_dir() else store.root


def _symlink_share(src: Path, dest: Path) -> None:
    if dest.exists() or dest.is_symlink():
        return
    # Create the shared dir on main so the first worktree cold-build fills it
    # for later tasks (node_modules / target / dist / .astro).
    if not src.exists():
        try:
            src.mkdir(parents=True, exist_ok=True)
        except OSError:
            return
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        dest.symlink_to(src, target_is_directory=src.is_dir() or not src.exists())
    except OSError:
        pass


def _worktree_copy_ignore(directory: str, names: list[str]) -> set[str]:
    skip = {"node_modules", "target", "dist", ".astro", ".git", "__pycache__"}
    return {name for name in names if name in skip or name.endswith(".pyc")}


def materialize_app_into_worktree(store: "Store", worktree: Path) -> None:
    """If the app exists on main but not in the worktree (scaffold-after-commit), copy it.

    Heavy build dirs are skipped here and re-linked by share_worktree_build_artifacts.
    """
    defaults = resolve_defaults(store)
    app = str(defaults.get("app_folder") or store.profile.get("app_dir") or "").rstrip("/")
    if not app or _is_unset(app):
        return
    main_app = store.root / app
    wt_app = worktree / app
    if not main_app.is_dir():
        return
    marker = "package.json"
    if (wt_app / marker).is_file() or (wt_app / "src-tauri" / "Cargo.toml").is_file():
        return
    if not (main_app / marker).is_file() and not (main_app / "src-tauri" / "Cargo.toml").is_file():
        return
    if wt_app.exists():
        shutil.rmtree(wt_app)
    shutil.copytree(main_app, wt_app, ignore=_worktree_copy_ignore)


def share_worktree_build_artifacts(store: "Store", worktree: Path) -> None:
    """Reuse main-tree node_modules / target so gates don't reinstall from scratch."""
    defaults = resolve_defaults(store)
    app = str(defaults.get("app_folder") or store.profile.get("app_dir") or "").rstrip("/")
    if not app or _is_unset(app):
        return
    materialize_app_into_worktree(store, worktree)
    pairs = [
        (f"{app}/node_modules", f"{app}/node_modules"),
        (f"{app}/dist", f"{app}/dist"),
        (f"{app}/.astro", f"{app}/.astro"),
        (f"{app}/src-tauri/target", f"{app}/src-tauri/target"),
    ]
    for main_rel, wt_rel in pairs:
        _symlink_share(store.root / main_rel, worktree / wt_rel)
    share_plugin_bundles(store, worktree)


def share_plugin_bundles(store: "Store", worktree: Path) -> None:
    """The Tauri build glob needs the generated plugin files, which git does not keep."""
    defaults = resolve_defaults(store)
    app = str(defaults.get("app_folder") or store.profile.get("app_dir") or "").rstrip("/")
    if not app or _is_unset(app):
        return
    main_core = store.root / app / "src-tauri" / "plugins" / "core"
    wt_core = worktree / app / "src-tauri" / "plugins" / "core"
    if not main_core.is_dir():
        return
    wt_core.mkdir(parents=True, exist_ok=True)
    for src in main_core.glob("*.js"):
        _symlink_share(src, wt_core / src.name)


def worktree_has_precious_work(store: "Store", task: dict, dest: Path) -> list[str]:
    """Return reasons this worktree should not be force-deleted."""
    reasons: list[str] = []
    if not dest.exists():
        return reasons
    try:
        dirty = git_changed_files(dest)
    except SystemExit:
        dirty = []
    if dirty:
        reasons.append(f"dirty files: {', '.join(dirty[:8])}")
    base = (task.get("worktree_base") or "").strip()
    if base:
        ahead = run_git(
            dest, "rev-list", "--count", f"{base}..HEAD", check=False
        )
        if ahead.returncode == 0:
            try:
                count = int((ahead.stdout or "0").strip() or "0")
            except ValueError:
                count = 0
            if count > 0:
                reasons.append(f"{count} commit(s) ahead of claim base")
    return reasons


def archive_task_worktree(store: "Store", task: dict, dest: Path) -> str:
    """Move a precious worktree aside instead of deleting it."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_rel = (
        f".dm-software-machine/worktrees/archived-{task['id']}-{stamp}"
    )
    archive = store.root / archive_rel
    archive.parent.mkdir(parents=True, exist_ok=True)
    # Detach from git worktree registry, keep files.
    run_git(store.root, "worktree", "remove", "--force", str(dest), check=False)
    if dest.exists():
        if archive.exists():
            shutil.rmtree(archive, ignore_errors=True)
        dest.rename(archive)
    run_git(store.root, "worktree", "prune", check=False)
    return archive_rel


def remove_task_worktree(
    store: "Store", task: dict, *, force: bool = False
) -> None:
    rel = (task.get("worktree_path") or "").strip()
    branch = (task.get("worktree_branch") or "").strip()
    if rel:
        dest = store.root / rel
        if dest.exists() and not force:
            precious = worktree_has_precious_work(store, task, dest)
            if precious:
                archive_rel = archive_task_worktree(store, task, dest)
                task["worktree_archived"] = archive_rel
                task["reason"] = (
                    (task.get("reason") or "")
                    + f" · worktree archived at {archive_rel} ({'; '.join(precious)})"
                ).strip(" ·")
                # Keep the branch so archived commits remain reachable.
                task.pop("worktree_path", None)
                # worktree_branch kept for recovery hints
                return
        listed = run_git(store.root, "worktree", "list", "--porcelain", check=False)
        if dest.exists() or rel in (listed.stdout or ""):
            run_git(
                store.root,
                "worktree",
                "remove",
                "--force",
                str(dest),
                check=False,
            )
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        run_git(store.root, "worktree", "prune", check=False)
    if branch and force:
        # Delete task branch only after a successful accept (force).
        run_git(store.root, "branch", "-D", branch, check=False)
    elif branch and not task.get("worktree_archived"):
        run_git(store.root, "branch", "-D", branch, check=False)
    task.pop("worktree_path", None)
    task.pop("worktree_branch", None)
    task.pop("worktree_base", None)


def ensure_task_worktree(store: "Store", task: dict) -> dict:
    """Create (or reuse) an isolated worktree for a claimed task."""
    if not (store.root / ".git").exists() and not (store.root / ".git").is_file():
        raise SystemExit("worktrees require a git repository")
    head = run_git(store.root, "rev-parse", "HEAD", check=False)
    if head.returncode != 0:
        raise SystemExit(
            "worktrees need at least one commit "
            "(init usually creates one; otherwise: git commit)"
        )
    task_id = task["id"]
    rel = worktree_relpath(task_id)
    dest = store.root / rel
    branch = task_branch_name(task_id)
    if dest.is_dir() and (
        (dest / ".git").exists() or (dest / ".git").is_file()
    ):
        task["worktree_path"] = rel
        task["worktree_branch"] = branch
        task.setdefault("worktree_base", head.stdout.strip())
        share_worktree_build_artifacts(store, dest)
        return {
            "path": rel,
            "branch": branch,
            "base": task.get("worktree_base") or head.stdout.strip(),
            "reused": True,
        }
    # Clean stale path / branch from a prior crash.
    if dest.exists():
        run_git(store.root, "worktree", "remove", "--force", str(dest), check=False)
        shutil.rmtree(dest, ignore_errors=True)
    run_git(store.root, "worktree", "prune", check=False)
    run_git(store.root, "branch", "-D", branch, check=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    run_git(store.root, "worktree", "add", "-b", branch, str(dest), "HEAD")
    share_worktree_build_artifacts(store, dest)
    base = head.stdout.strip()
    task["worktree_path"] = rel
    task["worktree_branch"] = branch
    task["worktree_base"] = base
    return {"path": rel, "branch": branch, "base": base, "reused": False}


def commit_task_worktree(store: "Store", task: dict) -> list[str]:
    """Stage write-scoped dirty files in the worktree and commit if needed."""
    checkout = task_checkout_root(store, task)
    if checkout == store.root:
        return []
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    dirty = git_changed_files(checkout)
    inside = [path for path in dirty if path_in_patterns(path, writes)]
    if not inside and not dirty:
        # Already clean — ensure branch has a commit tip for merge.
        return []
    if not inside:
        raise SystemExit(
            "accept refused: worktree has dirty files outside writes\n"
            + "\n".join(f"  {path}" for path in dirty)
        )
    run_git(checkout, "add", "--", *inside)
    staged = run_git(checkout, "diff", "--cached", "--name-only")
    files = [line.strip() for line in staged.stdout.splitlines() if line.strip()]
    if not files:
        return []
    title = (task.get("title") or task["id"]).replace('"', "'")
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "dm-software-machine")
    env.setdefault("GIT_AUTHOR_EMAIL", "sm@local")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    run_git(
        checkout,
        "-c",
        "user.name=dm-software-machine",
        "-c",
        "user.email=sm@local",
        "commit",
        "-m",
        f"sm: {task['id']} {title}",
        env=env,
    )
    return files


def current_checkout_branch(root: Path) -> str:
    completed = run_git(root, "rev-parse", "--abbrev-ref", "HEAD", check=False)
    name = (completed.stdout or "").strip()
    if completed.returncode != 0 or not name or name == "HEAD":
        raise SystemExit(
            "accept refused: main checkout is detached HEAD; "
            "check out a branch first"
        )
    return name


def classify_merge_failure(detail: str, *, branch: str, task_id: str) -> str:
    text = detail.lower()
    if "local changes would be overwritten" in text:
        return (
            f"accept refused: main checkout has local changes that overlap {branch}\n"
            "Commit or stash them on main, then sm-accept again.\n"
            f"{detail}"
        )
    if "untracked working tree files would be overwritten" in text:
        return (
            f"accept refused: untracked files on main would be overwritten by {branch}\n"
            "Move or commit those files, then sm-accept again.\n"
            f"{detail}"
        )
    if "user.name" in text or "user.email" in text or "please tell me who you are" in text:
        return (
            "accept refused: git identity is not configured for the merge commit\n"
            "Set user.name / user.email, or retry (sm sets a local fallback on task commits).\n"
            f"{detail}"
        )
    return (
        f"accept refused: merge conflict integrating {branch}\n"
        f"In the task worktree: just sm-rebase {task_id}  # merges main into the task branch\n"
        "Resolve conflicts there, then just sm-finish && just sm-accept again.\n"
        "Do not reclaim --force unless you intend to drop the branch work.\n"
        f"{detail}"
    )


def merge_task_branch(store: "Store", task: dict) -> None:
    branch = (task.get("worktree_branch") or "").strip()
    if not branch:
        return
    target = current_checkout_branch(store.root)
    # Refuse if main checkout is mid-merge.
    git_dir = store.root / ".git"
    merge_head = (
        git_dir / "MERGE_HEAD"
        if git_dir.is_dir()
        else None
    )
    if merge_head and merge_head.exists():
        raise SystemExit("accept refused: repository already has a merge in progress")
    env = os.environ.copy()
    env.setdefault("GIT_AUTHOR_NAME", "dm-software-machine")
    env.setdefault("GIT_AUTHOR_EMAIL", "sm@local")
    env.setdefault("GIT_COMMITTER_NAME", env["GIT_AUTHOR_NAME"])
    env.setdefault("GIT_COMMITTER_EMAIL", env["GIT_AUTHOR_EMAIL"])
    completed = run_git(
        store.root,
        "-c",
        "user.name=dm-software-machine",
        "-c",
        "user.email=sm@local",
        "merge",
        "--no-ff",
        "-m",
        f"sm accept {task['id']} into {target}",
        branch,
        check=False,
        env=env,
    )
    if completed.returncode != 0:
        run_git(store.root, "merge", "--abort", check=False)
        detail = (completed.stderr or completed.stdout or "").strip()
        raise SystemExit(classify_merge_failure(detail, branch=branch, task_id=task["id"]))


def classify_changes(store: "Store", writes: list[str], *, checkout: Path | None = None) -> dict[str, list[str]]:
    protected = list(store.cfg.get("protected_paths") or [])
    ignore = list(MACHINE_OWNED_PREFIXES)
    ignore.extend(protected)
    ignore.extend(store.cfg.get("ignore_dirty") or [])
    never = list(store.cfg.get("never_write") or [])
    never.extend(store.profile.get("never_write") or [])
    root = checkout or store.root
    dirty = git_changed_files(root)
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


def scope_snapshot(
    store: "Store",
    writes: list[str],
    *,
    checkout: Path | None = None,
) -> dict[str, str | None]:
    root = checkout or store.root
    scope = classify_changes(store, writes, checkout=root)
    snap: dict[str, str | None] = {}
    for path in scope["unscoped"] + scope["protected"] + scope["ignored"]:
        snap[path] = file_digest(root, path)
    return snap


def unscoped_violations(
    store: "Store",
    writes: list[str],
    baseline: dict | None,
    *,
    checkout: Path | None = None,
) -> list[str]:
    root = checkout or store.root
    scope = classify_changes(store, writes, checkout=root)
    if not baseline:
        return [f"{path} (outside writes)" for path in scope["unscoped"]]
    violations = []
    for path in scope["unscoped"]:
        now = file_digest(root, path)
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
    checkout = task_checkout_root(store, task)
    scope = classify_changes(store, writes, checkout=checkout)
    print_scope(scope)
    violations = unscoped_violations(
        store, writes, task.get("scope_baseline"), checkout=checkout
    )
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
            mark_over_repair_failed(task, kind="Review")
        else:
            task["reason"] = "Review rejected; repair and finish again."
    elif envelope.approved:
        task["reason"] = ""
    store.save_state(state)
    store.emit("review", {"approved": envelope.approved, "path": str(dest)}, task_id)
    return dest


def review_from_diff(store: Store, task: dict) -> Envelope:
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    checkout = task_checkout_root(store, task)
    scope = classify_changes(store, writes, checkout=checkout)
    blocking = []
    violations = unscoped_violations(
        store, writes, task.get("scope_baseline"), checkout=checkout
    )
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
        state = json.loads(path.read_text())
        apply_notes_to_state(self, state)
        return state

    def save_state(self, state: dict) -> None:
        write_notes_from_state(self, state)
        path = self.state_path(state["run_id"])
        atomic_write_json(path, state)
        sync_project_from_state(self, state)

    def state_lock_path(self, run_id: str | None = None) -> Path:
        return self.run_dir(run_id) / "state.lock"

    @contextmanager
    def locked_state(self, run_id: str | None = None) -> Iterator[dict]:
        """Exclusive lock around a load→mutate→save cycle for one run."""
        lock_path = self.state_lock_path(run_id)
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                state = self.load_state(run_id)
                yield state
                self.save_state(state)
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)

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


VENDOR_NAMES = (
    "SKILL.md",
    "VERSION",
    "scripts",
    "profiles",
    "templates",
    "references",
    "board",
)


def vendor_skill(root: Path, *, upgrade: bool = False) -> str:
    dest = root / "dm-software-machine"
    if SKILL_ROOT.resolve() == dest.resolve():
        return "vendor skipped (already in-repo)"
    if dest.exists() and not upgrade:
        return "vendor skipped (dm-software-machine/ exists)"
    dest.mkdir(parents=True, exist_ok=True)
    for name in VENDOR_NAMES:
        src = SKILL_ROOT / name
        if not src.exists():
            continue
        target = dest / name
        if src.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(
                src,
                target,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        else:
            shutil.copy2(src, target)
    return "vendor upgraded" if upgrade else "vendored dm-software-machine/"


def _yes(reply: str, default: bool = False) -> bool:
    text = reply.strip().lower()
    if not text:
        return default
    return text in ("y", "yes")


def apply_tracker(root: Path, tracker: str) -> str:
    """Force tracker to none. Built-in store + board only."""
    tracker = (tracker or "none").strip().lower()
    if tracker and tracker not in ("none",):
        raise SystemExit(
            f"tracker={tracker!r} is not supported. "
            "Use tracker: none (built-in store + board)."
        )
    machine_yaml = machine_path(root) / "machine.yaml"
    if machine_yaml.exists():
        machine_yaml.write_text(
            set_yaml_scalar(machine_yaml.read_text(), "tracker", "none")
        )
    return "tracker=none"


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
    additions = []
    if "sm-auto" not in text:
        additions.append("sm-auto MODE:\n    {{sm}} auto {{MODE}}\n")
    if "sm-export" not in text:
        additions.append("sm-export *ARGS:\n    {{sm}} export \"$@\"\n")
    if "sm-board" not in text:
        additions.append("sm-board *ARGS:\n    {{sm}} board \"$@\"\n")
    if "sm-board-serve" not in text:
        additions.append(
            "sm-board-serve *ARGS:\n    {{sm}} board \"$@\"\n"
        )
    if "sm-overrides-import" not in text:
        additions.append(
            "sm-overrides-import *ARGS:\n    {{sm}} overrides-import \"$@\"\n"
            "sm-overrides-export *ARGS:\n    {{sm}} overrides-export \"$@\"\n"
        )
    if "sm-ticket" not in text:
        additions.append(
            "sm-ticket *ARGS:\n    {{sm}} task-ticket --title \"$@\"\n"
            "sm-brief *ARGS:\n    {{sm}} task-brief --title \"$@\"\n"
            "sm-ready TASK:\n    {{sm}} task-ready {{TASK}}\n"
        )
    if "sm-prime" not in text:
        additions.append(
            "[positional-arguments]\n"
            "sm-prime *ARGS:\n    {{sm}} prime \"$@\"\n"
            "[positional-arguments]\n"
            "sm-note TASK +TEXT:\n    {{sm}} task-note {{TASK}} \"${@:2}\"\n"
        )
    elif "sm-note TASK *ARGS" in text:
        text = text.replace(
            "sm-note TASK *ARGS:\n    {{sm}} task-note {{TASK}} \"$@\"\n",
            "[positional-arguments]\n"
            "sm-note TASK +TEXT:\n    {{sm}} task-note {{TASK}} \"${@:2}\"\n",
        )
        justfile.write_text(text)
        return "justfile sm-note fixed"
    if "sm-doctor" not in text:
        additions.append(
            "sm-rebase TASK:\n    {{sm}} rebase --task {{TASK}}\n"
            "sm-doctor:\n    {{sm}} doctor\n"
        )
    if "sm-test" not in text:
        additions.append(
            "sm-test:\n"
            "    #!/usr/bin/env bash\n"
            "    set -euo pipefail\n"
            "    root=\"$(pwd)\"\n"
            "    scripts=\"$root/dm-software-machine/scripts\"\n"
            "    for t in test_export.py test_brief.py test_worktrees.py test_unattended.py; do\n"
            "      echo \"=== $t ===\"\n"
            "      uv run \"$scripts/$t\"\n"
            "    done\n"
            "    echo \"unit suite ok (astro live: uv run dm-software-machine/scripts/test_astro.py)\"\n"
        )
    if additions:
        justfile.write_text(text.rstrip() + "\n\n" + "\n".join(additions))
        return "justfile +sm recipes"
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
    upgrade = bool(getattr(args, "upgrade", False))
    force = bool(args.force or upgrade)

    stamps = [
        (SKILL_ROOT / "templates" / "machine.yaml", dest_dir / "machine.yaml", bool(args.force)),
        (profile_src, dest_dir / "profile.yaml", bool(args.force)),
        (SKILL_ROOT / "templates" / "PROJECT.md", dest_dir / "PROJECT.md", force),
        (SKILL_ROOT / "SKILL.md", dest_dir / "SKILL.md", force),
        (SKILL_ROOT / "references" / "contracts.md", dest_dir / "contracts.md", force),
        (SKILL_ROOT / "templates" / "permissions.json", root / ".cursor" / "permissions.json", force),
    ]
    for src, dest, stamp_force in stamps:
        action = stamp_file(src, dest, stamp_force, manifest)
        rel = str(dest.relative_to(root))
        actions.append(f"{action} {rel}")
        if action != "skipped-local":
            manifest["files"][rel] = {"hash": file_hash(dest), "version": VERSION}

    machine_yaml = dest_dir / "machine.yaml"
    text = machine_yaml.read_text()
    # Preserve configured profile on upgrade unless --force restamped machine.yaml.
    if not upgrade or args.force:
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
        actions.append(apply_tracker(root, tracker or "none"))
    elif args.ask:
        rc = run_configure(store, ask=True, tracker=tracker)
        if rc != 0:
            return rc
        actions.append("configured via questions")
    elif tracker:
        actions.append(apply_tracker(root, tracker))
    elif not layout_is_configured(store.cfg, root):
        print(CONFIGURE_HINT)

    actions.append(vendor_skill(root, upgrade=upgrade))
    actions.append(ensure_justfile(root))
    if upgrade:
        actions.append(f"upgraded to {VERSION}")

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
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=dm-software-machine",
                "-c",
                "user.email=sm@local",
                "commit",
                "-m",
                "chore: initial commit for dm-software-machine",
            ],
            cwd=root,
            check=True,
        )
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
            # Commit only the scaffold tree so worktrees/gates see the app
            # without sweeping unrelated dirty files into the commit.
            if (root / ".git").exists():
                subprocess.run(["git", "add", "--", str(dest)], cwd=root, check=False)
                commit = subprocess.run(
                    [
                        "git",
                        "-c",
                        "user.name=dm-software-machine",
                        "-c",
                        "user.email=sm@local",
                        "commit",
                        "-m",
                        f"chore: scaffold {dest.name}",
                    ],
                    cwd=root,
                    capture_output=True,
                    text=True,
                )
                if commit.returncode == 0:
                    actions.append(f"committed scaffold {dest.name}")

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
        rid = pointer.read_text().strip()
        path = store.runs_dir() / rid / "state.json"
        if path.exists():
            return store.load_state()
        # Pointer survived a wiped runs/ tree — start a fresh run seeded from
        # the durable project store when present.
    run_id = uuid.uuid4().hex[:8]
    tasks: dict = {}
    project_path = project_store_path(store)
    if project_path.exists():
        try:
            project = json.loads(project_path.read_text())
            for tid, task in (project.get("tasks") or {}).items():
                row = dict(task)
                # In-flight work cannot resume without run envelopes; park it.
                if row.get("status") in ("claimed", "active", "gated", "reviewed"):
                    row["status"] = "queued"
                    row["claimed_by"] = None
                    row["claim_lease"] = None
                    row["worktree_path"] = None
                    row["worktree_branch"] = None
                    row["phase"] = "requeued"
                    row["reason"] = (
                        (row.get("reason") or "")
                        + " · requeued after missing run state"
                    ).strip(" ·")
                tasks[tid] = row
        except (json.JSONDecodeError, OSError):
            tasks = {}
    state = {
        "run_id": run_id,
        "profile": store.cfg.get("profile"),
        "created_at": now_iso(),
        "paused": not bool(store.cfg.get("auto_advance", False)),
        "auto_advance": bool(store.cfg.get("auto_advance", False)),
        "tasks": tasks,
    }
    store.set_current_run(run_id)
    store.save_state(state)
    store.emit("run_started", {"profile": state["profile"]}, run_id=run_id)
    return state


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(path)


def project_store_path(store: Store) -> Path:
    return store.machine_dir / "project-tasks.json"


def empty_project_store() -> dict:
    return {
        "schema_version": PROJECT_STORE_SCHEMA,
        "updated_at": now_iso(),
        "milestones": {},
        "tasks": {},
    }


def load_project_store(store: Store) -> dict:
    path = project_store_path(store)
    if not path.exists():
        return empty_project_store()
    project = json.loads(path.read_text())
    project.setdefault("milestones", {})
    project.setdefault("tasks", {})
    return project


def save_project_store(store: Store, project: dict) -> None:
    project = dict(project)
    project["schema_version"] = PROJECT_STORE_SCHEMA
    project["updated_at"] = now_iso()
    project.setdefault("milestones", {})
    project.setdefault("tasks", {})
    atomic_write_json(project_store_path(store), project)


def normalize_priority(value: str | None, *, default: str = "P2") -> str:
    text = (value or default).strip().upper()
    if text not in PRIORITIES:
        raise SystemExit(f"priority must be one of {', '.join(PRIORITIES)}")
    return text


def normalize_kind(value: str | None, *, default: str = "task") -> str:
    text = (value or default).strip().lower()
    if text not in TASK_KINDS:
        raise SystemExit(f"kind must be one of {', '.join(TASK_KINDS)}")
    return text



def normalize_labels(values) -> list[str]:
    """Deduped labels; preserve first-seen casing, match case-insensitively."""
    if values is None:
        return []
    if isinstance(values, str):
        values = [part.strip() for part in values.split(",")]
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        label = str(raw).strip()
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


def ensure_task_labels_notes(task: dict) -> None:
    task["labels"] = normalize_labels(task.get("labels"))
    notes = task.get("notes")
    if not isinstance(notes, list):
        task["notes"] = []
    else:
        cleaned = []
        for item in notes:
            if isinstance(item, dict) and str(item.get("text") or "").strip():
                cleaned.append(
                    {
                        "at": item.get("at") or now_iso(),
                        "by": str(item.get("by") or "agent"),
                        "text": str(item.get("text")).strip(),
                    }
                )
            elif isinstance(item, str) and item.strip():
                cleaned.append({"at": now_iso(), "by": "agent", "text": item.strip()})
        task["notes"] = cleaned


def append_task_note(task: dict, text: str, *, by: str = "") -> dict:
    ensure_task_labels_notes(task)
    note = {
        "at": now_iso(),
        "by": (by or os.environ.get("USER") or "agent").strip() or "agent",
        "text": text.strip(),
    }
    if not note["text"]:
        raise SystemExit("note text required")
    task["notes"].append(note)
    return note


def tasks_index(tasks: dict) -> dict[str, dict]:
    return {tid: task for tid, task in (tasks or {}).items()}


def unmet_depends(task: dict, by_id: dict[str, dict]) -> list[str]:
    accepted = {
        tid for tid, other in by_id.items() if other.get("status") == "accepted"
    }
    return [dep for dep in (task.get("depends_on") or []) if dep not in accepted]


def blockers_of(task_id: str, by_id: dict[str, dict]) -> list[str]:
    """Tasks that list task_id in depends_on and are not yet accepted."""
    out = []
    for tid, other in by_id.items():
        if tid == task_id:
            continue
        if other.get("status") == "accepted":
            continue
        if task_id in (other.get("depends_on") or []):
            out.append(tid)
    return sorted(out)


def collect_all_tasks(store: Store) -> dict[str, dict]:
    """Prefer current-run tasks, overlay durable project store for completeness."""
    project = ensure_project_seeded(store)
    merged = dict(project.get("tasks") or {})
    pointer = store.machine_dir / "current-run"
    if pointer.exists():
        state = store.load_state()
        merged.update(state.get("tasks") or {})
    for task in merged.values():
        ensure_task_labels_notes(task)
    return merged


def project_task_record(task: dict, run_id: str, previous: dict | None = None) -> dict:
    record = {key: value for key, value in task.items() if key != "scope_baseline"}
    record["run_id"] = run_id
    if record.get("bead_id") and not record.get("external_ref"):
        record["external_ref"] = record["bead_id"]
    record.setdefault("external_ref", record.get("bead_id"))
    record.setdefault("reason", "")
    prev = previous or {}
    if not record.get("priority"):
        record["priority"] = prev.get("priority") or "P2"
    else:
        record["priority"] = normalize_priority(str(record["priority"]))
    if record.get("milestone") in (None, ""):
        record["milestone"] = prev.get("milestone") or ""
    if not record.get("owner"):
        record["owner"] = prev.get("owner") or "unassigned"
    if record.get("description") in (None, ""):
        record["description"] = prev.get("description") or ""
    if not record.get("kind"):
        record["kind"] = prev.get("kind") or "task"
    else:
        record["kind"] = normalize_kind(str(record["kind"]))
    if "parent" not in record or record.get("parent") in ("",):
        record["parent"] = prev.get("parent")
    if record.get("parent") == "":
        record["parent"] = None
    ensure_task_labels_notes(record)
    if not record.get("labels") and prev.get("labels"):
        record["labels"] = normalize_labels(prev.get("labels"))
    if not record.get("notes") and prev.get("notes"):
        ensure_task_labels_notes(prev)
        record["notes"] = list(prev.get("notes") or [])
    ensure_task_labels_notes(record)
    return record


def sync_project_from_state(store: Store, state: dict) -> None:
    """Upsert current-run tasks into the durable project store (never wipe other runs)."""
    project = load_project_store(store)
    tasks = project.setdefault("tasks", {})
    run_id = state["run_id"]
    for task in state.get("tasks", {}).values():
        tasks[task["id"]] = project_task_record(
            task, run_id, previous=tasks.get(task["id"])
        )
    save_project_store(store, project)


def ensure_project_seeded(store: Store) -> dict:
    """Create/seed project-tasks.json from the current run when missing or empty."""
    path = project_store_path(store)
    if path.exists():
        project = load_project_store(store)
        if project.get("tasks"):
            return project
    pointer = store.machine_dir / "current-run"
    if not pointer.exists():
        project = empty_project_store()
        save_project_store(store, project)
        return project
    state = store.load_state()
    project = empty_project_store()
    for task in state.get("tasks", {}).values():
        project["tasks"][task["id"]] = project_task_record(task, state["run_id"])
    save_project_store(store, project)
    return project


def export_milestones(project: dict) -> list[dict]:
    milestones = project.get("milestones") or {}
    rows = []
    for item in milestones.values():
        rows.append({"id": item["id"], "name": item.get("name") or item["id"]})
    rows.sort(key=lambda row: row["id"])
    return rows


def require_milestone(project: dict, milestone_id: str) -> None:
    if not milestone_id:
        return
    if milestone_id not in (project.get("milestones") or {}):
        raise SystemExit(
            f"unknown milestone {milestone_id}; "
            f"add it with: milestone-add --id {milestone_id} --name '...'"
        )


def evidence_from_task(task: dict) -> dict:
    gate = task.get("last_gate") or {}
    review = task.get("last_review") or {}
    if gate.get("passed") is True:
        gate_v = "pass"
    elif gate.get("passed") is False:
        gate_v = "fail"
    else:
        gate_v = "none"
    if review.get("approved") is True:
        review_v = "pass"
    elif review.get("approved") is False:
        review_v = "fail"
    else:
        review_v = "none"
    acceptance = "accepted" if task.get("status") == "accepted" else "none"
    return {"gate": gate_v, "review": review_v, "acceptance": acceptance}


def latest_envelope_ref(store: Store, task: dict) -> dict | None:
    task_id = task["id"]
    run_id = task.get("run_id")
    try:
        if run_id:
            env_dir = store.run_dir(run_id) / "tasks" / task_id / "envelopes"
        else:
            env_dir = store.task_dir(task_id) / "envelopes"
    except SystemExit:
        return None
    if not env_dir.exists():
        return None
    files = sorted(env_dir.glob("*.json"), key=lambda p: p.stat().st_mtime)
    if not files:
        return None
    latest = files[-1]
    try:
        rel = str(latest.relative_to(store.root))
    except ValueError:
        rel = str(latest)
    return {"kind": latest.stem, "path": rel}


def export_task_row(store: Store, task: dict, *, by_id: dict[str, dict] | None = None) -> dict:
    ensure_task_labels_notes(task)
    holder = task.get("claimed_by")
    claim = None
    if holder:
        claim = {"holder": holder, "lease": task.get("claim_lease")}
    status = task.get("status")
    depends = list(task.get("depends_on") or [])
    repairs = int(task.get("repair_count") or 0)
    max_repairs = int(task.get("max_repairs") or 2)
    envelope = latest_envelope_ref(store, task)
    index = by_id or {task["id"]: task}
    waiting = unmet_depends(task, index)
    return {
        "id": task["id"],
        "title": task.get("title", ""),
        "description": task.get("description") or "",
        "kind": task.get("kind") or "task",
        "parent": task.get("parent"),
        "status": status,
        # Board display aliases (prototype columns). Canonical field is status.
        "state": BOARD_STATUS.get(str(status), str(status or "")),
        "priority": normalize_priority(str(task.get("priority") or "P2")),
        "milestone": task.get("milestone") or "",
        "owner": task.get("owner") or "unassigned",
        "labels": list(task.get("labels") or []),
        "notes": list(task.get("notes") or []),
        "depends_on": depends,
        "deps": depends,
        "waiting_on": waiting,
        "blocks": blockers_of(task["id"], index),
        "writes": list(task.get("writes") or []),
        "spec_path": task.get("spec_path"),
        "claimed_by": holder,
        "claim": claim,
        "worktree_path": task.get("worktree_path"),
        "worktree_branch": task.get("worktree_branch"),
        "repair_count": repairs,
        "retries": repairs,
        "max_repairs": max_repairs,
        "phase": task.get("phase"),
        "reason": task.get("reason") or "",
        "run_id": task.get("run_id"),
        "external_ref": task.get("external_ref") or task.get("bead_id"),
        "last_gate": task.get("last_gate"),
        "last_review": task.get("last_review"),
        "created_at": task.get("created_at"),
        "board_overrides_at": task.get("board_overrides_at"),
        "evidence": evidence_from_task(task),
        "latest_envelope": envelope,
        # Convenience for board cards / drawer links
        "envelope_path": (envelope or {}).get("path"),
    }



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
        # Built-in store + board only. Do not offer Beads at first run.
        tracker = tracker or "none"
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
    print(f"claim_lease_hours {defaults['claim_lease_hours']}")
    print(f"auto_advance {defaults['auto_advance']}")
    print(f"require_brief {defaults['require_brief']}")
    print(f"worktrees    {defaults.get('worktrees')}")
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


def _print_new_task(task: dict) -> None:
    print(task["id"])
    if task["status"] == "briefing":
        print("briefing")
        print(f"spec {task['spec_path']}")
        print(f"Fill the spec, then: just sm-ready {task['id']}")


def create_task(
    store: Store,
    args: argparse.Namespace,
    *,
    status: str,
    spec_mode: str,
) -> dict:
    state = ensure_run(store)
    defaults = resolve_defaults(store)
    project = ensure_project_seeded(store)
    known = set(state.get("tasks") or {}) | set((project.get("tasks") or {}))
    task_id = "t-" + uuid.uuid4().hex[:6]
    while task_id in known:
        task_id = "t-" + uuid.uuid4().hex[:6]
    writes = args.writes or defaults["writes"]
    done = args.done or defaults["done_means"]
    priority = normalize_priority(getattr(args, "priority", None) or "P2")
    milestone = (getattr(args, "milestone", None) or "").strip()
    require_milestone(project, milestone)
    owner = (getattr(args, "owner", None) or os.environ.get("USER") or "unassigned").strip()
    kind = normalize_kind(getattr(args, "kind", None) or "task")
    parent = (getattr(args, "parent", None) or "").strip() or None
    description = (getattr(args, "description", None) or "").strip()
    if parent and parent not in (project.get("tasks") or {}) and parent not in state.get(
        "tasks", {}
    ):
        raise SystemExit(f"unknown parent task {parent}")
    if kind != "task" and not parent:
        raise SystemExit(f"{kind} requires --parent")
    spec_rel = Path(store.cfg.get("specs_dir", "specs")) / f"{task_id}.md"
    spec_path = store.root / spec_rel
    spec_path.parent.mkdir(parents=True, exist_ok=True)
    if not spec_path.exists():
        if spec_mode == "template":
            body = render_spec_template(
                title=args.title,
                done=done,
                writes=writes,
                defaults=defaults,
                problem=getattr(args, "problem", "") or "",
            )
            # Append PM metadata for board/export visibility
            body += (
                f"\nPriority: {priority}\n"
                f"Milestone: {milestone or '-'}\n"
                f"Owner: {owner}\n"
                f"Kind: {kind}\n"
                f"Parent: {parent or '-'}\n"
            )
            if description:
                body = body.replace(
                    f"# {args.title}\n",
                    f"# {args.title}\n\n{description}\n",
                    1,
                )
            spec_path.write_text(body)
        else:
            body = description + "\n\n" if description else ""
            spec_path.write_text(
                f"# {args.title}\n\n{body}Done means: {done}\n"
                f"Writes: {', '.join(writes)}\n"
                f"Dev: cd {defaults['dev_cwd']} && {defaults['dev_command']}\n"
                f"Priority: {priority}\n"
                f"Milestone: {milestone or '-'}\n"
                f"Owner: {owner}\n"
                f"Kind: {kind}\n"
                f"Parent: {parent or '-'}\n"
            )
    spec_stored = str(spec_rel).replace("\\", "/")
    task = {
        "id": task_id,
        "title": args.title,
        "description": description,
        "kind": kind,
        "parent": parent,
        "status": status,
        "depends_on": args.depends or [],
        "writes": writes,
        "spec_path": spec_stored,
        "claimed_by": None,
        "claim_lease": None,
        "repair_count": 0,
        "max_repairs": int(store.cfg.get("max_repairs", 2)),
        "phase": None,
        "reason": "",
        "priority": priority,
        "milestone": milestone,
        "owner": owner,
        "labels": normalize_labels(getattr(args, "labels", None) or []),
        "notes": [],
        "last_gate": None,
        "last_review": None,
        "created_at": now_iso(),
    }
    state["tasks"][task_id] = task
    store.save_state(state)
    store.emit(
        "task_added",
        {
            "title": args.title,
            "writes": writes,
            "priority": priority,
            "milestone": milestone,
            "owner": owner,
            "status": status,
        },
        task_id,
    )
    intent = Envelope(
        status="success", kind="intent", task_id=task_id,
        summary=args.title, writes=writes, artifacts=[spec_stored],
    )
    store.write_envelope(intent)
    return task


def cmd_task_add(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    if require_brief(store):
        task = create_task(store, args, status="briefing", spec_mode="template")
        print_ticket_ask(store, task, action="created")
    else:
        task = create_task(store, args, status="queued", spec_mode="stub")
        _print_new_task(task)
    return 0


def cmd_task_brief(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    task = create_task(store, args, status="briefing", spec_mode="template")
    print_ticket_ask(store, task, action="created")
    return 0


def cmd_task_ticket(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    state = ensure_run(store)
    query = (args.title or "").strip()
    if not query:
        raise SystemExit("task-ticket needs --title (a sentence or t-xxxx)")
    if not getattr(args, "new", False):
        open_tasks = [
            task for task in state["tasks"].values()
            if task.get("status") in TICKET_OPEN
        ]
        match = resolve_ticket(query, open_tasks)
        if isinstance(match, list):
            print("ambiguous")
            for task in match:
                print(f"  {task['id']}  {task['status']:<10}  {task.get('title')}")
            print(f"Pick one: just sm-ticket {match[0]['id']}")
            print(
                "Or create new: uv run dm-software-machine/scripts/dmsm.py "
                f"task-ticket --new --title {query!r}"
            )
            return 2
        if match is not None:
            print_ticket_ask(store, match, action="found")
            return 0
    task = create_task(store, args, status="briefing", spec_mode="template")
    print_ticket_ask(store, task, action="created")
    return 0


def cmd_task_ready(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    state = store.load_state()
    task = state["tasks"].get(args.task_id)
    if not task:
        raise SystemExit(f"unknown task {args.task_id}")
    if task["status"] not in ("briefing", "queued"):
        raise SystemExit(f"{args.task_id} is {task['status']}")
    spec_rel = task.get("spec_path") or f"specs/{args.task_id}.md"
    spec_path = store.root / spec_rel
    ok, missing = spec_complete(spec_path)
    if not ok:
        raise SystemExit(spec_refuse_message(args.task_id, missing, spec_rel))
    task["status"] = "queued"
    task["phase"] = None
    store.save_state(state)
    store.emit("task_ready", {"spec_path": spec_rel}, args.task_id)
    print(args.task_id)
    print("queued")
    print(f"spec {spec_rel}")
    return 0



IN_FLIGHT = ("claimed", "active", "gated", "reviewed")


def file_write_set(paths: list[str]) -> set[str]:
    """Exact file locks (paths without a trailing slash, non-glob)."""
    found: set[str] = set()
    for raw in paths:
        rel = normalize_rel(str(raw))
        if not rel or rel.endswith("/") or any(ch in rel for ch in "*?["):
            continue
        found.add(rel)
    return found


def dir_write_prefixes(paths: list[str]) -> list[str]:
    """Directory scopes (trailing slash) and glob roots used for overlap."""
    found: list[str] = []
    for raw in paths:
        rel = normalize_rel(str(raw))
        if not rel:
            continue
        if rel.endswith("/"):
            found.append(rel)
            continue
        if any(ch in rel for ch in "*?["):
            # Treat the directory before the first glob as a scope prefix.
            cut = min(
                (i for i, ch in enumerate(rel) if ch in "*?["),
                default=len(rel),
            )
            prefix = rel[:cut].rsplit("/", 1)[0]
            found.append((prefix + "/") if prefix else "")
    return [item for item in found if item]


def _path_under_dir(path: str, directory: str) -> bool:
    rel = normalize_rel(path)
    folder = normalize_rel(directory)
    if not folder.endswith("/"):
        folder += "/"
    return rel == folder[:-1] or rel.startswith(folder)


def writes_overlap(left: list[str], right: list[str]) -> bool:
    """True when write scopes collide.

    Exact files overlap the same file. Directory scopes overlap each other and
    any file under them. An empty list still overlaps everything.
    """
    if not left or not right:
        return True
    left_files = file_write_set(left)
    right_files = file_write_set(right)
    if left_files & right_files:
        return True
    left_dirs = dir_write_prefixes(left)
    right_dirs = dir_write_prefixes(right)
    for folder in left_dirs:
        for other in right_dirs:
            if _path_under_dir(other[:-1], folder) or _path_under_dir(folder[:-1], other):
                return True
        for path in right_files:
            if _path_under_dir(path, folder):
                return True
    for folder in right_dirs:
        for path in left_files:
            if _path_under_dir(path, folder):
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


def ready_tasks(state: dict, store: Store | None = None) -> list[dict]:
    accepted = {tid for tid, task in state["tasks"].items() if task["status"] == "accepted"}
    brief = bool(store and require_brief(store))
    ready = []
    for task in state["tasks"].values():
        if task["status"] != "queued":
            continue
        if not all(dep in accepted for dep in task.get("depends_on") or []):
            continue
        if brief and store is not None:
            spec_rel = task.get("spec_path") or f"specs/{task['id']}.md"
            ok, _ = spec_complete(store.root / spec_rel)
            if not ok:
                continue
        ready.append(task)
    return ready


def cmd_task_next(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    released = release_stale_claims(store, state)
    if released:
        store.save_state(state)
        for tid in released:
            store.emit("claim_reclaimed", {"via": "task-next"}, tid)
    flying = in_flight_tasks(state)
    parallel = int(store.cfg.get("parallel") or 1)
    if len(flying) >= parallel and not args.force:
        print(f"paused on {flying[0]['id']} ({flying[0]['status']}) parallel={parallel}")
        return 2
    ready = ready_tasks(state, store)
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
    released = release_stale_claims(store, state)
    if released:
        for tid in released:
            store.emit("claim_reclaimed", {"via": "task-claim"}, tid)
    task = state["tasks"].get(task_id)
    if not task:
        raise SystemExit(f"unknown task {task_id}")
    if task["status"] in ("failed", "blocked") and force:
        task["status"] = "queued"
        task["claimed_by"] = None
        task["claim_lease"] = None
        task["repair_count"] = 0
        task["reason"] = ""
        task["phase"] = "requeued"
    accepted = {tid for tid, item in state["tasks"].items() if item["status"] == "accepted"}
    unmet = [dep for dep in task.get("depends_on") or [] if dep not in accepted]
    if unmet:
        raise SystemExit(f"{task_id} blocked by {unmet}")
    spec_rel = task.get("spec_path") or f"specs/{task_id}.md"
    clarify = task.get("phase") == "clarify"
    if task["status"] == "briefing":
        clarify = True
    elif require_brief(store) and not spec_complete(store.root / spec_rel)[0]:
        clarify = True
    holder = task.get("claimed_by")
    if (
        task["status"] == "claimed"
        and holder
        and holder != agent
        and not force
    ):
        raise SystemExit(f"{task_id} already claimed by {holder}")
    if task["status"] not in ("queued", "claimed", "briefing"):
        raise SystemExit(f"{task_id} is {task['status']}")
    if task["status"] in ("queued", "briefing") and not force:
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
    task["claim_lease"] = now_iso()
    task["reason"] = ""
    task["phase"] = "clarify" if clarify else "claimed"
    task.pop("agent_pid", None)
    task["agent_stopped"] = False
    writes = task.get("writes") or resolve_defaults(store)["writes"]
    wt_meta = None
    if worktrees_enabled(store):
        dirty_main = [
            path
            for path in git_changed_files(store.root)
            if path_in_patterns(path, writes)
        ]
        if dirty_main and not force:
            raise SystemExit(
                f"{task_id} refused: main checkout has dirty files inside writes\n"
                "Commit, stash, or finish that work before claiming a worktree.\n"
                + "\n".join(f"  {path}" for path in dirty_main[:20])
            )
        defaults = resolve_defaults(store)
        app = str(defaults.get("app_folder") or "").rstrip("/")
        if app and not force:
            marker = store.root / app / "package.json"
            tracked = run_git(
                store.root, "ls-files", "--", f"{app}/package.json", check=False
            )
            if marker.is_file() and not (tracked.stdout or "").strip():
                raise SystemExit(
                    f"{task_id} refused: {app}/ is untracked on main\n"
                    "Commit the app (or pass --force) before claiming a worktree, "
                    "or accept will fail when merging."
                )
        wt_meta = ensure_task_worktree(store, task)
    checkout = task_checkout_root(store, task)
    task["scope_baseline"] = scope_snapshot(store, writes, checkout=checkout)
    store.save_state(state)
    store.emit(
        "task_claimed",
        {
            "agent": agent,
            "lease": task["claim_lease"],
            "reclaimed": released,
            "worktree": (wt_meta or {}).get("path"),
            "branch": (wt_meta or {}).get("branch"),
        },
        task_id,
    )
    print(task_id)
    if wt_meta:
        print(f"worktree {wt_meta['path']}")
        print(f"branch {wt_meta['branch']}")
        print(f"Work only inside the worktree. Then: just sm-finish {task_id}")
    return 0


def cmd_reclaim(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    if args.task:
        task = state["tasks"].get(args.task)
        if not task:
            raise SystemExit(f"unknown task {args.task}")
        if task["status"] != "claimed":
            print(f"{args.task} not claimed ({task['status']})")
            return 1
        if not args.force and not claim_is_stale(task, hours=claim_lease_hours(store)):
            raise SystemExit(
                f"{args.task} lease still fresh; pass --force to release"
            )
        holder = task.get("claimed_by") or "unknown"
        release_claim(
            task,
            f"Claim released (was {holder}).",
            store=store,
            force_remove=bool(args.force),
        )
        store.save_state(state)
        store.emit("claim_reclaimed", {"holder": holder, "forced": args.force}, args.task)
        print(args.task)
        return 0
    released = release_stale_claims(store, state)
    if released:
        store.save_state(state)
        for tid in released:
            store.emit("claim_reclaimed", {"via": "reclaim"}, tid)
    print(f"reclaimed {len(released)}")
    for tid in released:
        print(tid)
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
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if task:
        refresh_claim_lease(task)
        store.save_state(state)
    payload = {"message": args.message, "estimate": args.estimate, "estimated": args.estimate is not None}
    store.emit("checkpoint", payload, args.task)
    print("checkpoint recorded")
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    # Lease bump under lock, then release for the long-running checks.
    with store.locked_state() as state:
        task = state["tasks"].get(args.task)
        if not task:
            raise SystemExit(f"unknown task {args.task}")
        if task.get("status") == "failed":
            raise SystemExit(
                f"{args.task} is failed — requeue with "
                f"just sm-reclaim --task {args.task} --force "
                f"then just sm-claim {args.task}"
            )
        refresh_claim_lease(task)
        checkout = task_checkout_root(store, task)
        writes = task.get("writes") or resolve_defaults(store)["writes"]
    checks, skipped = select_checks(store, args.kind, checkout=checkout)
    if not checks:
        raise SystemExit(f"profile has no checks for {args.kind}")
    store.emit("phase_start", {"phase": f"gate:{args.kind}"}, args.task)
    results = []
    logs = []
    for spec in checks:
        result = _run_check(store, args.task, spec, checkout=checkout)
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
    gate_digest = scoped_tree_digest(checkout, writes) if passed else None
    # Reload under lock so a concurrent accept/claim cannot be clobbered.
    with store.locked_state() as state:
        task = state["tasks"].get(args.task)
        if not task:
            raise SystemExit(f"unknown task {args.task}")
        task["last_gate"] = {
            "kind": args.kind,
            "passed": passed,
            "at": now_iso(),
            "digest": gate_digest,
        }
        if passed:
            task["gate_digest"] = gate_digest
            task["status"] = "gated"
            task["phase"] = f"gate:{args.kind}"
            task["repair_count"] = task.get("repair_count", 0)
            task["reason"] = ""
        else:
            task.pop("gate_digest", None)
            task["repair_count"] = int(task.get("repair_count", 0)) + 1
            if task["repair_count"] > task["max_repairs"]:
                mark_over_repair_failed(task, kind="Quality gate")
            else:
                task["status"] = "active"
                task["reason"] = one_line(
                    failures[0] if failures else f"{args.kind} gate failed"
                )[:240]
            task["phase"] = f"gate:{args.kind}:fail"
        refresh_claim_lease(task)
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


def _run_check(
    store: Store,
    task_id: str,
    spec: dict,
    *,
    checkout: Path | None = None,
) -> dict:
    argv = list(spec["argv"])
    root = checkout or store.root
    cwd = root / spec["cwd"]
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


def run_profile_gate_checks(
    store: Store,
    task_id: str,
    kind: str,
    *,
    checkout: Path,
    fail_fast: bool = False,
) -> tuple[bool, list[dict], list[str], list[str]]:
    """Run profile checks without mutating task state. Returns pass, results, skipped, failures."""
    checks, skipped = select_checks(store, kind, checkout=checkout)
    if not checks:
        raise SystemExit(f"profile has no checks for {kind}")
    results: list[dict] = []
    for spec in checks:
        result = _run_check(store, task_id, spec, checkout=checkout)
        results.append(result)
        if not result["passed"] and fail_fast:
            break
    passed = all(item["passed"] for item in results)
    failures = [
        f"{item['name']}: `{item['command']}` exited {item['returncode']}\n{item['tail']}"
        for item in results
        if not item["passed"]
    ]
    return passed, results, skipped, failures


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
    kind = args.kind or "fast"
    task["status"] = "gated"
    task["phase"] = f"gate:{kind}"
    task["reason"] = f"{kind} gate is running."
    refresh_claim_lease(task)
    store.save_state(state)
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


def cmd_rebase(args: argparse.Namespace) -> int:
    """Merge the main checkout branch into the task worktree (conflict recovery)."""
    store = Store(repo_root())
    store.require_installed()
    state = store.load_state()
    task = state["tasks"].get(args.task)
    if not task:
        raise SystemExit(f"unknown task {args.task}")
    checkout = task_checkout_root(store, task)
    if checkout == store.root:
        raise SystemExit(f"{args.task} has no worktree; nothing to rebase")
    main_branch = current_checkout_branch(store.root)
    # Use the object name from main HEAD so we don't require the branch tip
    # inside the worktree remote setup.
    main_tip = run_git(store.root, "rev-parse", "HEAD").stdout.strip()
    completed = run_git(
        checkout,
        "-c",
        "user.name=dm-software-machine",
        "-c",
        "user.email=sm@local",
        "merge",
        "-m",
        f"sm rebase: merge {main_branch} into task",
        main_tip,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise SystemExit(
            f"rebase conflict in worktree for {args.task}\n"
            f"Resolve files under {task.get('worktree_path')}, then:\n"
            f"  git -C {task.get('worktree_path')} add -A && "
            f"git -C {task.get('worktree_path')} commit --no-edit\n"
            f"Then: just sm-finish {args.task}\n{detail}"
        )
    task.pop("gate_digest", None)
    if task.get("last_gate"):
        task["last_gate"]["passed"] = False
    task["status"] = "active"
    task["phase"] = "rebased"
    task["reason"] = f"Merged {main_branch} into worktree; re-run finish."
    store.save_state(state)
    store.emit("task_rebased", {"main": main_branch, "tip": main_tip}, args.task)
    print(args.task)
    print(f"merged {main_branch} ({main_tip[:8]}) into worktree")
    print(f"next: just sm-finish {args.task}")
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Report install/config health for general-use readiness."""
    store = Store(repo_root())
    issues: list[str] = []
    notes: list[str] = []
    print(f"dm-software-machine doctor {VERSION}")
    print(f"root {store.root}")
    if not (store.machine_dir / "machine.yaml").exists():
        print("FAIL: not installed (.dm-software-machine/machine.yaml missing)")
        return 1
    machine_ver = str(store.cfg.get("version") or "")
    if machine_ver and machine_ver != VERSION:
        issues.append(
            f"machine.yaml version {machine_ver} != package {VERSION} "
            "(run: just sm-init --upgrade --profile <tauri|astro>)"
        )
    else:
        notes.append(f"version {VERSION}")
    vendor = store.root / "dm-software-machine" / "VERSION"
    if vendor.is_file():
        vend = vendor.read_text().strip()
        if vend != VERSION:
            issues.append(f"vendored VERSION {vend} != running CLI {VERSION}")
        else:
            notes.append("vendor package matches CLI")
    else:
        notes.append("running from skill path (no in-repo vendor VERSION)")
    if not layout_is_configured(store.cfg, store.root):
        issues.append("not configured (app_folder SET_ME or configured:false)")
    else:
        app = resolve_defaults(store)["app_folder"]
        notes.append(f"app_folder {app}")
        if not (store.root / app).is_dir():
            issues.append(f"app_folder missing on disk: {app}")
    if shutil.which("just") is None:
        issues.append("just not on PATH")
    else:
        notes.append("just on PATH")
    justfile = store.root / "justfile"
    if justfile.exists():
        text = justfile.read_text()
        if "sm-finish" not in text:
            issues.append("justfile missing sm-* recipes")
        elif "sm-note TASK *ARGS" in text:
            issues.append("justfile has broken sm-note recipe (upgrade recipes)")
        else:
            notes.append("justfile has sm recipes")
    else:
        issues.append("justfile missing")
    if not (store.root / ".git").exists() and not (store.root / ".git").is_file():
        issues.append("not a git repo (worktrees/accept need git)")
    else:
        notes.append("git repo ok")
        if worktrees_enabled(store):
            notes.append("worktrees enabled")
        pointer = store.machine_dir / "current-run"
        if pointer.exists():
            rid = pointer.read_text().strip()
            if not (store.runs_dir() / rid / "state.json").exists():
                issues.append(
                    f"current-run {rid} has no state.json "
                    "(run any command that calls ensure_run to recover)"
                )
            else:
                notes.append(f"run {rid} present")
    for line in notes:
        print(f"ok  {line}")
    for line in issues:
        print(f"FIX {line}")
    if issues:
        print(f"{len(issues)} issue(s)")
        return 1
    print("healthy")
    return 0


def cmd_accept(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_installed()
    with store.locked_state() as state:
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
        checkout = task_checkout_root(store, task)
        expected = task.get("gate_digest") or gate.get("digest")
        if expected:
            current = scoped_tree_digest(checkout, writes)
            if current != expected:
                raise SystemExit(
                    "accept refused: working tree changed since the last green gate\n"
                    f"Re-run: just sm-finish {args.task}"
                )
        if writes:
            violations = unscoped_violations(
                store, writes, task.get("scope_baseline"), checkout=checkout
            )
            if violations:
                raise SystemExit(
                    "accept refused: dirty files outside writes\n"
                    + "\n".join(f"  {path}" for path in violations)
                )
        # Drop the lock before git merge / post-merge gate.
        worktree_path = task.get("worktree_path")

    committed: list[str] = []
    if worktree_path:
        # Re-load task fields needed for merge without holding the lock.
        state = store.load_state()
        task = state["tasks"][args.task]
        committed = commit_task_worktree(store, task)
        merge_task_branch(store, task)
        remove_task_worktree(store, task, force=True)
        # Persist cleared worktree fields before the final accept lock reloads.
        store.save_state(state)
        if committed:
            store.emit(
                "worktree_merged",
                {"files": committed, "branch": task_branch_name(args.task)},
                args.task,
            )

    # Re-run the fast gate on main after the merge lands (when an app tree exists).
    defaults = resolve_defaults(store)
    app = str(defaults.get("app_folder") or "").rstrip("/")
    app_path = store.root / app if app and not _is_unset(app) else None
    has_app = bool(
        app_path
        and (
            (app_path / "package.json").is_file()
            or (app_path / "src-tauri" / "Cargo.toml").is_file()
        )
    )
    if not has_app:
        print("post-merge fast: skip (no app tree on main)")
        post_passed = True
        post_results = []
        post_skipped = []
        post_failures = []
    else:
        store.emit("phase_start", {"phase": "gate:fast:post-merge"}, args.task)
        post_passed, post_results, post_skipped, post_failures = run_profile_gate_checks(
            store, args.task, "fast", checkout=store.root
        )
        store.emit(
            "gate",
            {
                "kind": "fast:post-merge",
                "passed": post_passed,
                "merged": bool(worktree_path),
            },
            args.task,
        )
        store.emit(
            "phase_end",
            {"phase": "gate:fast:post-merge", "passed": post_passed},
            args.task,
        )
        print("post-merge fast: " + ("pass" if post_passed else "fail"))
        for name in post_skipped:
            print(f"  skip {name} (not configured)")
        for item in post_results:
            mark = "ok" if item["passed"] else "FAIL"
            print(f"  {mark} {item['name']} ({item['duration_s']:.1f}s)")
    if not post_passed:
        reason = (
            post_failures[0][:240]
            if post_failures
            else "post-merge fast gate failed on main"
        )
        with store.locked_state() as state:
            task = state["tasks"].get(args.task)
            if not task:
                raise SystemExit(f"unknown task {args.task}")
            task["last_gate"] = {
                "kind": "fast:post-merge",
                "passed": False,
                "at": now_iso(),
                "digest": None,
            }
            task.pop("gate_digest", None)
            task["status"] = "reviewed"
            task["phase"] = "gate:fast:post-merge:fail"
            task["reason"] = (
                "Merge landed on main but post-merge gate failed. "
                f"Fix on main, then: just sm-gate {args.task} && just sm-accept {args.task}. "
                f"Detail: {reason}"
            )
        print("accept refused: post-merge gate failed (merge already on main)")
        if post_failures:
            print(post_failures[0][:1200])
        return 1

    with store.locked_state() as state:
        task = state["tasks"].get(args.task)
        if not task:
            raise SystemExit(f"unknown task {args.task}")
        task["last_gate"] = {
            "kind": "fast:post-merge",
            "passed": True,
            "at": now_iso(),
            "digest": scoped_tree_digest(
                store.root, task.get("writes") or resolve_defaults(store)["writes"]
            ),
        }
        task["status"] = "accepted"
        task["phase"] = "accepted"
        task.pop("gate_digest", None)
        task.pop("worktree_path", None)
        task.pop("worktree_branch", None)
        task.pop("worktree_base", None)
        task["reason"] = ""
        state["paused"] = not bool(state.get("auto_advance"))
        envelope = Envelope(
            status="success", kind="acceptance", task_id=args.task,
            summary=f"accepted {args.task}", accepted=True,
        )
        dest = store.write_envelope(envelope)
        paused = state["paused"]
    store.emit("accepted", {"envelope": str(dest), "paused": paused}, args.task)
    print(f"accepted {args.task}")
    if paused:
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
    by_id = tasks_index(state.get("tasks") or {})
    for task in by_id.values():
        ensure_task_labels_notes(task)
    tasks = list(by_id.values())
    accepted = sum(1 for task in tasks if task["status"] == "accepted")
    print(
        f"run {state['run_id']}  profile={state.get('profile')}  "
        f"paused={state.get('paused')}  auto_advance={state.get('auto_advance')}"
    )
    print(f"tasks {bar(accepted, len(tasks))}")
    for task in tasks:
        gate = (task.get("last_gate") or {}).get("passed")
        review = (task.get("last_review") or {}).get("approved")
        waiting = unmet_depends(task, by_id)
        labels = ",".join(task.get("labels") or []) or "-"
        wait = f"  waiting={','.join(waiting)}" if waiting else ""
        print(
            f"  {task['id']}  {task['status']:<9}  "
            f"phase={task.get('phase') or '-':<16}  "
            f"gate={_yn(gate)} review={_yn(review)}  "
            f"P={task.get('priority') or 'P2'}  labels={labels}  "
            f"{task['title']}{wait}"
        )
        if task.get("status") in ("blocked", "failed") and task.get("reason"):
            print(f"           reason: {task['reason']}")
    waiting_rows = [
        task
        for task in tasks
        if task["status"] != "accepted" and unmet_depends(task, by_id)
    ]
    if waiting_rows:
        print("deps")
        for task in waiting_rows:
            bits = []
            for dep in unmet_depends(task, by_id):
                other = by_id.get(dep)
                st = other.get("status") if other else "missing"
                bits.append(f"{dep}({st})")
            print(f"  {task['id']} waits on {', '.join(bits)}")
    stuck = [t for t in tasks if t.get("status") in ("blocked", "failed")]
    if stuck:
        print("stuck")
        for task in stuck:
            print(f"  {task['id']}  {task['status']}  {task.get('reason') or '-'}")
    events = _read_events(store, limit=1)
    if events:
        last = events[-1]
        print(f"last {last['ts']} {last['type']} {last.get('task_id', '')}")
    return 0


def cmd_prime(args: argparse.Namespace) -> int:
    """Agent resume dump: layout, queue, claims, deps, stuck, recent events."""
    store = Store(repo_root())
    store.require_configured()
    defaults = resolve_defaults(store)
    by_id = collect_all_tasks(store)
    pointer = store.machine_dir / "current-run"
    run_id = None
    auto = defaults.get("auto_advance")
    if pointer.exists():
        state = store.load_state()
        run_id = state.get("run_id")
        auto = state.get("auto_advance", auto)
    lines: list[str] = []
    lines.append("# sm prime — reload this after compaction / new agent")
    lines.append(f"project: {store.root.name}")
    lines.append(f"package: {VERSION}")
    lines.append(f"run: {run_id or '(none)'}")
    lines.append(f"profile: {defaults.get('profile')}")
    lines.append(f"app_folder: {defaults.get('app_folder')}")
    lines.append(f"writes: {', '.join(defaults.get('writes') or [])}")
    lines.append(f"tracker: {defaults.get('tracker')}")
    lines.append(f"require_brief: {defaults.get('require_brief')}")
    lines.append(f"auto_advance: {auto}")
    lines.append(f"parallel: {defaults.get('parallel')}")
    lines.append(f"worktrees: {defaults.get('worktrees')}")
    lines.append("")

    ready = ready_tasks({"tasks": by_id}, store)
    in_flight = [t for t in by_id.values() if t.get("status") in IN_FLIGHT]
    queued = [t for t in by_id.values() if t.get("status") == "queued"]
    briefing = [t for t in by_id.values() if t.get("status") == "briefing"]
    stuck = [t for t in by_id.values() if t.get("status") in ("blocked", "failed")]
    accepted = [t for t in by_id.values() if t.get("status") == "accepted"]

    def _fmt(task: dict) -> list[str]:
        labels = ",".join(task.get("labels") or []) or "-"
        waiting = unmet_depends(task, by_id)
        wait = f" waiting_on={','.join(waiting)}" if waiting else ""
        claim = f" claim={task['claimed_by']}" if task.get("claimed_by") else ""
        out = [
            f"- {task['id']} [{task.get('status')}] "
            f"P={task.get('priority') or 'P2'} labels={labels} "
            f"{task.get('title')}{claim}{wait}"
        ]
        if task.get("worktree_path"):
            out.append(
                f"  worktree: {task.get('worktree_path')} "
                f"({task.get('worktree_branch') or 'branch?'})"
            )
        if task.get("spec_path"):
            out.append(f"  spec: {task.get('spec_path')}")
        if task.get("reason"):
            out.append(f"  reason: {task.get('reason')}")
        notes = task.get("notes") or []
        if notes:
            last = notes[-1]
            out.append(
                f"  note: ({last.get('at')} {last.get('by')}) {last.get('text')}"
            )
        return out

    def _section(title: str, items: list[dict]) -> None:
        lines.append(f"## {title} ({len(items)})")
        if not items:
            lines.append("- (none)")
        else:
            for task in sorted(items, key=lambda t: t["id"]):
                lines.extend(_fmt(task))
        lines.append("")

    _section("in flight", in_flight)
    _section("ready to claim", ready)
    _section("queued / waiting", queued)
    _section("briefing", briefing)
    _section("stuck blocked/failed", stuck)

    lines.append("## dependency edges (unmet)")
    edges = []
    for task in sorted(by_id.values(), key=lambda t: t["id"]):
        for dep in unmet_depends(task, by_id):
            other = by_id.get(dep)
            st = other.get("status") if other else "missing"
            edges.append(f"- {task['id']} -> {dep} ({st})")
    lines.extend(edges or ["- (none)"])
    lines.append("")
    lines.append(f"## accepted ({len(accepted)})")
    lines.append(", ".join(sorted(t["id"] for t in accepted)) or "(none)")
    lines.append("")
    lines.append("## next steps")
    if in_flight:
        tid = sorted(in_flight, key=lambda t: t["id"])[0]["id"]
        lines.append(f"- continue claimed work: just sm-handoff {tid}")
        lines.append(f"- when done: just sm-finish {tid} && just sm-accept {tid}")
    elif ready:
        tid = sorted(ready, key=lambda t: t["id"])[0]["id"]
        lines.append(f"- claim next: just sm-claim {tid}")
        lines.append("- or: just sm-next")
    elif briefing:
        tid = sorted(briefing, key=lambda t: t["id"])[0]["id"]
        lines.append(f"- fill spec then: just sm-ready {tid}")
    elif stuck:
        lines.append(
            "- inspect stuck tasks; requeue with: just sm-reclaim --task <id> --force"
        )
    else:
        lines.append('- queue idle; just sm-add "…" or just sm-ticket "…"')
    lines.append("")
    lines.append("## recent events")
    if pointer.exists():
        for event in _read_events(store, limit=int(getattr(args, "events", 12) or 12)):
            lines.append(
                f"- {event.get('ts')} {event.get('type')} {event.get('task_id') or ''}"
            )
    else:
        lines.append("- (none)")

    body = "\n".join(lines) + "\n"
    print(body, end="")
    out = (getattr(args, "output", "") or "").strip()
    if out:
        dest = Path(out)
        if not dest.is_absolute():
            dest = store.root / dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body)
        print(f"wrote {dest}", file=__import__("sys").stderr)
    return 0


def cmd_task_note(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    project, task, state, in_run = _load_task_for_edit(store, args.task)
    note = append_task_note(task, args.text, by=args.by or "")
    _save_task_edit(store, project, task, state, in_run=in_run)
    store.emit("task_note", {"by": note["by"]}, args.task)
    print(args.task)
    print(f"{note['at']} {note['by']}: {note['text']}")
    return 0



def cmd_milestone_add(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    project = ensure_project_seeded(store)
    milestone_id = args.id.strip()
    if not milestone_id:
        raise SystemExit("milestone id required")
    name = (args.name or milestone_id).strip()
    project.setdefault("milestones", {})[milestone_id] = {
        "id": milestone_id,
        "name": name,
    }
    save_project_store(store, project)
    store.emit("milestone_added", {"id": milestone_id, "name": name})
    print(milestone_id)
    return 0


def cmd_milestone_list(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    project = ensure_project_seeded(store)
    rows = export_milestones(project)
    if not rows:
        print("no milestones")
        return 0
    for row in rows:
        print(f"{row['id']}\t{row['name']}")
    return 0


def _load_task_for_edit(
    store: Store, task_id: str
) -> tuple[dict, dict, dict | None, bool]:
    project = ensure_project_seeded(store)
    pointer = store.machine_dir / "current-run"
    state = store.load_state() if pointer.exists() else None
    task = (state or {}).get("tasks", {}).get(task_id) if state else None
    if task is None:
        task = (project.get("tasks") or {}).get(task_id)
        if task is None:
            raise SystemExit(f"unknown task {task_id}")
        return project, task, state, False
    return project, task, state, True


def _save_task_edit(
    store: Store,
    project: dict,
    task: dict,
    state: dict | None,
    *,
    in_run: bool,
) -> None:
    task_id = task["id"]
    if in_run and state is not None:
        state["tasks"][task_id] = task
        store.save_state(state)
    else:
        project["tasks"][task_id] = project_task_record(
            task, task.get("run_id") or "", previous=task
        )
        save_project_store(store, project)


def spec_file_for_task(store: Store, task: dict) -> tuple[Path | None, str | None]:
    """Resolve a task spec to a path under specs/. Refuse anything else."""
    rel = str(task.get("spec_path") or "").replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in Path(rel).parts:
        return None, f"{task['id']}: spec path refused"
    if not rel.startswith("specs/") or not rel.endswith(".md"):
        return None, f"{task['id']}: spec path must stay under specs/"
    path = (store.root / rel).resolve()
    specs = (store.root / "specs").resolve()
    try:
        path.relative_to(specs)
    except ValueError:
        return None, f"{task['id']}: spec path refused"
    return path, None


def write_task_spec(store: Store, task: dict, text: str) -> str | None:
    """Write a task spec. Returns an error note, or None when the file is written."""
    path, err = spec_file_for_task(store, task)
    if err or path is None:
        return err or f"{task['id']}: spec path refused"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return None


def read_task_spec(store: Store, task: dict) -> tuple[str, str, str | None]:
    """Read a task spec from specs/. Returns text, absolute path, and an error note."""
    path, err = spec_file_for_task(store, task)
    if err or path is None:
        return "", "", err or f"{task['id']}: spec path refused"
    if not path.is_file():
        return "", str(path), None
    try:
        return path.read_text(encoding="utf-8"), str(path), None
    except OSError as exc:
        return "", str(path), str(exc)


def apply_board_override_to_task(
    store: Store,
    project: dict,
    task: dict,
    patch: dict,
    *,
    allow_status: bool,
) -> list[str]:
    """Merge one board override patch into a task. Returns notes/warnings."""
    notes: list[str] = []
    if "title" in patch and patch["title"] is not None:
        title = str(patch["title"]).strip()
        if title:
            task["title"] = title
    if "description" in patch and patch["description"] is not None:
        task["description"] = str(patch["description"])
    if patch.get("priority"):
        task["priority"] = normalize_priority(str(patch["priority"]))
    if "milestone" in patch and patch["milestone"] is not None:
        milestone = str(patch["milestone"]).strip()
        require_milestone(project, milestone)
        task["milestone"] = milestone
    if patch.get("owner"):
        task["owner"] = str(patch["owner"]).strip()
    if "reason" in patch and patch["reason"] is not None:
        task["reason"] = str(patch["reason"])
    if patch.get("kind"):
        task["kind"] = normalize_kind(str(patch["kind"]))
    if "parent" in patch:
        parent = patch["parent"]
        task["parent"] = None if parent in (None, "") else str(parent)
    if "deps" in patch or "depends_on" in patch:
        deps = patch.get("depends_on", patch.get("deps")) or []
        if not isinstance(deps, list):
            raise SystemExit(f"{task['id']}: deps must be a list")
        task["depends_on"] = [str(item) for item in deps]
    if "labels" in patch and patch["labels"] is not None:
        task["labels"] = normalize_labels(patch["labels"])
    add_note = patch.get("note") or patch.get("add_note")
    if add_note:
        append_task_note(
            task,
            str(add_note),
            by=str(patch.get("note_by") or patch.get("by") or "board"),
        )
    if "retries" in patch and patch["retries"] is not None:
        task["repair_count"] = max(0, int(patch["retries"]))
    if "repair_count" in patch and patch["repair_count"] is not None:
        task["repair_count"] = max(0, int(patch["repair_count"]))
    claim = patch.get("claim")
    if isinstance(claim, dict):
        holder = (claim.get("holder") or "").strip()
        task["claimed_by"] = holder or None
        task["claim_lease"] = claim.get("lease") if holder else None
    elif "claimHolder" in patch or "claimLease" in patch:
        holder = str(patch.get("claimHolder") or "").strip()
        task["claimed_by"] = holder or None
        task["claim_lease"] = patch.get("claimLease") if holder else None
    # Status / board state — never accept/done from the board, and never
    # demote accepted / in-flight machine statuses via import.
    raw_state = patch.get("status") or patch.get("state")
    protected = {"accepted", "claimed", "active", "gated", "reviewed"}
    if raw_state and allow_status:
        text = str(raw_state).strip().lower()
        current = task.get("status")
        if current in protected:
            notes.append(
                f"{task['id']}: ignored state={text} "
                f"(status {current} stays with sm-claim/finish/accept)"
            )
        elif text in ("done", "accepted"):
            notes.append(
                f"{task['id']}: ignored state={text} "
                "(acceptance stays with sm-accept)"
            )
        elif text in BOARD_STATE_TO_STATUS:
            task["status"] = BOARD_STATE_TO_STATUS[text]
            if text == "claimed" and not task.get("claimed_by"):
                task["claimed_by"] = "board-override"
                task["claim_lease"] = task.get("claim_lease") or now_iso()
        elif text in TASK_STATUSES:
            if text == "accepted":
                notes.append(f"{task['id']}: ignored status=accepted")
            else:
                task["status"] = text
        else:
            notes.append(f"{task['id']}: unknown state {text}")
    # Evidence from the board is advisory only (reason already covered).
    evidence = patch.get("evidence")
    if isinstance(evidence, dict):
        bits = [
            f"{key}={evidence[key]}"
            for key in ("gate", "review", "acceptance")
            if evidence.get(key) and str(evidence.get(key)).strip().lower() not in ("", "none")
        ]
        if bits:
            note = "board evidence note: " + ", ".join(bits)
            existing = task.get("reason") or ""
            if note not in existing:
                task["reason"] = (existing + " · " + note).strip(" ·") if existing else note
            notes.append(f"{task['id']}: evidence not applied to gates ({note})")
    if "spec" in patch and isinstance(patch.get("spec"), str):
        spec_note = write_task_spec(store, task, patch["spec"])
        if spec_note:
            notes.append(spec_note)
        else:
            notes.append(f"{task['id']}: wrote {task.get('spec_path')}")
    task["board_overrides_at"] = now_iso()
    return notes


def cmd_task_update(args: argparse.Namespace) -> int:
    store = Store(repo_root())
    store.require_configured()
    project, task, state, in_run = _load_task_for_edit(store, args.task)
    if args.title:
        task["title"] = args.title
    if getattr(args, "description", None) is not None:
        task["description"] = args.description
    if args.priority:
        task["priority"] = normalize_priority(args.priority)
    if args.milestone is not None:
        require_milestone(project, args.milestone)
        task["milestone"] = args.milestone.strip()
    if args.owner:
        task["owner"] = args.owner.strip()
    if args.reason is not None:
        task["reason"] = args.reason
    if getattr(args, "kind", None):
        task["kind"] = normalize_kind(args.kind)
    if getattr(args, "parent", None) is not None:
        parent = args.parent.strip()
        task["parent"] = parent or None
    if getattr(args, "depends", None) is not None:
        task["depends_on"] = [d for d in args.depends if d]
    ensure_task_labels_notes(task)
    if getattr(args, "labels", None) is not None:
        task["labels"] = normalize_labels(args.labels)
    for label in getattr(args, "add_label", None) or []:
        task["labels"] = normalize_labels(list(task.get("labels") or []) + [label])
    for label in getattr(args, "remove_label", None) or []:
        drop = {str(label).strip().lower()}
        task["labels"] = [
            item for item in (task.get("labels") or [])
            if item.lower() not in drop
        ]
    _save_task_edit(store, project, task, state, in_run=in_run)
    store.emit(
        "task_updated",
        {
            "priority": task.get("priority"),
            "milestone": task.get("milestone"),
            "owner": task.get("owner"),
            "kind": task.get("kind"),
            "parent": task.get("parent"),
        },
        args.task,
    )
    print(args.task)
    return 0


def apply_board_settings(store: Store, settings: dict) -> list[str]:
    """Apply board machine settings into machine.yaml (comments preserved)."""
    if not isinstance(settings, dict) or not settings:
        return []
    notes: list[str] = []
    path = store.machine_dir / "machine.yaml"
    text = path.read_text()
    changed = False
    worktrees_value = None
    if "worktrees" in settings and settings["worktrees"] is not None:
        raw = settings["worktrees"]
        if isinstance(raw, str):
            worktrees_value = raw.strip().lower() in ("1", "true", "yes", "on")
        else:
            worktrees_value = bool(raw)
        text = set_yaml_scalar(text, "worktrees", worktrees_value)
        notes.append(f"settings.worktrees={worktrees_value}")
        changed = True
    if "parallel" in settings and settings["parallel"] is not None:
        try:
            parallel = int(settings["parallel"])
        except (TypeError, ValueError) as error:
            raise SystemExit(f"settings.parallel must be an int: {error}") from error
        if parallel < 1:
            raise SystemExit("settings.parallel must be >= 1")
        enabled = (
            worktrees_value
            if worktrees_value is not None
            else worktrees_enabled(store)
        )
        if not enabled and parallel > 1:
            notes.append(
                f"settings.parallel clamped {parallel}->1 (worktrees disabled)"
            )
            parallel = 1
        text = set_yaml_scalar(text, "parallel", parallel)
        notes.append(f"settings.parallel={parallel}")
        changed = True
    if changed:
        path.write_text(text)
        store.emit("board_settings_applied", {"keys": sorted(settings.keys())})
    return notes


def cmd_overrides_import(args: argparse.Namespace) -> int:
    """Apply board override JSON into the durable project store / current run."""
    store = Store(repo_root())
    store.require_configured()
    ensure_gitignore(store.root)
    path = Path(args.file)
    if not path.is_absolute():
        path = store.root / path
    payload = json.loads(path.read_text())
    overrides = payload.get("overrides")
    settings = payload.get("settings")
    if settings:
        # Settings-only downloads are valid.
        pass
    elif not isinstance(overrides, dict) or not overrides:
        raise SystemExit(
            "overrides file needs a non-empty overrides object and/or settings"
        )
    notes: list[str] = []
    if settings:
        notes.extend(apply_board_settings(store, settings))
    if not isinstance(overrides, dict):
        overrides = {}
    project = ensure_project_seeded(store)
    pointer = store.machine_dir / "current-run"
    state = store.load_state() if pointer.exists() else None
    applied = 0
    touched_run = False
    project_only: dict[str, dict] = {}
    for task_id, patch in overrides.items():
        if not isinstance(patch, dict):
            raise SystemExit(f"override for {task_id} must be an object")
        task = None
        in_run = False
        if state and task_id in state.get("tasks", {}):
            task = state["tasks"][task_id]
            in_run = True
            touched_run = True
        elif task_id in (project.get("tasks") or {}):
            task = project["tasks"][task_id]
        if task is None:
            raise SystemExit(f"unknown task {task_id}")
        notes.extend(
            apply_board_override_to_task(
                store,
                project,
                task,
                patch,
                allow_status=not args.pm_only,
            )
        )
        if in_run and state is not None:
            state["tasks"][task_id] = task
        else:
            project_only[task_id] = project_task_record(
                task, task.get("run_id") or "", previous=task
            )
        applied += 1
        store.emit("board_override_applied", {"keys": sorted(patch.keys())}, task_id)
    if touched_run and state is not None:
        store.save_state(state)
        project = load_project_store(store)
    for task_id, record in project_only.items():
        project["tasks"][task_id] = record
    if project_only or not touched_run:
        save_project_store(store, project)
    audit = {
        "schema_version": OVERRIDES_SCHEMA,
        "imported_at": now_iso(),
        "source": str(path),
        "overrides": overrides,
    }
    atomic_write_json(store.machine_dir / "board-overrides.json", audit)
    if applied:
        print(f"applied {applied}")
    elif settings:
        print("applied settings")
    for note in notes:
        print(f"note: {note}")
    return 0


def cmd_overrides_export(args: argparse.Namespace) -> int:
    """Write current PM/detail fields as a board-overrides JSON skeleton."""
    store = Store(repo_root())
    store.require_configured()
    project = ensure_project_seeded(store)
    pointer = store.machine_dir / "current-run"
    if pointer.exists():
        sync_project_from_state(store, store.load_state())
        project = load_project_store(store)
    overrides = {}
    for task in project.get("tasks", {}).values():
        overrides[task["id"]] = {
            "title": task.get("title", ""),
            "description": task.get("description") or "",
            "kind": task.get("kind") or "task",
            "parent": task.get("parent"),
            "state": BOARD_STATUS.get(str(task.get("status")), task.get("status")),
            "priority": task.get("priority") or "P2",
            "milestone": task.get("milestone") or "",
            "owner": task.get("owner") or "unassigned",
            "labels": list(task.get("labels") or []),
            "deps": list(task.get("depends_on") or []),
            "retries": int(task.get("repair_count") or 0),
            "reason": task.get("reason") or "",
            "claim": (
                {
                    "holder": task.get("claimed_by"),
                    "lease": task.get("claim_lease"),
                }
                if task.get("claimed_by")
                else None
            ),
        }
    defaults = resolve_defaults(store)
    payload = {
        "schema_version": OVERRIDES_SCHEMA,
        "project": store.root.name,
        "exported_at": now_iso(),
        "settings": {
            "worktrees": bool(defaults.get("worktrees")),
            "parallel": int(defaults.get("parallel") or 1),
        },
        "overrides": overrides,
    }
    dest = (
        Path(args.output)
        if args.output
        else store.machine_dir / "board-overrides.json"
    )
    if not dest.is_absolute():
        dest = store.root / dest
    atomic_write_json(dest, payload)
    print(dest)
    print(f"overrides {len(overrides)} schema {OVERRIDES_SCHEMA}")
    return 0


def write_export_payload(store: Store, dest: Path | None = None) -> tuple[Path, dict]:
    ensure_gitignore(store.root)
    project = ensure_project_seeded(store)
    run_id = None
    pointer = store.machine_dir / "current-run"
    if pointer.exists():
        state = store.load_state()
        run_id = state["run_id"]
        sync_project_from_state(store, state)
        project = load_project_store(store)
    by_id = dict(project.get("tasks") or {})
    rows = [
        export_task_row(store, task, by_id=by_id)
        for task in by_id.values()
    ]
    rows.sort(key=lambda row: row["id"])
    for row in rows:
        if row["evidence"]["acceptance"] == "accepted" and row["status"] != "accepted":
            raise SystemExit(
                f"export refused: {row['id']} evidence.acceptance=accepted "
                f"but status={row['status']}"
            )
    milestones = export_milestones(project)
    defaults = resolve_defaults(store)
    payload = {
        "schema_version": EXPORT_SCHEMA,
        "project": store.root.name,
        "exported_at": now_iso(),
        "now": now_iso(),
        "run_id": run_id,
        "task_count": len(rows),
        "milestones": milestones,
        "tasks": rows,
        "settings": {
            "worktrees": bool(defaults.get("worktrees")),
            "parallel": int(defaults.get("parallel") or 1),
        },
    }
    out = dest or (store.machine_dir / "export.json")
    if not out.is_absolute():
        out = store.root / out
    atomic_write_json(out, payload)
    return out, payload


def cmd_export(args: argparse.Namespace) -> int:
    """Write a JSON snapshot of the durable project task store."""
    store = Store(repo_root())
    store.require_configured()
    dest = Path(args.output) if args.output else None
    path, payload = write_export_payload(store, dest)
    print(path)
    print(
        f"tasks {payload['task_count']} milestones {len(payload['milestones'])} "
        f"schema {EXPORT_SCHEMA}"
    )
    return 0


def board_launch_env() -> dict[str, str]:
    """PATH for board_command. Homebrew node is often installed but not linked onto PATH."""
    env = os.environ.copy()
    prepend: list[str] = []
    for candidate in ("/opt/homebrew/opt/node/bin", "/usr/local/opt/node/bin"):
        if (Path(candidate) / "npm").is_file():
            prepend.append(candidate)
    if prepend:
        env["PATH"] = os.pathsep.join([*prepend, env.get("PATH", "")])
    return env


def project_tracker_binary() -> Optional[Path]:
    """Shipped project tracker. Opening the board must not compile."""
    macos = SKILL_ROOT / "project tracker" / "Markable-Project.app" / "Contents" / "MacOS"
    if not macos.is_dir():
        return None
    for name in ("markable", "Markable-Project"):
        path = macos / name
        if path.is_file() and os.access(path, os.X_OK):
            return path
    for path in macos.iterdir():
        if path.is_file() and os.access(path, os.X_OK) and path.suffix != ".dylib":
            return path
    return None


def project_tracker_app() -> Optional[Path]:
    """The Markable-Project bundle shipped with the machine."""
    binary = project_tracker_binary()
    if binary is None:
        return None
    app = binary.parents[2]
    if app.suffix == ".app" and app.is_dir():
        return app
    return None


def open_project_tracker(app: Path, folder: Path) -> None:
    """Open this bundle by path so a test Markable does not take the launch."""
    subprocess.Popen(
        ["open", "-n", str(app), "--args", str(folder)],
        start_new_session=True,
    )


def claim_held(task: dict) -> bool:
    """True when the machine already claimed this task, not merely the lane."""
    return (
        task.get("status") == "claimed"
        and bool(task.get("claimed_by"))
        and bool(task.get("claim_lease"))
    )


def board_lane_action(lane: str, task: dict, *, spec_ready: bool = False) -> str | None:
    """Machine action for a card sitting in a lane, or None when the ticket already matches."""
    key = lane.strip().lower()
    status = str(task.get("status") or "")
    if key == "ready":
        if status == "briefing":
            return "ready" if spec_ready else None
        if status in ("claimed", "active", "gated", "reviewed", "blocked", "failed"):
            return "reclaim"
        return None
    if key == "claimed":
        return None if claim_held(task) else "claim"
    if key == "running":
        return None if status == "active" else "running"
    if key == "review":
        return None if status in ("gated", "reviewed") else "finish"
    if key == "done":
        return None if status == "accepted" else "accept"
    if key == "blocked":
        return None if status == "blocked" else "block"
    if key == "failed":
        return None if status == "failed" else "fail"
    return None


def load_state_disk(store: Store) -> dict:
    """Run state as saved. Notes are not copied on top."""
    path = store.state_path()
    if not path.exists():
        raise SystemExit("run state missing")
    return json.loads(path.read_text())


def apply_note_fields(task: dict, meta: dict[str, str]) -> bool:
    """Copy the card's editable info onto the ticket. Returns whether anything changed."""
    changed = False
    title = meta.get("title", "").strip()
    if title and title != str(task.get("title") or ""):
        task["title"] = title
        changed = True
    priority = meta.get("priority", "").strip()
    if priority in PRIORITIES and priority != str(task.get("priority") or ""):
        task["priority"] = priority
        changed = True
    if "assignee" in meta:
        owner = meta.get("assignee", "").strip() or "unassigned"
        if owner != str(task.get("owner") or ""):
            task["owner"] = owner
            changed = True
    if "tags" in meta:
        labels = [part.strip() for part in meta.get("tags", "").split(",") if part.strip()]
        if labels != list(task.get("labels") or []):
            task["labels"] = labels
            changed = True
    if "blocked-by" in meta:
        deps = [
            part.strip()
            for part in meta.get("blocked-by", "").split(",")
            if part.strip().startswith("t-")
        ]
        if deps != list(task.get("depends_on") or []):
            task["depends_on"] = deps
            changed = True
    return changed


def run_board_action(store: Store, task_id: str, action: str) -> int:
    """Do what the card asks. The ticket, not the typed command, is the result."""
    agent = os.environ.get("USER") or "board"
    if action == "ready":
        return cmd_task_ready(argparse.Namespace(task_id=task_id))
    if action == "claim":
        return _claim(store, load_state_disk(store), task_id, agent, force=False)
    if action == "reclaim":
        state = load_state_disk(store)
        task = state["tasks"][task_id]
        if task.get("status") == "claimed":
            release_claim(task, "Returned to Ready from the board.", store=store)
        else:
            task["status"] = "queued"
            task["claimed_by"] = None
            task["claim_lease"] = None
            task["phase"] = "reclaimed"
        task["reason"] = ""
        store.save_state(state)
        return 0
    if action == "running":
        state = load_state_disk(store)
        task = state["tasks"][task_id]
        if not claim_held(task):
            _claim(store, state, task_id, agent, force=False)
            state = load_state_disk(store)
            task = state["tasks"][task_id]
        task["status"] = "active"
        task["phase"] = "work"
        task["reason"] = ""
        refresh_claim_lease(task)
        store.save_state(state)
        return 0
    if action == "finish":
        return cmd_finish(argparse.Namespace(task=task_id, kind="fast"))
    if action == "accept":
        return cmd_accept(argparse.Namespace(task=task_id))
    if action in ("block", "fail"):
        state = load_state_disk(store)
        task = state["tasks"][task_id]
        task["status"] = "blocked" if action == "block" else "failed"
        task["reason"] = ""
        store.save_state(state)
        return 0
    raise SystemExit(f"unknown board action {action}")


def remember_board_failure(store: Store, task_id: str, meta: dict[str, str], message: str) -> None:
    """Keep the ticket where it really is, and leave the reason on the card."""
    state = load_state_disk(store)
    task = (state.get("tasks") or {}).get(task_id)
    if task is None:
        return
    apply_note_fields(task, meta)
    task["reason"] = one_line(message) or "The board could not update this ticket."
    store.save_state(state)


def adopt_board_cards(store: Store) -> list[str]:
    """A new card in the specs folder becomes a ticket."""
    folder = board_dir(store)
    if not folder.is_dir():
        return []
    messages: list[str] = []
    for path in sorted(folder.glob("*.md")):
        if path.name == "board.md" or path.stem.startswith("t-"):
            continue
        try:
            meta, _body = split_note(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if meta.get("kanban") == "board" or "status" not in meta:
            continue
        if meta.get("parent", "").strip():
            continue
        title = meta.get("title", "").strip() or path.stem
        priority = meta.get("priority", "").strip()
        args = argparse.Namespace(
            title=title,
            writes=[],
            done="",
            priority=priority if priority in PRIORITIES else "P2",
            milestone="",
            owner=meta.get("assignee", "").strip(),
            description="",
            kind="task",
            parent="",
            depends=[],
            labels=[part.strip() for part in meta.get("tags", "").split(",") if part.strip()],
            problem="",
        )
        task = create_task(store, args, status="briefing", spec_mode="template")
        lane = meta.get("status", "").strip()
        if lane and lane.lower() != "ready":
            note = task_spec_path(store, task)
            text = note.read_text(encoding="utf-8")
            text = re.sub(r"(?m)^status:.*$", f"status: {lane}", text, count=1)
            note.write_text(text, encoding="utf-8")
        path.unlink()
        messages.append(f"ticket {task['id']} {title}")
    return messages


AGENT_SETTLED = {"gated", "reviewed", "accepted", "failed", "blocked"}


def agent_pieces(writes: list[str]) -> list[list[str]]:
    """One agent per file. A directory, or a mix of directories, stays one agent."""
    cleaned = [str(item).strip() for item in writes if str(item).strip()]
    if len(cleaned) <= 1 or any(item.endswith("/") for item in cleaned):
        return [cleaned]
    return [[item] for item in cleaned]


def ticket_agent_step(task: dict, *, alive: bool, was_working: bool) -> str:
    """start, promote, ended, clear, hold, or none."""
    status = str(task.get("status") or "")
    pid = str(task.get("agent_pid") or "").strip()
    if pid and alive:
        return "promote" if status == "claimed" else "none"
    if was_working or pid:
        return "clear" if status in AGENT_SETTLED else "ended"
    if task.get("agent_stopped"):
        return "hold"
    if status in ("claimed", "active"):
        return "start"
    return "none"


def agent_prompt(
    task: dict,
    piece: list[str],
    spec_text: str,
    park_path: Path | None = None,
) -> str:
    paths = ", ".join(piece) if piece else "the paths named in the spec"
    bail = ""
    if park_path is not None:
        bail = (
            "\nIf the card cannot be carried out, do not invent the product. "
            f"Write {park_path} as "
            '{"lane": "ready", "reason": "one line"} or '
            '{"lane": "blocked", "reason": "one question"} and exit. '
            "Use ready after you put decent direction in the spec. "
            "Use blocked when you need an answer.\n"
        )
    return (
        f"Implement ticket {task.get('id')} in this checkout.\n\n"
        f"{spec_text.strip()}\n\n"
        f"Edit only these paths: {paths}\n"
        "Do not commit. Do not run sm-finish or sm-accept. "
        "Exit when this piece is implemented.\n"
        f"{bail}"
    )


def direction_result(spec_ok: bool, park: dict | None) -> tuple[str, str]:
    """Where a card goes after the agent asks or fills direction."""
    if park:
        lane = str(park.get("lane") or "").strip().lower()
        if lane not in ("ready", "blocked"):
            lane = "blocked"
        reason = one_line(str(park.get("reason") or ""))
        if not reason:
            reason = "Direction is on the card." if lane == "ready" else "The card needs a decision."
        return lane, reason
    if spec_ok:
        return "ready", "Direction is on the card."
    return "blocked", "The card needs a decision."


def read_park(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def clarify_prompt(task: dict, spec_path: Path, park_path: Path, spec_text: str) -> str:
    return (
        f"The card {task.get('id')} does not have enough direction to build yet.\n\n"
        f"The spec file is {spec_path}.\n\n"
        f"{spec_text.strip()}\n\n"
        "If you can write decent direction from what is already there, fill "
        "Problem, In scope, Out of scope, UX / behavior, and Tests in that file. "
        "Do not leave a placeholder. Do not implement the product. Do not commit.\n"
        "If you cannot carry it out without an answer, do not invent the answer. "
        f"Write {park_path} as "
        '{"lane": "blocked", "reason": "<one question>"}.\n'
        "If you filled the direction and it should be reviewed before anyone builds, "
        f"write {park_path} as "
        '{"lane": "ready", "reason": "<one line saying what you decided>"}.\n'
        "lane is ready or blocked. Then exit.\n"
    )


def adopt_clearer_spec(store: "Store", task: dict, checkout: Path) -> None:
    """Keep a filled spec that the agent wrote in its work folder."""
    main_path = task_spec_path(store, task)
    if not main_path.is_file():
        return
    try:
        other = checkout / main_path.relative_to(store.root)
    except ValueError:
        return
    if not other.is_file() or other.resolve() == main_path.resolve():
        return
    if spec_complete(main_path)[0] or not spec_complete(other)[0]:
        return
    _existing, body = split_note(other.read_text(encoding="utf-8"))
    existing, _old = split_note(main_path.read_text(encoding="utf-8"))
    main_path.write_text(compose_note(existing, body), encoding="utf-8")


def park_ticket(store: "Store", task_id: str, lane: str, reason: str) -> None:
    """Stop the agent and leave the card on Ready or Blocked."""
    state = store.load_state()
    task = (state.get("tasks") or {}).get(task_id)
    if task is None:
        return
    chosen, text = direction_result(False, {"lane": lane, "reason": reason})
    if task.get("phase") == "clarify":
        remove_task_worktree(store, task, force=True)
    task["status"] = "queued" if chosen == "ready" else "blocked"
    task["claimed_by"] = None
    task["claim_lease"] = None
    task["agent_stopped"] = True
    task["phase"] = f"parked:{chosen}"
    task.pop("agent_pid", None)
    task["reason"] = text
    store.save_state(state)


def run_clarify(store: "Store", task: dict, checkout: Path) -> tuple[int, str]:
    spec_path = task_spec_path(store, task)
    logs = store.task_dir(task["id"]) / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    park_path = logs / "agent-park.json"
    prompt_path = logs / "agent-clarify.prompt"
    spec_text = spec_path.read_text(encoding="utf-8") if spec_path.is_file() else ""
    prompt_path.write_text(
        clarify_prompt(task, spec_path, park_path, spec_text),
        encoding="utf-8",
    )
    return run_commands(
        [agent_worker_command(prompt_path)],
        parallel=1,
        cwd=checkout,
        log=logs / "agent.log",
    )


def park_if_requested(store: "Store", task_id: str) -> bool:
    state = store.load_state()
    task = state["tasks"][task_id]
    checkout = task_checkout_root(store, task)
    adopt_clearer_spec(store, task, checkout)
    park = read_park(store.task_dir(task_id) / "logs" / "agent-park.json")
    if not park:
        return False
    lane, reason = direction_result(spec_complete(task_spec_path(store, task))[0], park)
    park_ticket(store, task_id, lane, reason)
    return True


def clarify_and_park(store: "Store", task: dict, checkout: Path) -> int:
    task_id = str(task["id"])
    try:
        code, detail = run_clarify(store, task, checkout)
    except SystemExit as exc:
        park_ticket(store, task_id, "blocked", str(exc) or "The card needs a decision.")
        return 0
    adopt_clearer_spec(store, task, checkout)
    park = read_park(store.task_dir(task_id) / "logs" / "agent-park.json")
    spec_ok = spec_complete(task_spec_path(store, task))[0]
    if code != 0 and not park and not spec_ok:
        park_ticket(store, task_id, "blocked", detail or "The card needs a decision.")
        return 0
    lane, reason = direction_result(spec_ok, park)
    park_ticket(store, task_id, lane, reason)
    return 0


def cursor_sdk_home() -> Path:
    return Path.home() / ".dm-software-machine" / "cursor-sdk"


def ensure_cursor_sdk() -> Path:
    """Install the Cursor agent runner once, next to a copy of agent_work.mjs."""
    home = cursor_sdk_home()
    source = Path(__file__).resolve().parent / "agent_work.mjs"
    if not source.is_file():
        raise SystemExit("agent_work.mjs is missing, so the agent could not start.")
    marker = home / "node_modules" / "@cursor" / "sdk" / "package.json"
    env = board_launch_env()
    if not marker.is_file():
        home.mkdir(parents=True, exist_ok=True)
        npm = shutil.which("npm", path=env.get("PATH")) or "npm"
        completed = subprocess.run(
            [npm, "install", "--prefix", str(home), "@cursor/sdk"],
            env=env,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise SystemExit(detail or "Could not install the Cursor agent runner.")
    script = home / "agent_work.mjs"
    script.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    return script


def agent_worker_command(prompt_path: Path) -> list[str]:
    custom = os.environ.get("DMSM_AGENT_CMD", "").strip()
    if custom:
        return [*shlex.split(custom), str(prompt_path)]
    env = board_launch_env()
    node = shutil.which("node", path=env.get("PATH"))
    if not node:
        raise SystemExit("node is not on PATH, so the agent could not start.")
    return [node, str(ensure_cursor_sdk()), str(prompt_path)]


def log_tail(path: Path, limit: int = 240) -> str:
    if not path.is_file():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    return one_line(text[-limit:])


def run_commands(
    commands: list[list[str]],
    *,
    parallel: int,
    cwd: Path,
    log: Path,
) -> tuple[int, str]:
    """Run agent commands, at most `parallel` at a time. Returns the first failure."""
    log.parent.mkdir(parents=True, exist_ok=True)
    width = max(1, parallel)
    with log.open("a", encoding="utf-8") as handle:
        for start in range(0, len(commands), width):
            procs = [
                subprocess.Popen(
                    argv,
                    cwd=cwd,
                    stdout=handle,
                    stderr=subprocess.STDOUT,
                    env=board_launch_env(),
                )
                for argv in commands[start : start + width]
            ]
            codes = [proc.wait() for proc in procs]
            failed = next((code for code in codes if code != 0), 0)
            if failed:
                return failed, log_tail(log) or f"The agent stopped ({failed})."
    return 0, ""


def run_ticket_workers(store: "Store", task: dict, checkout: Path) -> tuple[int, str]:
    writes = [str(item) for item in (task.get("writes") or [])]
    pieces = agent_pieces(writes)
    parallel = max(1, int(store.cfg.get("parallel") or 1))
    spec_path = task_spec_path(store, task)
    spec_text = (
        spec_path.read_text(encoding="utf-8")
        if spec_path.is_file()
        else str(task.get("title") or "")
    )
    commands: list[list[str]] = []
    logs = store.task_dir(task["id"]) / "logs"
    for index, piece in enumerate(pieces):
        prompt_path = logs / f"agent-{index}.prompt"
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(
            agent_prompt(task, piece, spec_text, logs / "agent-park.json"),
            encoding="utf-8",
        )
        commands.append(agent_worker_command(prompt_path))
    return run_commands(commands, parallel=parallel, cwd=checkout, log=logs / "agent.log")


def mark_agent_failed(store: "Store", task_id: str, message: str) -> None:
    state = store.load_state()
    task = state["tasks"].get(task_id)
    if task is None:
        return
    if task.get("status") not in ("accepted", "failed"):
        task["status"] = "failed"
    task["agent_stopped"] = True
    task["reason"] = one_line(message) or "The agent stopped."
    store.save_state(state)


def waits_for_a_person(spec_text: str) -> bool:
    """Review stays with a person unless the spec says otherwise."""
    return "move to done without a person" not in spec_text.lower()


def cmd_agent_run(args: argparse.Namespace) -> int:
    """Work the ticket, then leave Review for a person unless the spec says otherwise."""
    store = Store(repo_root())
    store.require_configured()
    task_id = args.task
    state = store.load_state()
    task = (state.get("tasks") or {}).get(task_id)
    if task is None:
        raise SystemExit(f"unknown task {task_id}")
    checkout = task_checkout_root(store, task)
    spec_path = task_spec_path(store, task)
    if task.get("phase") == "clarify" or not spec_complete(spec_path)[0]:
        return clarify_and_park(store, task, checkout)
    attempts = int(task.get("max_repairs") or 2) + 1
    worked = False
    detail = "The agent stopped."
    for _ in range(attempts):
        try:
            code, detail = run_ticket_workers(store, task, checkout)
        except SystemExit as exc:
            mark_agent_failed(store, task_id, str(exc) or "The agent could not start.")
            return 1
        if code == 0:
            if park_if_requested(store, task_id):
                return 0
            worked = True
            break
    if not worked:
        mark_agent_failed(store, task_id, detail or "The agent stopped.")
        return 1
    finish_rc = 1
    for _ in range(attempts):
        try:
            finish_rc = cmd_finish(argparse.Namespace(task=task_id, kind="fast"))
        except SystemExit as exc:
            mark_agent_failed(store, task_id, str(exc) or "The agent stopped.")
            return 1
        if finish_rc == 0:
            break
        state = store.load_state()
        task = state["tasks"][task_id]
        if task.get("status") == "failed":
            return finish_rc
        try:
            code, detail = run_ticket_workers(store, task, checkout)
        except SystemExit as exc:
            mark_agent_failed(store, task_id, str(exc) or "The agent stopped.")
            return 1
        if code != 0:
            mark_agent_failed(store, task_id, detail or "The agent stopped.")
            return code
    if finish_rc != 0:
        return finish_rc
    spec_now = spec_path.read_text(encoding="utf-8") if spec_path.is_file() else ""
    if waits_for_a_person(spec_now):
        state = store.load_state()
        task = state["tasks"][task_id]
        task["agent_stopped"] = True
        task["reason"] = "Ready for a person to review."
        store.save_state(state)
        print(f"{task_id} is in Review for a person")
        return 0
    try:
        return cmd_accept(argparse.Namespace(task=task_id))
    except SystemExit as exc:
        message = one_line(str(exc)) or "Accept failed."
        state = store.load_state()
        task = state["tasks"][task_id]
        task["reason"] = message
        store.save_state(state)
        return 1


def spawn_ticket_agent(store: "Store", task_id: str) -> int:
    script = str(Path(__file__).resolve())
    uv = shutil.which("uv")
    argv = [uv, "run", script, "agent-run", "--task", task_id] if uv else [
        sys.executable,
        script,
        "agent-run",
        "--task",
        task_id,
    ]
    log = store.task_dir(task_id) / "logs" / "agent-run.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        argv,
        cwd=store.root,
        start_new_session=True,
        stdout=log.open("a"),
        stderr=subprocess.STDOUT,
        env=board_launch_env(),
    )
    return proc.pid


def advance_ticket_agent(store: "Store", task: dict, meta: dict[str, str]) -> str | None:
    """Start the agent, move a live one to Running, or clear a dead one."""
    if os.environ.get("DMSM_AGENTS", "").strip().lower() == "off":
        return None
    task_id = str(task.get("id") or "")
    was_working = str(meta.get("working") or "").strip().lower() in ("yes", "true", "1", "on")
    pid = str(task.get("agent_pid") or "").strip()
    alive = bool(pid) and pid_alive(pid)
    step = ticket_agent_step(task, alive=alive, was_working=was_working)
    if step == "promote":
        task["status"] = "active"
        task["phase"] = "work"
        task["reason"] = ""
        return f"{task_id} running"
    if step == "clear":
        task.pop("agent_pid", None)
        return f"{task_id} live agent ended"
    if step == "ended":
        task.pop("agent_pid", None)
        task["agent_stopped"] = True
        if not str(task.get("reason") or "").strip():
            task["reason"] = "The agent stopped."
        return f"{task_id} live agent ended"
    if step != "start":
        return None
    try:
        new_pid = spawn_ticket_agent(store, task_id)
    except OSError as exc:
        task["agent_stopped"] = True
        task["reason"] = one_line(f"The agent could not start. {exc}")
        return f"{task_id} agent could not start"
    task["agent_pid"] = str(new_pid)
    task["agent_stopped"] = False
    if pid_alive(str(new_pid)):
        task["status"] = "active"
        task["phase"] = "work"
        task["reason"] = ""
        return f"{task_id} running"
    task["agent_stopped"] = True
    task["reason"] = "The agent stopped."
    return f"{task_id} live agent ended"


def sync_board(store: Store) -> list[str]:
    """Make every card agree with its ticket, and carry a lane change through."""
    messages = adopt_board_cards(store)
    state = load_state_disk(store)
    dropped = drop_missing_notes(store, state)
    if dropped:
        store.save_state(state)
        messages.extend(dropped)
    folder = board_dir(store)
    if not folder.is_dir():
        return messages
    for path in sorted(folder.glob("t-*.md")):
        try:
            meta, _body = split_note(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        task_id = path.stem
        state = load_state_disk(store)
        task = (state.get("tasks") or {}).get(task_id)
        if task is None:
            continue
        task["id"] = task_id
        if not str(task.get("agent_pid") or "").strip() and meta.get("agent"):
            task["agent_pid"] = meta["agent"]
        action = board_lane_action(
            meta.get("status", ""),
            task,
            spec_ready=spec_complete(path)[0],
        )
        if action:
            try:
                rc = run_board_action(store, task_id, action)
            except SystemExit as exc:
                message = str(exc).strip() or f"{task_id} could not move"
                remember_board_failure(store, task_id, meta, message)
                messages.append(message)
                continue
            if rc:
                messages.append(f"{action} {task_id} failed")
                continue
            state = load_state_disk(store)
            task = state["tasks"][task_id]
            task["id"] = task_id
            previous = one_line(str(task.get("reason") or meta.get("reason") or ""))
            task["reason"] = previous if action == "reclaim" else ""
            if action in ("claim", "running"):
                task["agent_stopped"] = False
                held = str(task.get("agent_pid") or meta.get("agent") or "").strip()
                if held and pid_alive(held):
                    task["agent_pid"] = held
                else:
                    task.pop("agent_pid", None)
            apply_note_fields(task, meta)
            agent_message = advance_ticket_agent(store, task, meta)
            store.save_state(state)
            messages.append(f"{action} {task_id}")
            if agent_message:
                messages.append(agent_message)
            continue
        agent_message = advance_ticket_agent(store, task, meta)
        if agent_message:
            store.save_state(state)
            messages.append(agent_message)
            continue
        if apply_note_fields(task, meta):
            store.save_state(state)
            messages.append(f"updated {task_id}")
    return messages


def board_watch_paths(store: Store) -> tuple[Path, Path]:
    runtime = store.machine_dir / "runs"
    runtime.mkdir(parents=True, exist_ok=True)
    return runtime / "board-watch.pid", runtime / "board-watch.log"


def board_watch_alive(store: Store) -> bool:
    pidfile, _log = board_watch_paths(store)
    if not pidfile.is_file():
        return False
    try:
        pid = int(pidfile.read_text().strip())
        os.kill(pid, 0)
    except (OSError, ValueError):
        return False
    return True


def start_board_watch(store: Store) -> None:
    """Keep the tickets caught up with the board."""
    if board_watch_alive(store):
        print("The board is already updating the tickets.")
        return
    pidfile, log = board_watch_paths(store)
    script = str(Path(__file__).resolve())
    uv = shutil.which("uv")
    argv = [uv, "run", script, "board-watch"] if uv else [sys.executable, script, "board-watch"]
    subprocess.Popen(
        argv,
        cwd=store.root,
        start_new_session=True,
        stdout=log.open("a"),
        stderr=subprocess.STDOUT,
    )
    print("The board updates the tickets.")


def cmd_board_watch(args: argparse.Namespace) -> int:
    """Update tickets from the board. Stays running unless --once."""
    store = Store(repo_root())
    store.require_configured()
    pidfile, _log = board_watch_paths(store)
    if not args.once:
        pidfile.write_text(str(os.getpid()))
    seen: dict[str, str] = {}
    try:
        while True:
            for message in sync_board(store):
                key = message.splitlines()[0] if message else ""
                if seen.get(key) == message:
                    continue
                seen[key] = message
                print(message, flush=True)
            if args.once:
                return 0
            time.sleep(1)
    finally:
        if not args.once and pidfile.is_file() and pidfile.read_text().strip() == str(os.getpid()):
            pidfile.unlink()


def cmd_board(args: argparse.Namespace) -> int:
    """Open the specs folder in the shipped Markable-Project. The notes are the board."""
    store = Store(repo_root())
    store.require_configured()
    state = ensure_run(store)
    ensure_board_file(store)
    write_notes_from_state(store, state)
    store.save_state(state)
    folder = board_dir(store)
    print(folder)
    start_board_watch(store)
    if getattr(args, "serve", False):
        print("The board is this folder of notes. There is no board server.")
    app = project_tracker_app()
    if app is not None:
        print(app)
        open_project_tracker(app, folder)
        return 0
    command = str(store.cfg.get("board_command") or "").strip()
    if not command:
        print(
            "The project tracker is not in dm-software-machine/project tracker. "
            "Build it once with npm run bundle:project and copy the .app there. "
            "Replace that .app when the project tracker itself changes."
        )
        return 0
    argv = [*shlex.split(command), str(folder)]
    env = board_launch_env()
    if shutil.which(argv[0], path=env.get("PATH")) is None:
        print(f"board_command could not find {argv[0]!r} on PATH.", file=sys.stderr)
        return 1
    subprocess.Popen(
        argv,
        cwd=store.root,
        env=env,
        start_new_session=True,
    )
    return 0


def serve_board(store: Store, board_path: Path, port: int) -> int:
    """Serve the board. Tasks come from project-tasks.json; specs come from specs/."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import parse_qs, urlparse

    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self) -> None:
            self._cors(204)

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            if path in ("/", "/board.html"):
                data = board_path.read_bytes()
                self._bytes(200, "text/html; charset=utf-8", data)
                return
            if path == "/project-tasks.json":
                file = store.machine_dir / "project-tasks.json"
                if not file.is_file():
                    self.send_error(404)
                    return
                self._bytes(200, "application/json", file.read_bytes())
                return
            if path == "/spec":
                task_id = (parse_qs(parsed.query).get("id") or [""])[0]
                task = _task_for_spec_write(store, task_id)
                if task is None:
                    self._json(404, {"error": f"unknown task {task_id}"})
                    return
                text, spec_file, err = read_task_spec(store, task)
                if err:
                    self._json(400, {"error": err})
                    return
                self._json(200, {
                    "ok": True,
                    "spec": text,
                    "spec_path": task.get("spec_path") or "",
                    "spec_file": spec_file,
                })
                return
            self.send_error(404)

        def do_POST(self) -> None:
            if self.path.split("?", 1)[0] != "/spec":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > 2_000_000:
                self._json(413, {"error": "spec too large"})
                return
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except json.JSONDecodeError:
                self._json(400, {"error": "invalid json"})
                return
            task_id = str(body.get("id") or "")
            spec = body.get("spec")
            if not isinstance(spec, str):
                self._json(400, {"error": "spec must be a string"})
                return
            task = _task_for_spec_write(store, task_id)
            if task is None:
                self._json(404, {"error": f"unknown task {task_id}"})
                return
            note = write_task_spec(store, task, spec)
            if note:
                self._json(400, {"error": note})
                return
            self._json(200, {"ok": True, "spec_path": task.get("spec_path")})

        def _cors(self, code: int) -> None:
            self.send_response(code)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def _bytes(self, code: int, content_type: str, data: bytes) -> None:
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _json(self, code: int, payload: dict) -> None:
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt: str, *args: object) -> None:
            return

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        raise SystemExit(f"board serve failed on 127.0.0.1:{port}: {exc}") from exc
    print(f"http://127.0.0.1:{server.server_address[1]}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


def _task_for_spec_write(store: Store, task_id: str) -> dict | None:
    pointer = store.machine_dir / "current-run"
    if pointer.exists():
        state = store.load_state()
        task = (state.get("tasks") or {}).get(task_id)
        if task is not None:
            return task
    project = load_project_store(store)
    return (project.get("tasks") or {}).get(task_id)


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
    init.add_argument(
        "--upgrade",
        action="store_true",
        help="refresh vendored package, skill/docs/permissions, just recipes; keep machine.yaml layout",
    )
    init.add_argument(
        "--scaffold",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="scaffold the profile app folder (off by default; safe for existing repos)",
    )
    init.add_argument("--ask", action="store_true", help="ask layout questions after stamp")
    init.add_argument(
        "--accept-defaults",
        action="store_true",
        help="fill app_folder/writes from the profile without asking",
    )
    init.add_argument(
        "--tracker",
        default="",
        choices=("", "none"),
        help="must be none (built-in store + board)",
    )
    init.set_defaults(func=cmd_init)

    configure = sub.add_parser("configure", help="first-run layout questions or flags")
    configure.add_argument("--ask", action="store_true", help="prompt in the terminal")
    configure.add_argument("--accept-defaults", action="store_true")
    configure.add_argument("--app-folder", default="")
    configure.add_argument("--done", default="")
    configure.add_argument("--writes", action="append", default=[])
    configure.add_argument(
        "--tracker",
        default="",
        choices=("", "none"),
        help="must be none (built-in store + board)",
    )
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
    add.add_argument("--priority", default="P2", choices=PRIORITIES)
    add.add_argument("--milestone", default="")
    add.add_argument("--owner", default="")
    add.add_argument("--description", default="")
    add.add_argument("--kind", default="task", choices=TASK_KINDS)
    add.add_argument("--parent", default="")
    add.add_argument("--problem", default="")
    add.add_argument("--labels", default="", help="comma-separated labels")
    add.set_defaults(func=cmd_task_add)

    brief = sub.add_parser("task-brief", help="create a briefing ticket with a fill template")
    brief.add_argument("--title", required=True)
    brief.add_argument("--done", default="")
    brief.add_argument("--writes", action="append", default=[])
    brief.add_argument("--depends", action="append", default=[])
    brief.add_argument("--priority", default="P2", choices=PRIORITIES)
    brief.add_argument("--milestone", default="")
    brief.add_argument("--owner", default="")
    brief.add_argument("--description", default="")
    brief.add_argument("--kind", default="task", choices=TASK_KINDS)
    brief.add_argument("--parent", default="")
    brief.add_argument("--problem", default="")
    brief.set_defaults(func=cmd_task_brief)

    ticket = sub.add_parser(
        "task-ticket",
        help="find an open ticket or create a briefing ticket",
    )
    ticket.add_argument("--title", required=True)
    ticket.add_argument("--new", action="store_true")
    ticket.add_argument("--done", default="")
    ticket.add_argument("--writes", action="append", default=[])
    ticket.add_argument("--depends", action="append", default=[])
    ticket.add_argument("--priority", default="P2", choices=PRIORITIES)
    ticket.add_argument("--milestone", default="")
    ticket.add_argument("--owner", default="")
    ticket.add_argument("--description", default="")
    ticket.add_argument("--kind", default="task", choices=TASK_KINDS)
    ticket.add_argument("--parent", default="")
    ticket.add_argument("--problem", default="")
    ticket.set_defaults(func=cmd_task_ticket)

    ready = sub.add_parser("task-ready", help="validate spec and move a briefing task to queued")
    ready.add_argument("task_id")
    ready.set_defaults(func=cmd_task_ready)

    update = sub.add_parser("task-update", help="update PM fields on a task")
    update.add_argument("task")
    update.add_argument("--title", default="")
    update.add_argument("--description", default=None)
    update.add_argument("--priority", default="", choices=("",) + PRIORITIES)
    update.add_argument("--milestone", default=None)
    update.add_argument("--owner", default="")
    update.add_argument("--reason", default=None)
    update.add_argument("--kind", default="", choices=("",) + TASK_KINDS)
    update.add_argument("--parent", default=None)
    update.add_argument("--depends", action="append", default=None)
    update.add_argument("--labels", default=None, help="replace labels (comma-separated)")
    update.add_argument("--add-label", action="append", default=[])
    update.add_argument("--remove-label", action="append", default=[])
    update.set_defaults(func=cmd_task_update)

    ov_imp = sub.add_parser(
        "overrides-import",
        help="apply board override JSON into the project store",
    )
    ov_imp.add_argument("--file", "-f", required=True)
    ov_imp.add_argument(
        "--pm-only",
        action="store_true",
        help="ignore board state/status changes; only PM/detail fields",
    )
    ov_imp.set_defaults(func=cmd_overrides_import)

    ov_exp = sub.add_parser(
        "overrides-export",
        help="write current tasks as board-overrides JSON",
    )
    ov_exp.add_argument("--output", "-o", default="")
    ov_exp.set_defaults(func=cmd_overrides_export)

    ms_add = sub.add_parser("milestone-add", help="add or rename a project milestone")
    ms_add.add_argument("--id", required=True)
    ms_add.add_argument("--name", default="")
    ms_add.set_defaults(func=cmd_milestone_add)

    ms_list = sub.add_parser("milestone-list", help="list project milestones")
    ms_list.set_defaults(func=cmd_milestone_list)

    nxt = sub.add_parser("task-next", help="claim next ready task")
    nxt.add_argument("--agent", default=os.environ.get("USER", "agent"))
    nxt.add_argument("--force", action="store_true")
    nxt.set_defaults(func=cmd_task_next)

    claim = sub.add_parser("task-claim", help="claim a task")
    claim.add_argument("task_id")
    claim.add_argument("--agent", default=os.environ.get("USER", "agent"))
    claim.add_argument(
        "--force",
        action="store_true",
        help="override overlap/parallel; also requeue failed/blocked",
    )
    claim.set_defaults(func=cmd_task_claim)

    reclaim = sub.add_parser(
        "reclaim",
        help="release stale claimed tasks (or one task with --force)",
    )
    reclaim.add_argument("--task", default="")
    reclaim.add_argument(
        "--force",
        action="store_true",
        help="release even when the lease is still fresh",
    )
    reclaim.set_defaults(func=cmd_reclaim)

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

    rebase = sub.add_parser(
        "rebase",
        help="merge main into a task worktree after an accept merge conflict",
    )
    rebase.add_argument("--task", required=True)
    rebase.set_defaults(func=cmd_rebase)

    doctor = sub.add_parser(
        "doctor",
        help="check install/config health (versions, app folder, just, git)",
    )
    doctor.set_defaults(func=cmd_doctor)

    note = sub.add_parser("task-note", help="append a note on a task")
    note.add_argument("task")
    note.add_argument("text")
    note.add_argument("--by", default="")
    note.set_defaults(func=cmd_task_note)

    prime = sub.add_parser(
        "prime",
        help="print an agent resume dump (queue, deps, stuck, next steps)",
    )
    prime.add_argument("--events", type=int, default=12)
    prime.add_argument("--output", "-o", default="", help="also write to a file")
    prime.set_defaults(func=cmd_prime)

    status = sub.add_parser("status", help="print run status")
    status.set_defaults(func=cmd_status)

    export = sub.add_parser(
        "export",
        help="write JSON snapshot of the project task store",
    )
    export.add_argument(
        "--output",
        "-o",
        default="",
        help="destination path (default: .dm-software-machine/export.json)",
    )
    export.set_defaults(func=cmd_export)

    board = sub.add_parser(
        "board",
        help="open the specs folder in Markable-Project",
    )
    board.add_argument(
        "--output",
        "-o",
        default="",
        help="unused; the board is the specs folder",
    )
    board.add_argument(
        "--serve",
        action="store_true",
        help="unused; the board is the specs folder, not a server",
    )
    board.add_argument("--port", type=int, default=47321)
    board.set_defaults(func=cmd_board)

    agent_run = sub.add_parser(
        "agent-run",
        help="work a claimed ticket, then review and accept when the gate is green",
    )
    agent_run.add_argument("--task", required=True)
    agent_run.set_defaults(func=cmd_agent_run)

    board_watch = sub.add_parser(
        "board-watch",
        help="claim a task when its note is dropped on the Claimed lane",
    )
    board_watch.add_argument("--once", action="store_true")
    board_watch.set_defaults(func=cmd_board_watch)

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
