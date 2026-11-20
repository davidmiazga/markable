#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""Worktree claim isolation + accept merge."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "dm-software-machine" / "scripts" / "dmsm.py"


def run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", str(CLI), *argv],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


def load_state(cwd: Path) -> dict:
    pointer = (cwd / ".dm-software-machine" / "current-run").read_text().strip()
    return json.loads(
        (cwd / ".dm-software-machine" / "runs" / pointer / "state.json").read_text()
    )


def set_yaml(cwd: Path, key: str, value: str) -> None:
    path = cwd / ".dm-software-machine" / "machine.yaml"
    text = path.read_text()
    import re

    if re.search(rf"(?m)^{re.escape(key)}:", text):
        text = re.sub(rf"(?m)^{re.escape(key)}:.*$", f"{key}: {value}", text, count=1)
    else:
        text = text.rstrip() + f"\n{key}: {value}\n"
    path.write_text(text)


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sm-wt-"))
    try:
        git(tmp, "init")
        git(tmp, "config", "user.email", "sm@test")
        git(tmp, "config", "user.name", "sm test")
        result = run(
            ["init", "--profile", "tauri", "--no-scaffold", "--accept-defaults"],
            tmp,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        set_yaml(tmp, "worktrees", "true")
        set_yaml(tmp, "parallel", "2")
        (tmp / "notes").mkdir()
        (tmp / "notes" / "README.md").write_text("base\n")
        git(tmp, "add", "notes/README.md")
        git(tmp, "commit", "-m", "notes base")

        a = run(
            ["task-add", "--title", "alpha note", "--writes", "notes/README.md"],
            tmp,
        )
        assert a.returncode == 0, a.stderr
        id_a = a.stdout.strip().splitlines()[0]
        b = run(
            ["task-add", "--title", "beta note", "--writes", "notes/README.md"],
            tmp,
        )
        assert b.returncode == 0, b.stderr
        id_b = b.stdout.strip().splitlines()[0]

        # Overlapping file writes serialize even with parallel=2.
        claim_a = run(["task-claim", id_a, "--agent", "agent-a"], tmp)
        assert claim_a.returncode == 0, claim_a.stderr + claim_a.stdout
        assert "worktree" in claim_a.stdout
        wt_a = tmp / ".dm-software-machine" / "worktrees" / id_a
        assert wt_a.is_dir(), claim_a.stdout
        claim_b = run(["task-claim", id_b, "--agent", "agent-b"], tmp)
        assert claim_b.returncode != 0, "overlap must serialize"
        assert "serialized" in (claim_b.stderr + claim_b.stdout)

        # Edit only inside the worktree — main tree stays clean of the edit.
        (wt_a / "notes" / "README.md").write_text("alpha edit\n")
        assert (tmp / "notes" / "README.md").read_text() == "base\n"

        # Finish/gate would fail without profile checks for notes/; simulate
        # gated+reviewed then accept to exercise merge.
        state = load_state(tmp)
        state["tasks"][id_a]["status"] = "reviewed"
        state["tasks"][id_a]["last_gate"] = {
            "kind": "fast",
            "passed": True,
            "at": "2026-01-01T00:00:00+00:00",
        }
        state["tasks"][id_a]["last_review"] = {
            "approved": True,
            "at": "2026-01-01T00:00:00+00:00",
        }
        path = (
            tmp
            / ".dm-software-machine"
            / "runs"
            / state["run_id"]
            / "state.json"
        )
        path.write_text(json.dumps(state, indent=2) + "\n")

        accept = run(["accept", "--task", id_a], tmp)
        assert accept.returncode == 0, accept.stderr + accept.stdout
        assert "accepted" in accept.stdout
        assert "post-merge fast: skip" in accept.stdout
        assert (tmp / "notes" / "README.md").read_text() == "alpha edit\n"
        assert not wt_a.exists()
        state = load_state(tmp)
        assert state["tasks"][id_a]["status"] == "accepted"
        assert not state["tasks"][id_a].get("worktree_path")

        # Second task can claim after overlap clears.
        claim_b2 = run(["task-claim", id_b, "--agent", "agent-b"], tmp)
        assert claim_b2.returncode == 0, claim_b2.stderr + claim_b2.stdout
        wt_b = tmp / ".dm-software-machine" / "worktrees" / id_b
        assert wt_b.is_dir()
        forced = run(["reclaim", "--task", id_b, "--force"], tmp)
        assert forced.returncode == 0, forced.stderr
        assert not wt_b.exists()

        # Board settings import toggles machine.yaml worktrees/parallel.
        ov = tmp / "board-overrides.json"
        ov.write_text(
            json.dumps(
                {
                    "schema_version": "0.5-smdm-overrides",
                    "settings": {"worktrees": False, "parallel": 2},
                    "overrides": {},
                }
            )
        )
        imp = run(["overrides-import", "-f", str(ov)], tmp)
        assert imp.returncode == 0, imp.stderr + imp.stdout
        yaml_text = (tmp / ".dm-software-machine" / "machine.yaml").read_text()
        assert "worktrees: false" in yaml_text
        # parallel>1 is clamped when worktrees are disabled.
        assert "parallel: 1" in yaml_text
        assert "clamped" in (imp.stdout + imp.stderr)
        print("worktree claim/merge/reclaim + settings import ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
