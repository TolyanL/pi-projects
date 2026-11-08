#!/usr/bin/env python3
"""S2 smoke test: run the real pi TUI in a pty, exercise /m0 commands and
assert that the left overlay panel and the switch actually rendered.

Writes the raw terminal stream to spike/.tmp/tui.log for inspection.
"""

import fcntl
import os
import re
import shutil
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

root = tempfile.mkdtemp(prefix="pi-m0-tui-")
agent_dir = os.path.join(root, "agent")
hub = os.path.join(root, "hub")
proj1 = os.path.join(root, "alpha")
proj2 = os.path.join(root, "beta")
for d in (agent_dir, hub, proj1, proj2):
    os.makedirs(d, exist_ok=True)
with open(os.path.join(proj2, "AGENTS.md"), "w") as f:
    f.write("# beta\n\nAGENTS_TUI_MARKER: reply with the word pong.\n")
context = os.path.join(agent_dir, "m0-context.md")
with open(context, "w") as f:
    f.write("# private\n\nPRIVATE_TUI_MARKER: never copy into the repo.\n")

env = dict(os.environ)
env.update(
    {
        "TERM": "xterm-256color",
        "PI_CODING_AGENT_DIR": agent_dir,
        "PI_M0_PROJECTS": f"{proj1}:{proj2}",
        "PI_M0_CONTEXT": context,
        "PI_STUB_URL": "http://127.0.0.1:8765/v1",
        "PI_OFFLINE": "1",
        "COLUMNS": "120",
        "LINES": "40",
    }
)

cmd = [
    "pi",
    "--provider",
    "stub",
    "--model",
    "stub-1",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-mcp",
    "--tui-mode",
    "fullscreen",
    "-e",
    os.path.join(HERE, "m0.js"),
    "-e",
    os.path.join(HERE, "stub-provider.js"),
]
print("[smoke]", " ".join(cmd))

master, slave = os.openpty()
win = struct.pack("HHHH", 40, 120, 0, 0)
fcntl.ioctl(slave, termios.TIOCSWINSZ, win)

proc = subprocess.Popen(
    cmd,
    stdin=slave,
    stdout=slave,
    stderr=slave,
    cwd=hub,
    env=env,
    preexec_fn=os.setsid,
    close_fds=True,
)

raw = bytearray()
switch_mark = 0
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


thread = threading.Thread(target=reader, daemon=True)
thread.start()


def send(text: str, delay: float = 1.0):
    time.sleep(delay)
    os.write(master, text.encode())


def strip_terminal(data: bytes) -> str:
    text = data.decode("utf-8", "replace")
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
    text = re.sub(r"\x1b\][^\x07]*\x07", "", text)
    text = re.sub(r"\x1b[()][A-Za-z0-9]", "", text)
    return text


try:
    time.sleep(6)
    send("/m0 list\r", 0.2)
    send(f"/m0 open {proj2}\r", 2.5)
    send("hello\r", 3.5)
    # S2: resize the live TUI while the overlay is visible
    switch_mark = len(strip_terminal(bytes(raw)))
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
    os.killpg(os.getpgid(proc.pid), signal.SIGWINCH)
    time.sleep(1.5)
    os.write(master, b"\x04")
    time.sleep(2)
finally:
    stop.set()
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    proc.wait(timeout=10)
    thread.join(timeout=5)
    for fd in (master, slave):
        try:
            os.close(fd)
        except OSError:
            pass

log_path = os.path.join(TMP, "tui.log")
with open(log_path, "wb") as f:
    f.write(bytes(raw))

plain = strip_terminal(bytes(raw))

after_resize = plain[switch_mark:]
checks = {
    "panel rendered": "Projects" in plain,
    "project alpha listed": "alpha" in plain,
    "project beta listed": "beta" in plain,
    "switch happened": "Resumed session" in plain or "Switched to beta" in plain,
    "active marker moved to beta": "▸ beta" in plain,
    "agent answered": "pong-" in plain,
    "panel survived resize": "Projects" in after_resize,
    "tui log written": os.path.getsize(log_path) > 0,
}
failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name)
    failed += 0 if ok else 1

session_dir_root = os.path.join(agent_dir, "sessions")
beta_marker = False
beta_file = None
for base, _dirs, files in os.walk(session_dir_root):
    if "beta" not in base:
        continue
    for name in files:
        if not name.endswith(".jsonl"):
            continue
        with open(os.path.join(base, name), "r", errors="replace") as f:
            content = f.read()
        if "AGENTS_TUI_MARKER" in content and "PRIVATE_TUI_MARKER" in content:
            beta_marker = True
            beta_file = os.path.join(base, name)
            print(f"[smoke] beta session: {beta_file}")
print(("PASS  " if beta_marker else "FAIL  ") + "context markers persisted in beta session")
failed += 0 if beta_marker else 1

# --- phase 2: resume the hand-written session in a fresh process ------------
if beta_file:
    cmd2 = [
        "pi",
        "--session",
        beta_file,
        "--provider",
        "stub",
        "--model",
        "stub-1",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-mcp",
        "--tui-mode",
        "fullscreen",
        "-e",
        os.path.join(HERE, "m0.js"),
        "-e",
        os.path.join(HERE, "stub-provider.js"),
    ]
    master2, slave2 = os.openpty()
    fcntl.ioctl(slave2, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    proc2 = subprocess.Popen(
        cmd2,
        stdin=slave2,
        stdout=slave2,
        stderr=slave2,
        cwd=hub,
        env=env,
        preexec_fn=os.setsid,
        close_fds=True,
    )
    raw2 = bytearray()
    stop2 = threading.Event()

    def reader2():
        while not stop2.is_set():
            try:
                data = os.read(master2, 65536)
            except OSError:
                break
            if not data:
                break
            raw2.extend(data)

    t2 = threading.Thread(target=reader2, daemon=True)
    t2.start()
    time.sleep(6)
    os.write(master2, b"\x04")
    time.sleep(2)
    stop2.set()
    try:
        os.killpg(os.getpgid(proc2.pid), signal.SIGTERM)
    except ProcessLookupError:
        pass
    proc2.wait(timeout=10)
    t2.join(timeout=5)
    for fd in (master2, slave2):
        try:
            os.close(fd)
        except OSError:
            pass
    with open(os.path.join(TMP, "tui-resume.log"), "wb") as f:
        f.write(bytes(raw2))
    plain2 = strip_terminal(bytes(raw2))
    resume_ok = "pong-" in plain2 and "beta" in plain2
    print(("PASS  " if resume_ok else "FAIL  ") + "resume restores history and cwd")
    failed += 0 if resume_ok else 1

print(f"\nraw log: {log_path}")
print(f"temp root: {root}")
sys.exit(0 if failed == 0 else 1)
