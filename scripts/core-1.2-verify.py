"""
Verify SHA-256 hashes against docs/contracts/handoff-core-1.2.manifest.txt.
"""
import hashlib
import sys
from pathlib import Path

manifest_path = Path("docs/contracts/handoff-core-1.2.manifest.txt")
if not manifest_path.exists():
    print(f"MISSING: {manifest_path}", file=sys.stderr)
    sys.exit(1)

expected = {}
for line in manifest_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split()
    if len(parts) < 2:
        continue
    h, f = parts[0], parts[1]
    expected[f] = h

mismatches = 0
missing = 0
for f, expected_hash in expected.items():
    p = Path(f)
    if not p.exists():
        print(f"MISSING FILE: {f}")
        missing += 1
        continue
    actual = hashlib.sha256(p.read_bytes()).hexdigest()
    if actual != expected_hash:
        print(f"MISMATCH: {f}\n  expected: {expected_hash}\n  actual:   {actual}")
        mismatches += 1

if missing == 0 and mismatches == 0:
    print(f"OK: {len(expected)} files all match.")
    sys.exit(0)
else:
    print(f"FAIL: {missing} missing, {mismatches} mismatches.")
    sys.exit(1)
