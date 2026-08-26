#!/usr/bin/env python3
"""Decode reference/files/covers.json (base64 data URIs from fetch_covers.py /
mb_fallback.py) into real files at public/covers/<id>.<ext> — per the handoff,
Pages serves plain image files, no base64 embedding."""
import base64
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
covers = json.loads((ROOT / "reference" / "files" / "covers.json").read_text(encoding="utf-8"))

out_dir = ROOT / "public" / "covers"
out_dir.mkdir(parents=True, exist_ok=True)

# schema.sql hardcodes cover_url as "covers/<id>.jpg" for every seed row —
# keep the extension uniform (browsers sniff content, not extension, so a
# PNG/WebP served as .jpg still renders fine).
written = 0
for aid, data_uri in covers.items():
    m = re.match(r"data:([^;]+);base64,(.*)", data_uri, re.S)
    if not m:
        continue
    b64 = m.group(2)
    (out_dir / f"{aid}.jpg").write_bytes(base64.b64decode(b64))
    written += 1

print(f"wrote {written} cover files to {out_dir}")
