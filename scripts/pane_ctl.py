#!/usr/bin/env python
"""pane_ctl.py — Antigravity & Overlord CLI bridge for pane_controller.

Allows Antigravity, subagents, and direct shell scripts to call the
pane_controller engine directly via bun execution of ~/.config/opencode/tools/pane_controller.ts.

Usage:
    python pane_ctl.py list
    python pane_ctl.py split "<command>" [--title "<title>"] [--split vertical|horizontal] [--size 0.45]
    python pane_ctl.py send <pane_id> "<text>" [--submit] [--paste]
    python pane_ctl.py key <pane_id> <key_name> (Enter, Ctrl+C, Esc, Tab, Up, Down)
    python pane_ctl.py read <pane_id> [--lines 30] [--raw]
    python pane_ctl.py wait <pane_id> "<regex_pattern>" [--timeout 15000]
    python pane_ctl.py wait_idle <pane_id> [--idle 1500] [--timeout 30000]
    python pane_ctl.py kill <pane_id>
    python pane_ctl.py clear
    python pane_ctl.py json '{"action": "list"}'
"""

import sys
import json
import subprocess
import os

TOOL_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "engine", "pane_controller.ts"))
BUN_EXE = r"C:\Users\ahmed\.bun\bin\bun.exe"

def execute_pane_controller(args_dict):
    code = f"""
    import tool from '{TOOL_PATH.replace(chr(92), "/")}';
    const args = {json.dumps(args_dict)};
    tool.execute(args, {{ directory: process.cwd() }})
        .then(res => {{
            if (typeof res === 'string') console.log(res);
            else console.log(JSON.stringify(res, null, 2));
        }})
        .catch(err => {{
            console.error('Execution error:', err);
            process.exit(1);
        }});
    """
    res = subprocess.run([BUN_EXE, "-e", code], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout:
        sys.stdout.write(res.stdout)
    if res.stderr:
        sys.stderr.write(res.stderr)
    return res.returncode

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "json" and len(sys.argv) >= 3:
        args = json.loads(sys.argv[2])
        sys.exit(execute_pane_controller(args))

    if cmd in ("list", "ls"):
        sys.exit(execute_pane_controller({"action": "list"}))

    if cmd == "clear":
        sys.exit(execute_pane_controller({"action": "clear"}))

    if cmd == "split" and len(sys.argv) >= 3:
        command = sys.argv[2]
        title = "Interactive Pane"
        split = "vertical"
        size = 0.45
        i = 3
        while i < len(sys.argv):
            if sys.argv[i] == "--title" and i + 1 < len(sys.argv):
                title = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == "--split" and i + 1 < len(sys.argv):
                split = sys.argv[i + 1]; i += 2
            elif sys.argv[i] == "--size" and i + 1 < len(sys.argv):
                size = float(sys.argv[i + 1]); i += 2
            else:
                i += 1
        sys.exit(execute_pane_controller({"action": "split", "command": command, "title": title, "split": split, "size": size}))

    if cmd in ("send", "input", "write") and len(sys.argv) >= 4:
        pane_id = sys.argv[2]
        text = sys.argv[3]
        submit = "--submit" in sys.argv
        paste = "--paste" in sys.argv
        sys.exit(execute_pane_controller({"action": "send_input", "pane_id": pane_id, "text": text, "submit": submit, "paste": paste}))

    if cmd == "key" and len(sys.argv) >= 4:
        pane_id = sys.argv[2]
        key = sys.argv[3]
        sys.exit(execute_pane_controller({"action": "send_key", "pane_id": pane_id, "key": key}))

    if cmd in ("read", "output", "scrape") and len(sys.argv) >= 3:
        pane_id = sys.argv[2]
        lines = 30
        clean = "--raw" not in sys.argv
        for idx, a in enumerate(sys.argv):
            if a == "--lines" and idx + 1 < len(sys.argv):
                lines = int(sys.argv[idx + 1])
        sys.exit(execute_pane_controller({"action": "read_output", "pane_id": pane_id, "lines": lines, "clean": clean}))

    if cmd == "wait" and len(sys.argv) >= 4:
        pane_id = sys.argv[2]
        pattern = sys.argv[3]
        timeout_ms = 15000
        for idx, a in enumerate(sys.argv):
            if a == "--timeout" and idx + 1 < len(sys.argv):
                timeout_ms = int(sys.argv[idx + 1])
        sys.exit(execute_pane_controller({"action": "wait_for", "pane_id": pane_id, "pattern": pattern, "timeout_ms": timeout_ms}))

    if cmd == "wait_idle" and len(sys.argv) >= 3:
        pane_id = sys.argv[2]
        idle_ms = 1500
        timeout_ms = 30000
        for idx, a in enumerate(sys.argv):
            if a == "--idle" and idx + 1 < len(sys.argv):
                idle_ms = int(sys.argv[idx + 1])
            elif a == "--timeout" and idx + 1 < len(sys.argv):
                timeout_ms = int(sys.argv[idx + 1])
        sys.exit(execute_pane_controller({"action": "wait_idle", "pane_id": pane_id, "idle_ms": idle_ms, "timeout_ms": timeout_ms}))

    if cmd == "kill" and len(sys.argv) >= 3:
        pane_id = sys.argv[2]
        sys.exit(execute_pane_controller({"action": "kill", "pane_id": pane_id}))

    print(f"Unknown command: {cmd}")
    print(__doc__)
    sys.exit(1)

if __name__ == "__main__":
    main()
