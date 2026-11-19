#!/usr/bin/env python3
"""Copy apex-login.js into every bundled app and wire it into each page."""
import pathlib
import shutil
import sys

root = pathlib.Path("dist")
gate = root / "apex-login.js"
if not gate.exists():
    sys.exit("::error::dist/apex-login.js is missing - the shell must ship the gate")

tag = '<script src="./apex-login.js"></script>'
gated, skipped = 0, []

for app in sorted(p for p in (root / "apps").iterdir() if p.is_dir()):
    index = app / "index.html"
    if not index.exists():
        skipped.append(app.name)
        continue
    shutil.copyfile(gate, app / "apex-login.js")
    html = index.read_text(encoding="utf-8")
    if "apex-login.js" in html:
        continue
    if "</body>" in html:
        html = html.replace("</body>", tag + "\n</body>", 1)
    else:
        html = html.rstrip() + "\n" + tag + "\n"
    index.write_text(html, encoding="utf-8")
    gated += 1

print(f"gated {gated} apps")
if skipped:
    print(f"::warning::no index.html at the root of: {', '.join(skipped)}")
if gated == 0:
    sys.exit("::error::No app was gated - check the bundle layout")
