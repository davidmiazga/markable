#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""Brief-first: thin specs cannot be claimed; ready queues a complete spec."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "dm-software-machine" / "scripts" / "dmsm.py"
sys.path.insert(0, str(CLI.parent))
import dmsm  # noqa: E402

COMPLETE_BODY = """
## Problem
Category heading prints twice in Manage Results.

## In scope
Show the word Category once. Values sit under that heading.

## Out of scope
Do not rewrite notes. Do not change other field groups.

## UX / behavior
Results pane has one Category heading. Nested fields still have their own subheads.

## Tests
Assert a single Category heading when the scan has category pairs.
"""


def run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", str(CLI), *argv],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


def task_id_from(stdout: str) -> str:
    for line in stdout.splitlines():
        if line.startswith("t-"):
            return line.split()[0]
    raise SystemExit(f"no task id\n{stdout}")


def set_require_brief(root: Path, value: bool) -> None:
    path = root / ".dm-software-machine" / "machine.yaml"
    text = dmsm.set_yaml_scalar(path.read_text(), "require_brief", value)
    path.write_text(text)


def fill_spec(root: Path, task_id: str) -> None:
    path = root / "specs" / f"{task_id}.md"
    original = path.read_text()
    title_line = original.splitlines()[0] if original.strip() else f"# {task_id}"
    header = "\n".join(original.splitlines()[:5])
    if not header.startswith("#"):
        header = title_line
    path.write_text(header.rstrip() + "\n" + COMPLETE_BODY)


def test_spec_complete_unit(tmp: Path) -> None:
    missing = tmp / "missing.md"
    ok, reasons = dmsm.spec_complete(missing)
    assert not ok
    assert any("missing spec file" in item for item in reasons)

    thin = tmp / "thin.md"
    thin.write_text("# Title\n\nDone means: x\n")
    ok, reasons = dmsm.spec_complete(thin)
    assert not ok
    assert any("Problem" in item for item in reasons)

    template = tmp / "template.md"
    template.write_text(
        dmsm.render_spec_template(
            title="demo",
            done="done",
            writes=["src/"],
            defaults={"dev_cwd": ".", "dev_command": "npm test"},
        )
    )
    ok, reasons = dmsm.spec_complete(template)
    assert not ok, reasons
    assert any("Problem" in item or "In scope" in item for item in reasons)

    placeholder = tmp / "placeholder.md"
    placeholder.write_text(
        "# Title\n\n"
        "## Problem\nTODO write this\n\n"
        "## In scope\nShow Category once.\n\n"
        "## Out of scope\nDo not rewrite notes.\n\n"
        "## UX / behavior\nOne heading.\n\n"
        "## Tests\nAssert one heading.\n"
    )
    ok, reasons = dmsm.spec_complete(placeholder)
    assert not ok
    assert any("Problem" in item for item in reasons)

    complete = tmp / "complete.md"
    complete.write_text("# Title\n" + COMPLETE_BODY)
    ok, reasons = dmsm.spec_complete(complete)
    assert ok, reasons
    print("spec_complete unit ok")


def test_live_brief_gate() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sm-brief-"))
    try:
        subprocess.run(["git", "init"], cwd=tmp, check=True, capture_output=True)
        first = run(
            ["init", "--profile", "tauri", "--no-scaffold", "--accept-defaults"],
            tmp,
        )
        if first.returncode != 0:
            raise SystemExit(f"init failed\n{first.stdout}\n{first.stderr}")
        yaml_text = (tmp / ".dm-software-machine" / "machine.yaml").read_text()
        assert "require_brief: false" in yaml_text
        set_require_brief(tmp, True)
        defaults = run(["defaults"], tmp)
        assert defaults.returncode == 0, defaults.stderr
        assert "require_brief True" in defaults.stdout or "require_brief true" in defaults.stdout.lower()

        added = run(["task-add", "--title", "thin wrangler nit"], tmp)
        if added.returncode != 0:
            raise SystemExit(added.stdout + added.stderr)
        assert "briefing" in added.stdout
        add_id = task_id_from(added.stdout)
        add_spec = tmp / "specs" / f"{add_id}.md"
        assert add_spec.is_file()
        assert "## UX / behavior" in add_spec.read_text()

        briefed = run(["task-brief", "--title", "need a clarifying spec"], tmp)
        if briefed.returncode != 0:
            raise SystemExit(briefed.stdout + briefed.stderr)
        assert "briefing" in briefed.stdout
        assert "Please fill out this ticket" in briefed.stdout
        assert "When filled:" in briefed.stdout
        task_id = task_id_from(briefed.stdout)
        spec = tmp / "specs" / f"{task_id}.md"
        assert spec.is_file()
        ok, _ = dmsm.spec_complete(spec)
        assert not ok

        claimed = run(["task-claim", task_id], tmp)
        assert claimed.returncode != 0
        assert "briefing" in (claimed.stderr + claimed.stdout)

        forced = run(["task-claim", task_id, "--force"], tmp)
        assert forced.returncode != 0
        assert "briefing" in (forced.stderr + forced.stdout)

        nxt = run(["task-next"], tmp)
        assert nxt.returncode != 0
        assert "no ready tasks" in nxt.stdout

        not_ready = run(["task-ready", task_id], tmp)
        assert not_ready.returncode != 0
        assert "incomplete" in (not_ready.stderr + not_ready.stdout)

        fill_spec(tmp, task_id)
        ready = run(["task-ready", task_id], tmp)
        if ready.returncode != 0:
            raise SystemExit(ready.stdout + ready.stderr)
        assert "queued" in ready.stdout

        claimed_ok = run(["task-claim", task_id], tmp)
        assert claimed_ok.returncode == 0, claimed_ok.stdout + claimed_ok.stderr
        assert task_id in claimed_ok.stdout

        set_require_brief(tmp, False)
        legacy = run(["task-add", "--title", "legacy one-liner still queues"], tmp)
        if legacy.returncode != 0:
            raise SystemExit(legacy.stdout + legacy.stderr)
        assert "briefing" not in legacy.stdout
        legacy_id = task_id_from(legacy.stdout)
        legacy_claim = run(["task-claim", legacy_id, "--force"], tmp)
        assert legacy_claim.returncode == 0, legacy_claim.stdout + legacy_claim.stderr
        print("live brief gate ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def test_ticket_find_or_create() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sm-ticket-"))
    try:
        subprocess.run(["git", "init"], cwd=tmp, check=True, capture_output=True)
        first = run(
            ["init", "--profile", "tauri", "--no-scaffold", "--accept-defaults"],
            tmp,
        )
        if first.returncode != 0:
            raise SystemExit(f"init failed\n{first.stdout}\n{first.stderr}")
        set_require_brief(tmp, True)

        created = run(
            ["task-ticket", "--title", "Wrangler parent-child drag"],
            tmp,
        )
        if created.returncode != 0:
            raise SystemExit(created.stdout + created.stderr)
        assert "action created" in created.stdout
        assert "Please fill out this ticket" in created.stdout
        task_id = task_id_from(created.stdout)
        spec = tmp / "specs" / f"{task_id}.md"
        assert spec.is_file()

        found_title = run(
            ["task-ticket", "--title", "Wrangler parent-child drag"],
            tmp,
        )
        assert found_title.returncode == 0, found_title.stdout + found_title.stderr
        assert "action found" in found_title.stdout
        assert task_id in found_title.stdout

        found_id = run(["task-ticket", "--title", task_id], tmp)
        assert found_id.returncode == 0, found_id.stdout + found_id.stderr
        assert "action found" in found_id.stdout
        assert task_id in found_id.stdout

        forced = run(
            ["task-ticket", "--new", "--title", "Wrangler parent-child drag"],
            tmp,
        )
        if forced.returncode != 0:
            raise SystemExit(forced.stdout + forced.stderr)
        assert "action created" in forced.stdout
        other_id = task_id_from(forced.stdout)
        assert other_id != task_id
        print("ticket find-or-create ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    unit = Path(tempfile.mkdtemp(prefix="sm-brief-unit-"))
    try:
        test_spec_complete_unit(unit)
    finally:
        shutil.rmtree(unit, ignore_errors=True)
    test_live_brief_gate()
    test_ticket_find_or_create()
    print("brief checks passed")


if __name__ == "__main__":
    main()
