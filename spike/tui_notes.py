#!/usr/bin/env python3
"""Notes model end-to-end: indexes, context injection, legacy cleanup."""
import fcntl, json, os, re, signal, struct, subprocess, sys, tempfile, termios, threading, time

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
TMP = os.path.join(HERE, ".tmp"); os.makedirs(TMP, exist_ok=True)
root = tempfile.mkdtemp(prefix="pi-notes-e2e-")
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
private = os.path.join(agent, "pi-projects", "demo-00000000")
notes_dir = os.path.join(private, "notes")
os.makedirs(notes_dir, exist_ok=True)
open(os.path.join(notes_dir, "auth.md"), "w").write(
    "---\ntitle: How auth works\ndescription: Token refresh and middleware\ncreated: 2026-02-14\nupdated: 2026-02-14\n---\n\n"
    "# How auth works\n\nRefresh tokens live here.\n"
)
# legacy file must be removed at startup
open(os.path.join(private, "notes.md"), "w").write("old strict schema\n")

env = dict(os.environ); env.update({"TERM": "xterm-256color", "PI_CODING_AGENT_DIR": agent,
    "PI_STUB_URL": "http://127.0.0.1:8765/v1", "PI_OFFLINE": "1", "COLUMNS": "120", "LINES": "40"})
cmd = ["pi", "--provider", "stub", "--model", "stub-1", "--no-session", "--no-extensions",
       "--no-skills", "--no-prompt-templates", "--no-mcp", "--tui-mode", "fullscreen",
       "-e", os.path.join(ROOT, "index.ts"), "-e", os.path.join(HERE, "stub-provider.js")]
print("[notes]", " ".join(cmd))
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
state = {}

def read_text(path):
    try: return open(path).read()
    except OSError: return ""

try:
    time.sleep(7)
    send("/projects\r", 0.6); time.sleep(0.6)
    send("\r", 0.5); time.sleep(0.6)   # project -> actions
    for _ in range(7):
        send("\x1b[B", 0.15)
    time.sleep(0.3)
    send("\r", 0.8); time.sleep(0.8)   # toggle private
    state["private_index"] = read_text(os.path.join(agent, "pi-projects", "INDEX.md"))
    state["private_notes"] = read_text(os.path.join(private, "NOTES.md"))
    state["private_registry"] = read_text(os.path.join(agent, "pi-projects", "registry.json"))
    state["lock_visible"] = "🔒" in plain(bytes(raw))

    send("\r", 0.8); time.sleep(0.8)   # toggle shared
    state["shared_index"] = read_text(os.path.join(agent, "pi-projects", "INDEX.md"))
    state["shared_registry"] = read_text(os.path.join(agent, "pi-projects", "registry.json"))

    send("\r", 0.8); time.sleep(0.8)   # leave it private
    state["final_registry"] = read_text(os.path.join(agent, "pi-projects", "registry.json"))

    send("\x1b", 0.5); time.sleep(0.4)  # actions -> projects
    send("\x1b", 0.5); time.sleep(0.4)  # close dock
    send("/projects\r", 0.6); time.sleep(0.6)
    send("\r", 0.5); time.sleep(0.5)   # project -> actions
    send("\r", 2.5)                     # open project (last session)
    send("hello\r", 2.0); time.sleep(2.0)
    send("/project\r", 0.8); time.sleep(1.2)
    state["project_menu"] = len(raw)
    send("\x1b", 0.6); time.sleep(0.4)
    os.write(master, b"\x04"); time.sleep(2)
finally:
    stop.set()
    try: os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except ProcessLookupError: pass
    proc.wait(timeout=10)
    for fd in (master, slave):
        try: os.close(fd)
        except OSError: pass
text = plain(bytes(raw))
open(os.path.join(TMP, "notes-e2e.log"), "wb").write(bytes(raw))

checks = {}
checks["NOTES.md generated at startup"] = os.path.exists(os.path.join(private, "NOTES.md"))
checks["INDEX.md generated at startup"] = os.path.exists(os.path.join(agent, "pi-projects", "INDEX.md"))
checks["legacy notes.md removed"] = not os.path.exists(os.path.join(private, "notes.md"))
if os.path.exists(os.path.join(private, "NOTES.md")):
    idx = open(os.path.join(private, "NOTES.md")).read()
    checks["NOTES.md has title/description/path"] = "**How auth works**" in idx and "Token refresh and middleware" in idx and "notes/auth.md" in idx
gidx = state.get("shared_index", "")
checks["INDEX.md has project and path"] = "## demo" in gidx and "demo-00000000/notes/auth.md" in gidx

checks["protect toggle writes registry"] = '"private": true' in state.get("private_registry", "")
checks["private project leaves the global index"] = "How auth works" not in state.get("private_index", "")
checks["private project keeps its own NOTES.md"] = "How auth works" in state.get("private_notes", "")
checks["lock marker is visible"] = state.get("lock_visible", False)
checks["shared toggle restores the global index"] = "How auth works" in state.get("shared_index", "")
checks["shared toggle writes registry"] = '"private": false' in state.get("shared_registry", "")
checks["project is private again at the end"] = '"private": true' in state.get("final_registry", "")
checks["/project shows the protection state"] = "Protection: private" in plain(bytes(raw[:state.get("project_menu", 0)]))

injected = False
sessions_root = os.path.join(agent, "sessions")
for base, _dirs, files in os.walk(sessions_root):
    for name in files:
        if not name.endswith(".jsonl"): continue
        content = open(os.path.join(base, name), errors="replace").read()
        if "pi_projects_notes" in content and "How auth works" in content:
            injected = True
            print(f"[notes] session: {os.path.join(base, name)}")
checks["note index injected into the prompt"] = injected

failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name); failed += 0 if ok else 1
print(f"\nraw log: {os.path.join(TMP, 'notes-e2e.log')}\ntemp: {root}")
sys.exit(0 if failed == 0 else 1)
