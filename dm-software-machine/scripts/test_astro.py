#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""Astro profile: skip-when, package manager, tmp scaffold, red gate, repair."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "dm-software-machine" / "scripts" / "dmsm.py"
sys.path.insert(0, str(CLI.parent))
import dmsm  # noqa: E402


def run(argv: list[str], cwd: Path, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", str(CLI), *argv],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
        timeout=timeout,
    )


def test_when_and_pm(tmp: Path) -> None:
    app = tmp / "app"
    app.mkdir()
    (app / "package.json").write_text(json.dumps({
        "scripts": {
            "test": "echo \"Error: no test specified\" && exit 1",
            "build": "astro build",
            "lint": "eslint .",
        },
    }))
    (app / "pnpm-lock.yaml").write_text("lockfileVersion: 9\n")
    assert dmsm.detect_package_manager(app) == "pnpm"
    assert dmsm.should_run_check({"when": {"package_script": "lint"}}, app)
    assert not dmsm.should_run_check({"when": {"package_script": "test"}}, app)
    assert dmsm.should_run_check({"argv": ["npx", "astro", "check"]}, app)
    assert dmsm.rewrite_pm_argv(["npm", "run", "build"], app) == ["pnpm", "run", "build"]
    assert dmsm.rewrite_pm_argv(["npx", "astro", "check"], app) == ["pnpm", "exec", "astro", "check"]
    missing = tmp / "empty"
    missing.mkdir()
    (missing / "package.json").write_text("{}")
    assert not dmsm.should_run_check({"when": {"package_script": "lint"}}, missing)
    print("when + package manager ok")


def test_live_fixture() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="sm-astro-"))
    try:
        subprocess.run(["git", "init"], cwd=tmp, check=True, capture_output=True)
        first = run(
            ["init", "--profile", "astro", "--accept-defaults"],
            tmp,
            timeout=600,
        )
        if first.returncode != 0:
            raise SystemExit(f"astro init failed\n{first.stdout}\n{first.stderr}")
        app = tmp / "astro-app"
        assert (app / "package.json").is_file(), first.stdout
        profile = (tmp / ".dm-software-machine" / "profile.yaml").read_text()
        assert "id: astro" in profile
        defaults = run(["defaults"], tmp)
        assert "astro-app" in defaults.stdout
        assert "src/" in defaults.stdout
        added = run(["task-add", "--title", "prove astro gate"], tmp)
        if added.returncode != 0:
            raise SystemExit(added.stdout + added.stderr)
        task_id = None
        for line in added.stdout.splitlines():
            if line.startswith("t-"):
                task_id = line.split()[0]
                break
        if not task_id:
            # task-add prints id somewhere
            text = added.stdout
            raise SystemExit(f"no task id\n{text}")
        claim = run(["task-claim", task_id], tmp)
        assert claim.returncode == 0, claim.stdout + claim.stderr
        green = run(["gate", "--task", task_id, "--kind", "fast"], tmp, timeout=600)
        if green.returncode != 0:
            raise SystemExit(f"expected green astro gate\n{green.stdout}\n{green.stderr}")
        assert "skip test" in green.stdout or "skip lint" in green.stdout or "skip " in green.stdout
        page = next((app / "src").rglob("*.astro"))
        original = page.read_text()
        page.write_text("---\nthrow new Error('sm-gate-fail')\n---\n" + original)
        red = run(["gate", "--task", task_id, "--kind", "fast"], tmp, timeout=600)
        assert red.returncode != 0, red.stdout
        assert "fail" in red.stdout
        page.write_text(original)
        repaired = run(["gate", "--task", task_id, "--kind", "fast"], tmp, timeout=600)
        if repaired.returncode != 0:
            raise SystemExit(f"repair did not go green\n{repaired.stdout}\n{repaired.stderr}")
        yaml_path = tmp / ".dm-software-machine" / "machine.yaml"
        yaml_path.write_text(yaml_path.read_text() + "\n# local comment\n")
        second = run(["init", "--profile", "astro", "--no-scaffold", "--accept-defaults"], tmp)
        assert second.returncode == 0, second.stderr
        assert "skipped-local" in second.stdout or "unchanged" in second.stdout or "skipped" in second.stdout
        print("live astro scaffold + red gate + repair + second init ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    unit = Path(tempfile.mkdtemp(prefix="sm-astro-unit-"))
    try:
        test_when_and_pm(unit)
    finally:
        shutil.rmtree(unit, ignore_errors=True)
    test_live_fixture()
    print("astro profile checks passed")


if __name__ == "__main__":
    main()
