#!/usr/bin/env python3
"""Embed an smdm export.json into board/project-board.html."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
TEMPLATE = HERE / "project-board.html"

STATUS_TO_BOARD = {
    "queued": "ready",
    "claimed": "claimed",
    "active": "running",
    "gated": "review",
    "reviewed": "review",
    "accepted": "done",
    "blocked": "blocked",
    "failed": "failed",
}


def safe_spec(root: pathlib.Path, spec_path: str) -> tuple[str, str]:
    """Return (text, absolute path) for a spec inside the repo. Refuse escapes."""
    rel = str(spec_path or "").replace("\\", "/").strip()
    if not rel or rel.startswith("/") or ".." in pathlib.PurePosixPath(rel).parts:
        return "", ""
    path = (root / rel).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return "", ""
    if not path.is_file():
        return "", ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return "", ""
    return text, str(path)


def export_to_maps(payload: dict, root: pathlib.Path) -> tuple[dict, dict]:
    tasks = {}
    for t in payload.get("tasks") or []:
        status = t.get("status")
        state = t.get("state") or STATUS_TO_BOARD.get(status, status)
        spec_text, spec_file = safe_spec(root, t.get("spec_path") or "")
        tasks[t["id"]] = {
            "id": t["id"],
            "title": t.get("title") or "",
            "description": t.get("description") or "",
            "kind": t.get("kind") or "task",
            "parent": t.get("parent"),
            "state": state,
            "status": status,
            "priority": t.get("priority") or "P2",
            "milestone": t.get("milestone") or "",
            "owner": t.get("owner") or "unassigned",
            "labels": list(t.get("labels") or []),
            "notes": list(t.get("notes") or []),
            "waiting_on": list(t.get("waiting_on") or []),
            "blocks": list(t.get("blocks") or []),
            "claim": t.get("claim"),
            "deps": t.get("deps") or t.get("depends_on") or [],
            "retries": t.get("retries")
            if t.get("retries") is not None
            else t.get("repair_count") or 0,
            "reason": t.get("reason") or "",
            "evidence": t.get("evidence")
            or {"gate": "none", "review": "none", "acceptance": "none"},
            "writes": t.get("writes") or [],
            "spec_path": t.get("spec_path") or "",
            "spec": spec_text,
            "spec_file": spec_file,
            "external_ref": t.get("external_ref"),
            "envelope_path": t.get("envelope_path")
            or ((t.get("latest_envelope") or {}).get("path") if t.get("latest_envelope") else ""),
            "max_repairs": t.get("max_repairs") or 2,
            "board_overrides_at": t.get("board_overrides_at"),
        }
    miles = {
        m["id"]: (m.get("name") or m["id"]) for m in (payload.get("milestones") or [])
    }
    return tasks, miles


def replace_json_script(html: str, script_id: str, payload: object) -> str:
    data = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    pattern = re.compile(
        rf'(<script[^>]*id="{re.escape(script_id)}"[^>]*>)(.*?)(</script>)',
        re.S,
    )
    if not pattern.search(html):
        raise SystemExit(f"missing script#{script_id} in board template")

    def insert(match: re.Match[str]) -> str:
        # Insert literally. re.sub would turn JSON "\\n" escapes into raw newlines.
        return match.group(1) + data + match.group(3)

    return pattern.sub(insert, html, count=1)


def strip_innermost(html: str, tag: str) -> str:
    """Remove sample t-demo nodes that contain no nested copy of the same tag."""
    pattern = re.compile(
        rf'<{tag}\b[^>]*\bdata-id="t-demo[^"]*"[^>]*>'
        rf'(?:(?!</{tag}>|<{tag}\b).)*</{tag}>',
        re.S,
    )
    previous = None
    while previous != html:
        previous = html
        html = pattern.sub("", html, count=1)
    return html


def strip_sample_board(html: str) -> str:
    """Drop the template's synthetic cards and rows. Live tasks are drawn from pb-tasks."""
    html = strip_innermost(html, "article")
    html = strip_innermost(html, "tr")
    return html


def build(export_path: pathlib.Path, out_path: pathlib.Path) -> pathlib.Path:
    payload = json.loads(export_path.read_text())
    payload["synthetic"] = False
    export_abs = export_path.resolve()
    root = (
        export_abs.parent.parent
        if export_abs.parent.name == ".dm-software-machine"
        else export_abs.parent
    )
    tasks, miles = export_to_maps(payload, root)
    html = TEMPLATE.read_text()
    # Drop NAS/file font URLs if any remain
    html = re.sub(r',?\s*url\("file:[^"]+"\)\s*format\("truetype"\)', "", html)
    html = replace_json_script(html, "pb-tasks", tasks)
    html = replace_json_script(html, "pb-miles", miles)
    if 'id="pb-live-export"' in html:
        html = replace_json_script(html, "pb-live-export", payload)
    html = re.sub(
        r'(<div id="pb-export-meta"[^>]*)>',
        rf'\1 data-exported-at="{payload.get("exported_at", "")}" '
        rf'data-now="{payload.get("now", payload.get("exported_at", ""))}" '
        rf'data-schema="{payload.get("schema_version", "")}" '
        rf'data-project="{payload.get("project", "")}" data-synthetic="0">',
        html,
        count=1,
    )
    html = html.replace("synthetic demo", "live smdm export", 1)
    html = strip_sample_board(html)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export", type=pathlib.Path, required=True)
    parser.add_argument("--out", type=pathlib.Path, required=True)
    args = parser.parse_args()
    path = build(args.export, args.out)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
