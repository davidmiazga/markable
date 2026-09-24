#!/usr/bin/env python3
"""Prove permissions stamp + auto_advance on/off without leaving this repo on."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "dm-software-machine" / "scripts" / "dmsm.py"
TEMPLATE = ROOT / "dm-software-machine" / "templates" / "permissions.json"


def run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["uv", "run", str(CLI), *argv],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
    )


def main() -> None:
    payload = json.loads(TEMPLATE.read_text())
    allow = payload["autoRun"]["allow_instructions"]
    block = payload["autoRun"]["block_instructions"]
    assert any("just sm-" in item for item in allow), allow
    assert any("git push" in item for item in block), block

    tmp = Path(tempfile.mkdtemp(prefix="sm-unattended-"))
    try:
        subprocess.run(["git", "init"], cwd=tmp, check=True, capture_output=True)
        result = run(
            ["init", "--profile", "tauri", "--no-scaffold", "--accept-defaults"],
            tmp,
        )
        if result.returncode != 0:
            raise SystemExit(f"init failed\n{result.stdout}\n{result.stderr}")
        stamped = tmp / ".cursor" / "permissions.json"
        assert stamped.is_file(), f"missing {stamped}\n{result.stdout}"
        assert json.loads(stamped.read_text())["autoRun"]["allow_instructions"]
        yaml_text = (tmp / ".dm-software-machine" / "machine.yaml").read_text()
        assert "auto_advance: false" in yaml_text
        assert "# After accept" in yaml_text
        assert ".cursor/" in yaml_text
        auto_on = run(["auto", "on"], tmp)
        assert auto_on.returncode == 0, auto_on.stderr
        assert "auto_advance=True" in auto_on.stdout
        yaml_on = (tmp / ".dm-software-machine" / "machine.yaml").read_text()
        assert re.search(r"^auto_advance: true$", yaml_on, re.M)
        defaults = run(["defaults"], tmp)
        assert "auto_advance True" in defaults.stdout or "auto_advance true" in defaults.stdout.lower()
        auto_off = run(["auto", "off"], tmp)
        assert auto_off.returncode == 0
        assert "auto_advance=False" in auto_off.stdout
        yaml_off = (tmp / ".dm-software-machine" / "machine.yaml").read_text()
        assert re.search(r"^auto_advance: false$", yaml_off, re.M)
        print("tmp init + auto on/off ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    fixture = run(["auto", "on"], ROOT)
    assert fixture.returncode == 0, fixture.stderr + fixture.stdout
    status_on = run(["status"], ROOT)
    assert "auto_advance=True" in status_on.stdout, status_on.stdout
    defaults_on = run(["defaults"], ROOT)
    assert "True" in defaults_on.stdout.split("auto_advance")[-1]
    fixture_off = run(["auto", "off"], ROOT)
    assert fixture_off.returncode == 0
    status_off = run(["status"], ROOT)
    assert "auto_advance=False" in status_off.stdout, status_off.stdout
    yaml_fix = (ROOT / ".dm-software-machine" / "machine.yaml").read_text()
    assert re.search(r"^auto_advance: false$", yaml_fix, re.M)
    print("this-repo auto on/off restored to off")
    print("unattended checks passed")


if __name__ == "__main__":
    main()
