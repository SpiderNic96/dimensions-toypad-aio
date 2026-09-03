#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Assemble LICENSE and LICENSES/ for dimensions-toypad.
#
# Copies licence text out of source trees you already have, so the text matches
# the exact versions being shipped rather than a retyped or downloaded copy.
#
# Usage:
#   ./setup-licenses.sh gpl  [path/to/sources]
#   ./setup-licenses.sh mit  [path/to/sources]
#
# See LICENSING.md section 1 for the choice. Recommendation: gpl.

set -euo pipefail

CHOICE="${1:-}"
SRC="${2:-.}"

case "$CHOICE" in
    gpl|mit) ;;
    *) echo "Usage: $0 {gpl|mit} [sources-dir]" >&2; exit 2 ;;
esac

mkdir -p LICENSES docs

YEAR=$(date +%Y)
HOLDER="MetalNic96 (SpiderNic96)"

# ---------------------------------------------------------------------------
# Locate each upstream LICENSE. Adjust these globs to wherever your trees live.
# ---------------------------------------------------------------------------
find_license() {
    label=$1; shift
    for pattern in "$@"; do
        for hit in $SRC/$pattern; do
            [ -f "$hit" ] && { echo "$hit"; return 0; }
        done
    done
    echo "  MISSING: $label (looked for: $*)" >&2
    return 1
}

copy_license() {
    dest=$1; label=$2; shift 2
    if path=$(find_license "$label" "$@"); then
        cp "$path" "LICENSES/$dest"
        echo "  $dest  <- $path"
    else
        printf 'PLACEHOLDER: copy the %s LICENSE here before release.\n' \
            "$label" > "LICENSES/$dest"
        echo "  $dest  <- PLACEHOLDER"
    fi
}

echo "Collecting upstream licences from '$SRC'..."
copy_license GPL-2.0-RPCS3.txt      "RPCS3"      "RPCS3-Seamless-Toypad-Build*/LICENSE"
copy_license BSD-3-Clause-Xenia.txt "Xenia"      "Xenia-Seamless-Toypad-Build*/LICENSE"
copy_license MPL-2.0-Cemu.txt       "Cemu"       "Cemu-*-Toypad-Build*/LICENSE.txt" "Cemu-*/LICENSE"
copy_license MIT-LegoToypad.txt     "LegoToypad" "LegoToypad-*/LICENSE"
copy_license MIT-shadPS4-Bridge.txt "shadPS4 bridge" "shadPS4-Seamless-Toypad-Bridge-*/LICENSE"

# react-icons ships in node_modules once dependencies are installed.
if [ -f node_modules/react-icons/LICENSE ]; then
    cp node_modules/react-icons/LICENSE LICENSES/MIT-react-icons.txt
    echo "  MIT-react-icons.txt  <- node_modules/react-icons/LICENSE"
else
    echo "  MIT-react-icons.txt  <- PLACEHOLDER (run npm ci first)" >&2
    echo "PLACEHOLDER: copy node_modules/react-icons/LICENSE here." \
        > LICENSES/MIT-react-icons.txt
fi

# SOURCE-OFFER.md points at docs/COPYING.GPL-2.0 -- keep them consistent.
if [ -s LICENSES/GPL-2.0-RPCS3.txt ] && ! grep -q PLACEHOLDER LICENSES/GPL-2.0-RPCS3.txt; then
    cp LICENSES/GPL-2.0-RPCS3.txt docs/COPYING.GPL-2.0
    echo "  docs/COPYING.GPL-2.0  <- LICENSES/GPL-2.0-RPCS3.txt"
fi

# ---------------------------------------------------------------------------
# The project's own LICENSE.
# ---------------------------------------------------------------------------
echo
if [ "$CHOICE" = "gpl" ]; then
    if [ -f docs/COPYING.GPL-2.0 ] && ! grep -q PLACEHOLDER docs/COPYING.GPL-2.0; then
        cp docs/COPYING.GPL-2.0 LICENSE
        echo "LICENSE <- GPL-2.0 (from the RPCS3 tree)"
    else
        echo "ERROR: no GPL-2.0 text available to copy." >&2
        echo "       Point \$SRC at a tree containing RPCS3's LICENSE." >&2
        exit 1
    fi
    SPDX="GPL-2.0-or-later"
    cat >> LICENSE <<EOF

---

Dimensions Toypad
Copyright (C) $YEAR $HOLDER

This program is free software; you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation; either version 2 of the License, or (at your option) any later
version.
EOF
else
    cat > LICENSE <<EOF
MIT License

Copyright (c) $YEAR $HOLDER

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
    echo "LICENSE <- MIT"
    SPDX="MIT"
fi

echo
echo "SPDX identifier for your files: $SPDX"
echo "Add headers with:"
echo "  # SPDX-License-Identifier: $SPDX     (main.py, *.sh)"
echo "  // SPDX-License-Identifier: $SPDX    (src/*.tsx)"
echo
echo "Remaining, and NOT automatable:"
echo "  - Verify the Decky Loader licence and record it in THIRD-PARTY-NOTICES.md"
echo "  - Confirm no PLACEHOLDER files remain:  grep -rl PLACEHOLDER LICENSES/"
