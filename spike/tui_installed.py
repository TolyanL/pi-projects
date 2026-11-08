#!/usr/bin/env python3
"""Verify the locally installed pi package loads the M0 extension."""
import fcntl, os, re, signal, struct, subprocess, tempfile, termios, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
work = tempfile.mkdtemp(prefix="pi-installed-")
env = dict(os.environ)
env.update({"TERM": "xterm-256color", "PI_OFFLINE": "1", "PI_M0_PROJECTS": work})
cmd = ["pi", "--offline", "--provider", "stub", "--model", "stub-1", "--no-session",
       "--tui-mode", "fullscreen", "-e", os.path.join(HERE, "stub-provider.js")]
print("[installed]", " ".join(cmd))
master, slave = os.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, cwd=work, env=env,
                        preexec_fn=os.setsid, close_fds=True)
raw = bytearray(); stop = threading.Event()
def reader():
    while not stop.is_set():
        try: data = os.read(master, 65536)
        except OSError: break
        if not data: break
        raw.extend(data)
threading.Thread(target=reader, daemon=True).start()
time.sleep(8)
os.write(master, b"/projects status\r"); time.sleep(2)
os.write(master, b"\x04"); time.sleep(2)
stop.set()
try: os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
except ProcessLookupError: pass
proc.wait(timeout=10)
for fd in (master, slave):
    try: os.close(fd)
    except OSError: pass
text = raw.decode("utf-8", "replace")
plain = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
plain = re.sub(r"\x1b\][^\x07]*\x07", "", plain)
checks = {
    "/projects command registered": ("No active project" in plain) or ("Project:" in plain) or ("Registered:" in plain),
    "collapsed/empty: no panel mounted": "┌ Projects" not in plain,
    "footer hint for adding a project": "/projects add" in plain,
    "no load error for our package": "Failed to load extension" not in plain,
}
failed = 0
for name, ok in checks.items():
    print(("PASS  " if ok else "FAIL  ") + name); failed += 0 if ok else 1
if "Failed to load extension" in plain:
    for line in plain.splitlines():
        if "load" in line.lower() and "extension" in line.lower(): print("  !", line.strip()[:200])
open(os.path.join(HERE, ".tmp", "tui-installed.log"), "wb").write(bytes(raw))
print("work:", work)
raise SystemExit(0 if failed == 0 else 1)
