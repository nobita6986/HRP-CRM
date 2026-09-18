#!/usr/bin/env python3
"""Verify CORE/1.4 manifest by re-hashing listed files and comparing."""
import hashlib
import os
import re
import sys

REPO = r"D:\CodeApp\Hrp-Crm"
MANIFEST = os.path.join(REPO, "docs/contracts/handoff-core-1.4.manifest.txt")

with open(MANIFEST, "r", encoding="utf-8") as f:
    text = f.read()

# Parse manifest: lines "<64-hex>  <path>" (skip comments / blanks)
expected = {}
for line in text.splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^([0-9a-f]{64})\s+(\S+)\s*$", line)
    if not m:
        continue
    expected[m.group(2)] = m.group(1)

print(f"Manifest entries: {len(expected)}")

failures = []
for path, want in expected.items():
    full = os.path.join(REPO, path)
    if not os.path.exists(full):
        failures.append((path, "MISSING", want, ""))
        continue
    with open(full, "rb") as fp:
        got = hashlib.sha256(fp.read()).hexdigest()
    if got != want:
        failures.append((path, "MISMATCH", want, got))

if failures:
    print(f"FAIL: {len(failures)} mismatches")
    for path, kind, want, got in failures:
        print(f"  {kind}: {path}")
        print(f"    want={want}")
        print(f"    got ={got}")
    sys.exit(1)

print("OK: all 25 entries match")
