#!/usr/bin/env python
"""pane_probe.py — Pane Controller fleet forensics helper.

Inspect the Windows Terminal pane fleet that pane_controller manages:
list panes, read flight logs, strip ANSI noise, and search transcripts.

Usage:
    python pane_probe.py list                     # inventory all panes
    python pane_probe.py log    <pane_id>         # show a pane flight log
    python pane_probe.py raw    <pane_id>         # ANSI-stripped raw log
    python pane_probe.py find   <regex>          # grep across every flight log
    python pane_probe.py active                  # panes modified in the last 2 hours
    python pane_probe.py hygiene                 # verify proxy env vars are clean
"""

import os
import re
import sys
import time
import json
from pathlib import Path

PANES_ROOT = Path(r"C:\Users\ahmed\.config\opencode\panes")

ANSI_RE = re.compile(
    r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|O[0-9;]*[A-Za-z]?)"
)
BELL_RE = re.compile(r"\x07")


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences and control characters."""
    text = ANSI_RE.sub("", text)
    text = BELL_RE.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text


def panes() -> list:
    """Return every pane directory sorted by last-modified, newest first."""
    if not PANES_ROOT.exists():
        return []
    out = []
    for d in PANES_ROOT.iterdir():
        if not d.is_dir():
            continue
        try:
            mtime = d.stat().st_mtime
        except OSError:
            continue
        log = d / "flight.log"
        transcript = d / "transcript_full.jsonl"
        out.append(
            {
                "name": d.name,
                "path": d,
                "mtime": mtime,
                "age_s": time.time() - mtime,
                "has_log": log.exists(),
                "log_size": log.stat().st_size if log.exists() else 0,
                "has_transcript": transcript.exists(),
                "transcript_size": transcript.stat().st_size if transcript.exists() else 0,
            }
        )
    out.sort(key=lambda p: p["mtime"], reverse=True)
    return out


def human_age(seconds: float) -> str:
    seconds = max(0, int(seconds))
    if seconds < 60:
        return f"{seconds}s ago"
    if seconds < 3600:
        return f"{seconds // 60}m ago"
    if seconds < 86400:
        return f"{seconds // 3600}h ago"
    return f"{seconds // 86400}d ago"


def cmd_list() -> int:
    items = panes()
    if not items:
        print(f"No panes found under {PANES_ROOT}")
        return 0
    print(f"{'PANE ID':<32} {'AGE':<12} {'LOG':<10} {'TRANSCRIPT':<12}")
    print("-" * 70)
    for p in items:
        log = f"{p['log_size']}B" if p["has_log"] else "-"
        tr = f"{p['transcript_size']}B" if p["has_transcript"] else "-"
        print(f"{p['name']:<32} {human_age(p['age_s']):<12} {log:<10} {tr:<12}")
    print(f"\nTotal: {len(items)} pane directories")
    return 0


def find_pane(pane_id: str):
    for p in panes():
        if p["name"] == pane_id or p["name"].lower().endswith(pane_id.lower()):
            return p
    return None


def cmd_log(pane_id: str, raw: bool) -> int:
    p = find_pane(pane_id)
    if p is None:
        print(f"Pane not found: {pane_id}")
        print("Run: python pane_probe.py list")
        return 1
    log = p["path"] / "flight.log"
    if not log.exists():
        print(f"No flight.log in {p['path']}")
        return 1
    data = log.read_text(encoding="utf-8", errors="replace")
    if not raw:
        data = strip_ansi(data)
    print(f"=== flight.log :: {p['name']} ({log.stat().st_size} bytes) ===")
    print(data)
    return 0


def cmd_find(pattern: str) -> int:
    rx = re.compile(pattern, re.IGNORECASE)
    hits = 0
    for p in panes():
        log = p["path"] / "flight.log"
        if not log.exists():
            continue
        try:
            data = strip_ansi(log.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
        for i, line in enumerate(data.splitlines(), 1):
            if rx.search(line):
                print(f"{p['name']}:{i}: {line.rstrip()[:200]}")
                hits += 1
    if not hits:
        print(f"No matches for {pattern!r}")
    else:
        print(f"\n{hits} match(es)")
    return 0


def cmd_active(minutes: int = 120) -> int:
    cutoff = time.time() - minutes * 60
    recent = [p for p in panes() if p["mtime"] >= cutoff]
    if not recent:
        print(f"No panes touched in the last {minutes} minutes")
        return 0
    print(f"Panes active in the last {minutes} minutes:\n")
    for p in recent:
        print(f"  {p['name']:<32} {human_age(p['age_s'])}")
    print(f"\n{len(recent)} active pane(s)")
    return 0


def cmd_hygiene() -> int:
    bad = []
    for var in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        val = os.environ.get(var)
        if val:
            bad.append((var, val))
    if bad:
        print("PROXY RESIDUE DETECTED (2026-08-06 blackout class):")
        for var, val in bad:
            print(f"  {var} = {val}")
        print("\nRemediation (run in the affected terminal):")
        print("  $env:HTTP_PROXY=$null; $env:HTTPS_PROXY=$null; $env:ALL_PROXY=$null")
        return 2
    print("CLEAN - HTTP_PROXY, HTTPS_PROXY, ALL_PROXY are all unset")
    return 0


USAGE = __doc__


def main() -> int:
    if len(sys.argv) < 2:
        print(USAGE)
        return 1

    cmd = sys.argv[1].lower()

    if cmd == "list":
        return cmd_list()
    if cmd == "log" and len(sys.argv) >= 3:
        return cmd_log(sys.argv[2], raw=False)
    if cmd == "raw" and len(sys.argv) >= 3:
        return cmd_log(sys.argv[2], raw=True)
    if cmd == "find" and len(sys.argv) >= 3:
        return cmd_find(sys.argv[2])
    if cmd == "active":
        mins = int(sys.argv[2]) if len(sys.argv) >= 3 else 120
        return cmd_active(mins)
    if cmd == "hygiene":
        return cmd_hygiene()

    print(USAGE)
    return 1


if __name__ == "__main__":
    sys.exit(main())
