#!/usr/bin/env python3
"""Minimal ANSI screen emulator: print snapshots from a raw pty log."""
import re, sys

W = int(sys.argv[2]) if len(sys.argv) > 2 else 120
H = int(sys.argv[3]) if len(sys.argv) > 3 else 40
data = open(sys.argv[1], "rb").read().decode("utf-8", "replace")

class Screen:
    def __init__(self):
        self.g = [[" "] * W for _ in range(H)]
        self.r = self.c = 0
    def put(self, ch):
        if 0 <= self.r < H and 0 <= self.c < W:
            self.g[self.r][self.c] = ch
        self.c += 1
        if self.c >= W:
            self.c = 0
            self.r += 1
    def erase_line(self, mode):
        if mode == 2:
            self.g[self.r] = [" "] * W
        elif mode == 1:
            for i in range(0, min(self.c + 1, W)): self.g[self.r][i] = " "
        else:
            for i in range(self.c, W): self.g[self.r][i] = " "
    def feed(self, text):
        i = 0
        while i < len(text):
            ch = text[i]
            if ch == "\x1b":
                m = re.match(r"\x1b\[([0-9;?]*)([A-Za-z])", text[i:])
                if m:
                    params, cmd = m.group(1), m.group(2)
                    nums = [int(x) if x.isdigit() else 0 for x in params.replace("?", "").split(";") if x != ""]
                    n = nums[0] if nums else 1
                    if cmd in "Hf":
                        self.r = (nums[0] - 1) if nums else 0
                        self.c = (nums[1] - 1) if len(nums) > 1 else 0
                    elif cmd == "A": self.r = max(0, self.r - n)
                    elif cmd == "B": self.r = min(H - 1, self.r + n)
                    elif cmd == "C": self.c = min(W - 1, self.c + n)
                    elif cmd == "D": self.c = max(0, self.c - n)
                    elif cmd == "G": self.c = max(0, n - 1)
                    elif cmd == "K": self.erase_line(nums[0] if nums else 0)
                    elif cmd == "J":
                        if (nums[0] if nums else 0) == 2: self.g = [[" "] * W for _ in range(H)]
                    elif cmd == "m": pass
                    i += m.end(); continue
                m = re.match(r"\x1b\][^\x07]*\x07", text[i:])
                if m: i += m.end(); continue
                m = re.match(r"\x1b[()][A-Za-z0-9]", text[i:])
                if m: i += m.end(); continue
                i += 1; continue
            if ch == "\r": self.c = 0
            elif ch == "\n":
                self.r += 1
                if self.r >= H:
                    self.g.pop(0); self.g.append([" "] * W); self.r = H - 1
            elif ch == "\b": self.c = max(0, self.c - 1)
            elif ch == "\t": self.c = min(W - 1, (self.c // 8 + 1) * 8)
            elif ch >= " ": self.put(ch)
            i += 1
    def dump(self, label):
        print(f"--- {label} ---")
        for line in self.g:
            print("".join(line).rstrip())

raw = data
screen = Screen()
screen.feed(raw)
screen.dump("final")
