#!/usr/bin/env python3
"""Render a `script -F` pty capture with a real terminal emulator (pyte) at the
byte offsets recorded in a marks file: prints the screen as a person saw it."""
import sys
sys.path.insert(0, __import__("os").environ.get("PYTE_PATH", ""))
import pyte

out, marks_file = sys.argv[1], sys.argv[2]
rows, cols = int(sys.argv[3]), int(sys.argv[4])
only = sys.argv[5:]  # optional: mark names to show
raw = open(out, "rb").read()
marks = [l.split() for l in open(marks_file) if l.strip()]
marks.append(["FINAL", str(len(raw))])
for name, off in marks:
    if only and name not in only:
        continue
    screen = pyte.Screen(cols, rows)
    stream = pyte.ByteStream(screen)
    stream.feed(raw[: int(off)])
    print(f"===== {name} @ {off} =====")
    lines = [l.rstrip() for l in screen.display]
    while lines and not lines[-1]:
        lines.pop()
    print("\n".join(lines))
