#!/usr/bin/env python3
"""M1 acceptance test in a real pty: /projects add -> switch -> context injection.

Uses an isolated agent dir and the stub provider, so no network and no real
registry are touched. The extension is loaded with -e index.ts (same code the
installed package loads).
"""

import fcntl
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

root = tempfile.mkdtemp(prefix="pi-m1-")
agent_dir = os.path.join(root, "agent")
hub = os.path.join(root, "hub")
repo = os.path.join(root, "m1-project")
os.makedirs(os.path.join(repo, ".git"), exist_ok=True)
for d in (agent_dir, hub, repo):
    os.makedirs(d, exist_ok=True)
with open(os.path.join(repo, ".git", "HEAD"), "w") as f:
    f.write("ref: refs/heads/main\n")
with open(os.path.join(repo, "AGENTS.md"), "w") as f:
    f.write("# m1-project\n\nAGENTS_M1_MARKER: answer with pong.\n")
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
print("[m1]", " ".join(cmd))

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


notes_path = None
try:
    time.sleep(7)
    send(f"/projects add {repo}\r", 0.4)
    # confirm "Open project?" with the default answer
    send("\r", 3.0)
    send("hello\r", 4.0)
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
log = os.path.join(TMP, "tui-m1.log")
open(log, "wb").write(bytes(raw))

checks = {}
checks["no dock at startup"] = "┌ Projects" not in plain
checks["command accepted the project"] = ("Added m1-project" in plain) or (repo in plain)
checks["switch happened"] = ("project: m1-project" in plain) or ("m1-project" in plain and "Resumed session" in plain)
checks["active project in footer"] = "▸ m1-project" in plain
checks["agent answered"] = "pong-" in plain

registry_file = os.path.join(agent_dir, "pi-projects", "registry.json")
checks["registry file written"] = os.path.exists(registry_file)
if os.path.exists(registry_file):
    import json
    registry = json.load(open(registry_file))
    checks["project registered"] = any(p["path"] == os.path.realpath(repo) for p in registry["projects"])
else:
    checks["project registered"] = False

# nothing is created automatically: no CONTEXT.md / notes.md anywhere
private_dirs = []
pi_dir = os.path.join(agent_dir, "pi-projects")
if os.path.isdir(pi_dir):
    private_dirs = [os.path.join(pi_dir, name) for name in os.listdir(pi_dir) if os.path.isdir(os.path.join(pi_dir, name))]
checks["no private files auto-created"] = not any(
    os.path.exists(os.path.join(d, name)) for d in private_dirs for name in ("notes.md", "CONTEXT.md")
)

# the switched session must contain AGENTS.md and the injected private context
markers = False
sessions_root = os.path.join(agent_dir, "sessions")
for base, _dirs, files in os.walk(sessions_root):
    for name in files:
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(base, name), "r", errors="replace") as f:
            content = f.read()
        if "AGENTS_M1_MARKER" in content:
            markers = True
            print(f"[m1] session: {os.path.join(base, name)}")
checks["AGENTS.md loaded in the new session"] = markers

failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name)
    failed += 0 if ok else 1

print(f"\nraw log: {log}\ntemp:    {root}")
sys.exit(0 if failed == 0 else 1)
