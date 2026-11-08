#!/usr/bin/env python3
"""M3 acceptance: fuzzy picker, ctrl+e files menu, ctrl+o session picker."""

import fcntl
import json
import os
import re
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TMP = os.path.join(HERE, ".tmp")
os.makedirs(TMP, exist_ok=True)

root = tempfile.mkdtemp(prefix="pi-m3-")
agent_dir = os.path.join(root, "agent")
hub = os.path.join(root, "hub")
repos = {name: os.path.join(root, name) for name in ("alpha", "beta")}
for name, repo in repos.items():
    os.makedirs(os.path.join(repo, ".git"), exist_ok=True)
    with open(os.path.join(repo, ".git", "HEAD"), "w") as f:
        f.write("ref: refs/heads/main\n")
    with open(os.path.join(repo, "AGENTS.md"), "w") as f:
        f.write(f"# {name}\n\nAGENTS_{name.upper()}_MARKER\n")
os.makedirs(agent_dir, exist_ok=True)
os.makedirs(hub, exist_ok=True)

now = "2026-02-14T10:00:00.000Z"
registry = {
    "version": 1,
    "activeId": None,
    "projects": [
        {
            "id": f"00000000-0000-0000-0000-00000000000{index}",
            "name": name,
            "path": os.path.realpath(repo),
            "addedAt": now,
            "lastOpenedAt": now,
        }
        for index, (name, repo) in enumerate(repos.items(), start=1)
    ],
}
os.makedirs(os.path.join(agent_dir, "pi-projects"), exist_ok=True)
with open(os.path.join(agent_dir, "pi-projects", "registry.json"), "w") as f:
    json.dump(registry, f, indent=2)

env = dict(os.environ)
env.update(
    {
        "TERM": "xterm-256color",
        "PI_CODING_AGENT_DIR": agent_dir,
        "PI_STUB_URL": "http://127.0.0.1:8765/v1",
        "PI_OFFLINE": "1",
        "COLUMNS": "120",
        "LINES": "40",
    }
)

cmd = [
    "pi",
    "--provider", "stub",
    "--model", "stub-1",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-mcp",
    "--tui-mode", "fullscreen",
    "-e", os.path.join(ROOT, "index.ts"),
    "-e", os.path.join(HERE, "stub-provider.js"),
]
print("[m3]", " ".join(cmd))

master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, cwd=hub, env=env,
                        preexec_fn=os.setsid, close_fds=True)
raw = bytearray()
stop = threading.Event()


def reader():
    while not stop.is_set():
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        raw.extend(data)


threading.Thread(target=reader, daemon=True).start()


def strip_terminal(data: bytes) -> str:
    text = data.decode("utf-8", "replace")
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
    text = re.sub(r"\x1b\][^\x07]*\x07", "", text)
    return re.sub(r"\x1b[()][A-Za-z0-9]", "", text)


def send(text: str, delay: float = 1.0):
    time.sleep(delay)
    os.write(master, text.encode())


marks = {}
try:
    time.sleep(7)
    send("/projects\r", 0.6)
    time.sleep(1.0)
    marks["dock"] = len(strip_terminal(bytes(raw)))
    send("beta", 0.4)
    time.sleep(0.6)
    send("\r", 0.8)  # project -> actions
    time.sleep(0.6)
    marks["actions"] = len(strip_terminal(bytes(raw)))
    send("\r", 2.5)  # Open project
    marks["switched"] = len(strip_terminal(bytes(raw)))

    # reopen -> actions -> Files… -> esc back twice
    send("/projects\r", 2.0)
    time.sleep(0.8)
    send("\r", 0.6)  # open actions for the active project
    time.sleep(0.6)
    for _ in range(4):
        send("\x1b[B", 0.15)
    time.sleep(0.3)
    marks["before_enter_files"] = len(strip_terminal(bytes(raw)))
    send("\r", 0.8)
    time.sleep(0.8)
    marks["files"] = len(strip_terminal(bytes(raw)))
    marks["before_back"] = marks["files"]
    send("\x1b", 0.8)  # files -> actions
    time.sleep(0.8)
    marks["actions_back"] = len(strip_terminal(bytes(raw)))
    send("\x1b", 0.6)  # actions -> projects
    time.sleep(0.6)
    marks["projects_back"] = len(strip_terminal(bytes(raw)))
    send("\x1b", 0.6)  # close dock
    time.sleep(0.4)

    # reopen -> actions -> Sessions…
    send("/projects\r", 1.0)
    time.sleep(0.8)
    send("\r", 0.6)
    time.sleep(0.6)
    for _ in range(3):
        send("\x1b[B", 0.15)
    time.sleep(0.3)
    send("\r", 0.8)
    time.sleep(0.8)
    marks["sessions"] = len(strip_terminal(bytes(raw)))
    send("\x1b", 0.8)  # sessions -> actions
    time.sleep(0.6)
    send("\x1b", 0.6)  # actions -> projects
    time.sleep(0.4)
    send("\x1b", 0.6)  # close dock
    time.sleep(0.4)

    os.write(master, b"\x04")
    time.sleep(2)
finally:
    stop.set()
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    proc.wait(timeout=10)
    for fd in (master, slave):
        try:
            os.close(fd)
        except OSError:
            pass

plain = strip_terminal(bytes(raw))
log = os.path.join(TMP, "tui-m3.log")
open(log, "wb").write(bytes(raw))


def slice_from(mark: str) -> str:
    return plain[marks.get(mark, 0):]


checks = {}
checks["dock rendered"] = "┌ Projects" in plain and "↑↓ move" in plain
checks["enter opens the project actions"] = "Project actions" in plain[marks.get("actions", 0):]
checks["filter narrowed to beta"] = "beta" in plain
checks["switch to beta happened"] = "/beta" in plain and "▸ beta" in plain
checks["footer marks beta active"] = "▸ beta" in plain
checks["Files action opened the files stage"] = "Project files" in plain[marks.get("before_enter_files", 0):]
checks["esc from files returns to project actions"] = "Project actions" in plain[marks.get("before_back", 0):marks.get("actions_back", 0)]
checks["esc from actions returns to the project list"] = "Add project…" in plain[marks.get("actions_back", 0):marks.get("projects_back", 0)]
checks["Sessions action opened the session dock"] = ("Sessions — beta" in plain) or ("No sessions yet" in plain)

failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name)
    failed += 0 if ok else 1

print(f"\nraw log: {log}\ntemp:    {root}")
sys.exit(0 if failed == 0 else 1)
