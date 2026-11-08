#!/usr/bin/env python3
"""Dock behaviour: nothing at startup, /projects opens it inline, esc closes it."""
import fcntl, glob, json, os, re, signal, struct, subprocess, sys, tempfile, termios, threading, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TMP = os.path.join(HERE, ".tmp"); os.makedirs(TMP, exist_ok=True)
root = tempfile.mkdtemp(prefix="pi-dock-")
agent = os.path.join(root, "agent"); hub = os.path.join(root, "hub"); repo = os.path.join(root, "demo")
for d in (agent, hub, repo): os.makedirs(d, exist_ok=True)
os.makedirs(os.path.join(repo, ".git"), exist_ok=True)
open(os.path.join(repo, ".git", "HEAD"), "w").write("ref: refs/heads/main\n")
now = "2026-02-14T10:00:00.000Z"
os.makedirs(os.path.join(agent, "pi-projects"), exist_ok=True)
json.dump({"version": 1, "activeId": None, "projects": [
    {"id": "00000000-0000-0000-0000-000000000001", "name": "demo",
     "path": os.path.realpath(repo), "addedAt": now, "lastOpenedAt": now}]},
    open(os.path.join(agent, "pi-projects", "registry.json"), "w"), indent=2)
env = dict(os.environ); env.update({"TERM": "xterm-256color", "PI_CODING_AGENT_DIR": agent,
    "PI_STUB_URL": "http://127.0.0.1:8765/v1", "PI_OFFLINE": "1", "COLUMNS": "120", "LINES": "40"})
cmd = ["pi", "--provider", "stub", "--model", "stub-1", "--no-session", "--no-extensions",
       "--no-skills", "--no-prompt-templates", "--no-mcp", "--tui-mode", "fullscreen",
       "-e", os.path.join(ROOT, "index.ts"), "-e", os.path.join(HERE, "stub-provider.js")]
master, slave = os.openpty(); fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, cwd=hub, env=env,
                        preexec_fn=os.setsid, close_fds=True)
raw = bytearray(); stop = threading.Event()
def reader():
    while not stop.is_set():
        try: d = os.read(master, 65536)
        except OSError: break
        if not d: break
        raw.extend(d)
threading.Thread(target=reader, daemon=True).start()
def send(t, d=1.0): time.sleep(d); os.write(master, t.encode())
def plain(b):
    s = b.decode("utf-8", "replace"); s = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", s)
    return re.sub(r"\x1b\][^\x07]*\x07", "", s)
checks = {}
try:
    time.sleep(7)
    t0 = len(raw)
    checks["no dock at startup"] = "┌ Projects" not in plain(bytes(raw[:t0]))
    send("/projects\r", 0.4); time.sleep(1.2)
    t1 = len(raw)
    checks["/projects opens the dock"] = "┌ Projects" in plain(bytes(raw[:t1]))
    checks["transcript stays above"] = "v1.5.0" in plain(bytes(raw[:t1]))
    checks["Add project row is in the list"] = "Add project…" in plain(bytes(raw[:t1]))

    send("\r", 0.5); time.sleep(0.8)  # project -> actions
    t2 = len(raw)
    checks["enter opens project actions"] = "Project actions" in plain(bytes(raw[:t2]))
    checks["actions are rows in the UI"] = "Files…" in plain(bytes(raw[:t2])) and "Sessions…" in plain(bytes(raw[:t2]))

    for _ in range(4):
        send("\x1b[B", 0.15)
    time.sleep(0.3)
    send("\r", 0.8); time.sleep(0.8)
    t3 = len(raw)
    checks["Files action opens the files stage"] = "Project files" in plain(bytes(raw[:t3]))
    checks["files stage lists the four rows"] = all(
        label in plain(bytes(raw[:t3])) for label in ("CONTEXT.md", "NOTES.md", "Notes…", "AGENTS.md")
    )
    checks["missing files are marked not created"] = "not created" in plain(bytes(raw[:t3]))

    # enter on CONTEXT.md -> confirm create -> editor -> esc -> back to files
    send("\r", 0.5); time.sleep(0.9)
    send("\r", 0.9); time.sleep(1.0)   # confirm "Create CONTEXT.md?"
    t_before_editor_esc = len(raw)
    send("\x1b", 1.0); time.sleep(1.0)  # cancel the editor
    t_created = len(raw)
    contexts = glob.glob(os.path.join(agent, "pi-projects", "*", "CONTEXT.md"))
    checks["confirm creates CONTEXT.md"] = len(contexts) == 1
    checks["editor returns to the files stage"] = "Project files" in plain(bytes(raw[t_before_editor_esc:t_created]))

    # down twice -> Notes… -> notes list; esc back to files
    send("\x1b[B", 0.2); send("\x1b[B", 0.2); time.sleep(0.3)
    send("\r", 0.6); time.sleep(0.9)
    t_notes = len(raw)
    checks["Notes row opens the notes list"] = "＋ New note…" in plain(bytes(raw[:t_notes]))
    t_notes_back = len(raw)
    send("\x1b", 0.8); time.sleep(0.8)
    t_notes_done = len(raw)
    checks["esc from notes returns to files"] = "Project files" in plain(bytes(raw[t_notes_back:t_notes_done]))

    t_back = len(raw)
    send("\x1b", 0.8); time.sleep(0.8)
    t4 = len(raw)
    checks["esc from files returns to actions"] = "Project actions" in plain(bytes(raw[t_back:t4]))
    t_back2 = len(raw)
    send("\x1b", 0.8); time.sleep(0.8)
    t5 = len(raw)
    checks["esc from actions returns to projects"] = "Add project…" in plain(bytes(raw[t_back2:t5]))
    send("\x1b", 0.8); time.sleep(0.8)
    t6 = len(raw)
    checks["esc closes the dock"] = "┌ Projects" not in plain(bytes(raw[t6:]))

    send("/projects panel\r", 0.8); time.sleep(1.2)
    t7 = len(raw)
    checks["/projects panel alias opens it"] = "┌ Projects" in plain(bytes(raw[:t7]))
    send("\x1b", 0.8); time.sleep(0.6)
    send("hello\r", 1.0); time.sleep(1.5)
    t8 = len(raw)
    checks["no dock during a run"] = "┌ Projects" not in plain(bytes(raw[t8:]))

    # /project opens the files menu for the current project; esc closes it
    send("/project\r", 0.8); time.sleep(1.2)
    t9 = len(raw)
    checks["/project opens the files menu"] = "Project files" in plain(bytes(raw[:t9]))
    t9b = len(raw)
    send("\x1b", 0.8); time.sleep(0.8)
    t10 = len(raw)
    checks["esc closes the /project menu"] = "Project files" not in plain(bytes(raw[t9b:t10])) and "Project files" not in plain(bytes(raw[t10:]))
    os.write(master, b"\x04"); time.sleep(2)
finally:
    stop.set()
    try: os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError: pass
    proc.wait(timeout=10)
    for fd in (master, slave):
        try: os.close(fd)
        except OSError: pass
open(os.path.join(TMP, "dock.log"), "wb").write(bytes(raw))
failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name); failed += 0 if ok else 1
sys.exit(0 if failed == 0 else 1)
