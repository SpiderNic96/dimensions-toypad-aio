#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC_ZIP="$ROOT/release/reference/dimensions-toypad-AIO-3.3.11.zip"
WORK="$ROOT/build/reference-aio-repack"
OUT="$ROOT/build/dimensions-toypad-AIO-3.3.11-repacked.zip"
rm -rf "$WORK" "$OUT"
mkdir -p "$WORK"
unzip -q "$SRC_ZIP" -d "$WORK/unpacked"
mkdir -p "$(dirname "$OUT")"
(
  cd "$WORK/unpacked"
  zip -qr "$OUT" dimensions-toypad
)
sha256sum "$SRC_ZIP" "$OUT"
python3 - "$WORK/unpacked" <<'PY'
import hashlib
import pathlib
import sys
root=pathlib.Path(sys.argv[1])
for p in sorted(root.rglob('*')):
    if p.is_file():
        h=hashlib.sha256(p.read_bytes()).hexdigest()
        print(h, p.relative_to(root))
PY
