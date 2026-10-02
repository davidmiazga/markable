#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pydantic>=2", "pyyaml"]
# ///
"""Find specs/<id>.md or create a briefing ticket (SM + Beads).

Usage (from the app repo root):

    uv run dm-software-machine/scripts/sm_ticket.py "Wrangler parent-child drag"
    uv run dm-software-machine/scripts/sm_ticket.py t-a291
    uv run dm-software-machine/scripts/sm_ticket.py --new "A distinct second ticket"

Equivalent: `just sm-ticket "…"`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dmsm  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Find an open ticket spec or create a briefing ticket.",
    )
    parser.add_argument(
        "--new",
        action="store_true",
        help="create even if an open ticket already matches",
    )
    parser.add_argument(
        "--problem",
        default="",
        help="optional verbatim Problem section on create",
    )
    parser.add_argument(
        "title",
        nargs="+",
        help="ticket title, or an existing id like t-a291",
    )
    args = parser.parse_args()
    ns = argparse.Namespace(
        title=" ".join(args.title).strip(),
        new=args.new,
        problem=args.problem,
        done="",
        writes=[],
        depends=[],
    )
    return dmsm.cmd_task_ticket(ns)


if __name__ == "__main__":
    raise SystemExit(main())
