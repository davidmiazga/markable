#!/usr/bin/env python3
"""Phase 1–1b: project store, export, exclusive claim, leases, failed."""

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


def load_state(cwd: Path) -> dict:
    pointer = (cwd / ".dm-software-machine" / "current-run").read_text().strip()
    return json.loads(
        (cwd / ".dm-software-machine" / "runs" / pointer / "state.json").read_text()
    )


def save_state(cwd: Path, state: dict) -> None:
    path = (
        cwd
        / ".dm-software-machine"
        / "runs"
        / state["run_id"]
        / "state.json"
    )
    path.write_text(json.dumps(state, indent=2) + "\n")


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sm-export-"))
    try:
        subprocess.run(["git", "init"], cwd=tmp, check=True, capture_output=True)
        result = run(
            ["init", "--profile", "tauri", "--no-scaffold", "--accept-defaults"],
            tmp,
        )
        if result.returncode != 0:
            raise SystemExit(f"init failed\n{result.stdout}\n{result.stderr}")

        add = run(["task-add", "--title", "export probe"], tmp)
        assert add.returncode == 0, add.stderr
        task_id = add.stdout.strip().splitlines()[0]
        assert task_id.startswith("t-"), add.stdout
        spec_text = (tmp / "specs" / f"{task_id}.md").read_text()
        assert "status: Ready" in spec_text

        claim_a = run(["task-claim", task_id, "--agent", "agent-a"], tmp)
        assert claim_a.returncode == 0, claim_a.stderr
        assert "status: Claimed" in (tmp / "specs" / f"{task_id}.md").read_text()
        claim_b = run(["task-claim", task_id, "--agent", "agent-b"], tmp)
        assert claim_b.returncode != 0, "second agent must not steal claim"
        assert "already claimed by agent-a" in (claim_b.stderr + claim_b.stdout)

        state = load_state(tmp)
        assert state["tasks"][task_id]["claim_lease"]
        state["tasks"][task_id]["claim_lease"] = "2020-01-01T00:00:00+00:00"
        save_state(tmp, state)

        claim_stale = run(["task-claim", task_id, "--agent", "agent-b"], tmp)
        assert claim_stale.returncode == 0, claim_stale.stderr + claim_stale.stdout
        state = load_state(tmp)
        assert state["tasks"][task_id]["claimed_by"] == "agent-b"
        assert state["tasks"][task_id]["status"] == "claimed"

        fresh_reclaim = run(["reclaim", "--task", task_id], tmp)
        assert fresh_reclaim.returncode != 0
        forced = run(["reclaim", "--task", task_id, "--force"], tmp)
        assert forced.returncode == 0, forced.stderr
        state = load_state(tmp)
        assert state["tasks"][task_id]["status"] == "queued"
        assert state["tasks"][task_id]["claimed_by"] is None

        # Simulate over-repair failure without running gates.
        state["tasks"][task_id]["status"] = "failed"
        state["tasks"][task_id]["repair_count"] = 3
        state["tasks"][task_id]["max_repairs"] = 2
        state["tasks"][task_id]["reason"] = (
            "Quality gate red after 3 repairs (max 2); stopped for review."
        )
        save_state(tmp, state)
        failed_note = tmp / "specs" / f"{task_id}.md"
        failed_note.write_text(
            failed_note.read_text().replace("status: Ready", "status: Failed", 1)
        )

        blocked_claim = run(["task-claim", task_id, "--agent", "agent-c"], tmp)
        assert blocked_claim.returncode != 0
        requeue = run(
            ["task-claim", task_id, "--agent", "agent-c", "--force"], tmp
        )
        assert requeue.returncode == 0, requeue.stderr + requeue.stdout
        state = load_state(tmp)
        assert state["tasks"][task_id]["status"] == "claimed"
        assert state["tasks"][task_id]["repair_count"] == 0

        exported = run(["export"], tmp)
        assert exported.returncode == 0, exported.stderr + exported.stdout
        export_path = tmp / ".dm-software-machine" / "export.json"
        payload = json.loads(export_path.read_text())
        assert payload["schema_version"] == "0.5-smdm"
        assert payload["task_count"] == 1
        assert "milestones" in payload
        row = payload["tasks"][0]
        assert row["id"] == task_id
        assert row["status"] == "claimed"
        assert row["state"] == "claimed"
        assert row["kind"] == "task"
        assert row["priority"] == "P2"
        assert row["owner"]
        assert row["claim"] and row["claim"]["holder"] == "agent-c"
        assert row["claim"]["lease"]
        assert row["writes"]
        assert row["evidence"]["acceptance"] == "none"

        ms = run(
            ["milestone-add", "--id", "M1", "--name", "Store + export"],
            tmp,
        )
        assert ms.returncode == 0, ms.stderr
        upd = run(
            [
                "task-update",
                task_id,
                "--priority",
                "P1",
                "--milestone",
                "M1",
                "--owner",
                "Cursor",
                "--description",
                "Board detail note",
            ],
            tmp,
        )
        assert upd.returncode == 0, upd.stderr
        exported2 = run(["export"], tmp)
        assert exported2.returncode == 0, exported2.stderr
        payload2 = json.loads(export_path.read_text())
        assert payload2["milestones"][0]["id"] == "M1"
        row2 = payload2["tasks"][0]
        assert row2["priority"] == "P1"
        assert row2["milestone"] == "M1"
        assert row2["owner"] == "Cursor"
        assert row2["description"] == "Board detail note"
        assert row2["state"] == "claimed"

        # Board overrides import: PM fields + state remap; refuse done→accepted.
        ov_path = tmp / "board-overrides.json"
        ov_path.write_text(
            json.dumps(
                {
                    "schema_version": "0.5-smdm-overrides",
                    "overrides": {
                        task_id: {
                            "description": "From board",
                            "priority": "P3",
                            "state": "running",
                            "reason": "manual note",
                        },
                        "nope": {"title": "x"},
                    },
                }
            )
        )
        bad = run(["overrides-import", "-f", str(ov_path)], tmp)
        assert bad.returncode != 0
        ov_path.write_text(
            json.dumps(
                {
                    "schema_version": "0.5-smdm-overrides",
                    "overrides": {
                        task_id: {
                            "description": "From board",
                            "priority": "P3",
                            "state": "running",
                            "reason": "manual note",
                        }
                    },
                }
            )
        )
        good = run(["overrides-import", "-f", str(ov_path)], tmp)
        assert good.returncode == 0, good.stderr + good.stdout
        state = load_state(tmp)
        assert state["tasks"][task_id]["description"] == "From board"
        assert state["tasks"][task_id]["priority"] == "P3"
        # Claimed/in-flight statuses are not demoted by board import.
        assert state["tasks"][task_id]["status"] == "claimed"
        assert state["tasks"][task_id]["reason"] == "manual note"
        refuse = run(
            [
                "overrides-import",
                "-f",
                str(ov_path),
            ],
            tmp,
        )
        # rewrite override attempting done
        ov_path.write_text(
            json.dumps(
                {
                    "schema_version": "0.5-smdm-overrides",
                    "overrides": {task_id: {"state": "done", "description": "still open"}},
                }
            )
        )
        done_try = run(["overrides-import", "-f", str(ov_path)], tmp)
        assert done_try.returncode == 0, done_try.stderr
        assert "ignored state=done" in done_try.stdout
        state = load_state(tmp)
        assert state["tasks"][task_id]["status"] != "accepted"
        assert state["tasks"][task_id]["description"] == "still open"
        spec_file = tmp / "specs" / f"{task_id}.md"
        assert spec_file.is_file(), spec_file
        ov_path.write_text(
            json.dumps(
                {
                    "schema_version": "0.5-smdm-overrides",
                    "overrides": {
                        task_id: {"spec": "# from board\n\nEdited in the drawer.\n"}
                    },
                }
            )
        )
        spec_imp = run(["overrides-import", "-f", str(ov_path)], tmp)
        assert spec_imp.returncode == 0, spec_imp.stderr + spec_imp.stdout
        assert "Edited in the drawer." in spec_file.read_text()
        assert "wrote" in spec_imp.stdout

        project_path = tmp / ".dm-software-machine" / "project-tasks.json"
        assert project_path.is_file()
        gitignore = (tmp / ".gitignore").read_text()
        assert ".dm-software-machine/project-tasks.json" in gitignore
        assert ".dm-software-machine/export.json" in gitignore
        assert ".dm-software-machine/board.html" in gitignore
        board = run(["board"], tmp)
        assert board.returncode == 0, board.stderr + board.stdout
        assert str(tmp / "specs") in board.stdout
        board_note = (tmp / "specs" / "board.md").read_text()
        for lane in ("Ready", "Claimed", "Running", "Review", "Blocked", "Failed", "Done"):
            assert lane in board_note
        assert "kanban: board" in board_note
        assert task_id in project_path.read_text()

        labeled = run(
            ["task-add", "--title", "Labeled child", "--labels", "ux, backend"],
            tmp,
        )
        assert labeled.returncode == 0, labeled.stderr
        child = [
            line for line in labeled.stdout.splitlines() if line.startswith("t-")
        ][0]
        note = run(["task-note", child, "handoff tip: check drawer CSS"], tmp)
        assert note.returncode == 0, note.stderr
        upd = run(
            ["task-update", child, "--add-label", "p0", "--depends", task_id],
            tmp,
        )
        assert upd.returncode == 0, upd.stderr
        export2 = run(["export"], tmp)
        assert export2.returncode == 0, export2.stderr
        payload2 = json.loads(
            (tmp / ".dm-software-machine" / "export.json").read_text()
        )
        child_row = next(row for row in payload2["tasks"] if row["id"] == child)
        assert "ux" in child_row["labels"] and "backend" in child_row["labels"]
        assert "p0" in child_row["labels"]
        assert task_id in child_row["waiting_on"]
        assert child in next(
            row for row in payload2["tasks"] if row["id"] == task_id
        )["blocks"]
        assert child_row["notes"] and "drawer CSS" in child_row["notes"][-1]["text"]
        prime = run(["prime"], tmp)
        assert prime.returncode == 0, prime.stderr
        assert "sm prime" in prime.stdout
        assert "dependency edges" in prime.stdout
        assert f"{child} -> {task_id}" in prime.stdout
        running_note = tmp / "specs" / f"{task_id}.md"
        running_note.write_text(
            running_note.read_text().replace("status: Claimed", "status: Running", 1)
        )
        ran = run(["task-note", task_id, "lane check"], tmp)
        assert ran.returncode == 0, ran.stderr
        assert load_state(tmp)["tasks"][task_id]["status"] == "active"
        running_note.write_text(
            running_note.read_text().replace("status: Running", "status: Done", 1)
        )
        done = run(["task-note", task_id, "done check"], tmp)
        assert done.returncode == 0, done.stderr
        assert load_state(tmp)["tasks"][task_id]["status"] == "reviewed"
        print("temp export + board + lease + labels/notes/prime ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    fixture = run(["export"], ROOT)
    assert fixture.returncode == 0, fixture.stderr + fixture.stdout
    export_path = ROOT / ".dm-software-machine" / "export.json"
    payload = json.loads(export_path.read_text())
    assert payload["schema_version"] == "0.5-smdm"
    assert payload["task_count"] >= 4
    assert "milestones" in payload
    assert "settings" in payload
    assert "worktrees" in payload["settings"]
    assert int(payload["settings"]["parallel"]) >= 1
    for row in payload["tasks"]:
        if row["evidence"]["acceptance"] == "accepted":
            assert row["status"] == "accepted", row
            assert row["state"] == "done", row
        if row["status"] == "accepted":
            assert row["evidence"]["acceptance"] == "accepted", row
        assert row["priority"] in ("P1", "P2", "P3", "P4")
        assert "owner" in row
        assert (row.get("kind") or "task") in ("task", "subtask", "subcard")
        assert "writes" in row
    shell = (ROOT / "dm-software-machine" / "board" / "project-board.html").read_text()
    assert 'id="pb-new-ticket"' not in shell
    store_text = (ROOT / ".dm-software-machine" / "project-tasks.json").read_text()
    for row in payload["tasks"]:
        assert f'"{row["id"]}"' in store_text
    print(f"fixture export + board ok ({payload['task_count']} tasks)")
    print("export checks passed")


if __name__ == "__main__":
    main()
