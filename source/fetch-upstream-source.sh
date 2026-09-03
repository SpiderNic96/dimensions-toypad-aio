#!/bin/sh
# SPDX-License-Identifier: MIT
# Fetch the complete corresponding source for every redistributed binary.
#
# GPL-2.0 section 3(b) requires that the source we point at is the source the
# shipped binary was actually built from. A previous release of this project
# shipped a script pinning a commit that did NOT match the distributed AppImage
# (797f1e41, a README-only commit), and a SOURCE-OFFER.md naming a SHA-256 that
# was not the shipped file. Both were compliance failures, not typos.
#
# The values below are verified against the artifact actually distributed on
# the `backends` release of this repository. See docs/SOURCE-OFFER.md.
#
# Usage: ./fetch-upstream-source.sh [output-directory]

set -eu

OUT=${1:-upstream-source}
mkdir -p "$OUT"

# ---------------------------------------------------------------------------
# Pinned refs. These MUST match docs/SOURCE-OFFER.md, AIO-MANIFEST.json,
# docs/SOURCE-CODE-STATUS.md and the backend registry in main.py.
# If you change one, change all five.
# ---------------------------------------------------------------------------
RPCS3_REPO="https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build"
RPCS3_COMMIT="6905c5ad82805af216a8addad40ee7dcea49f66b"
RPCS3_SHA256="c9221b0178ec12308638d828408f1a9b638d59de432dc8df45aa9bcaedaaf07b"
RPCS3_APPIMAGE="rpcs3-v0.0.42-7-6905c5ad_linux64.AppImage"

LEGOTOYPAD_REPO="https://github.com/harrysof/LegoToypad"
LEGOTOYPAD_TAG="v1.8"

XENIA_REPO="https://github.com/SpiderNic96/Xenia-Seamless-Toypad-Build"
XENIA_COMMIT="52aabc6c6b71cc7b0810975541839784787e1332"

CEMU_REPO="__CEMU_SOURCE_REPO__"
CEMU_COMMIT="__CEMU_SOURCE_COMMIT__"

# ---------------------------------------------------------------------------
# Refuse to run with placeholders still in place.
# ---------------------------------------------------------------------------
for v in "$RPCS3_REPO" "$RPCS3_COMMIT" "$RPCS3_SHA256" "$RPCS3_APPIMAGE" \
         "$LEGOTOYPAD_TAG"; do
    case "$v" in
        __*__)
            echo "ERROR: this script still contains placeholders." >&2
            echo "       Fill every __PLACEHOLDER__ before distributing." >&2
            exit 2
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Verify a shipped binary matches what this offer describes, if one is present.
# The AppImage is never committed to this repository; it is a release
# attachment. If you have downloaded it beside this checkout, it is checked.
# ---------------------------------------------------------------------------
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CANDIDATE="$HERE/../rpcs3/$RPCS3_APPIMAGE"

if [ -f "$CANDIDATE" ]; then
    echo "Verifying the shipped AppImage against the source offer..."
    ACTUAL=$(sha256sum "$CANDIDATE" | cut -d' ' -f1)
    if [ "$ACTUAL" != "$RPCS3_SHA256" ]; then
        echo "ERROR: hash mismatch." >&2
        echo "  expected $RPCS3_SHA256" >&2
        echo "  actual   $ACTUAL" >&2
        echo "The source commit below may not correspond to your binary." >&2
        echo "Please report this - it is a licence compliance problem." >&2
        exit 1
    fi
    echo "  OK - $ACTUAL"
else
    echo "Note: AppImage not found at rpcs3/$RPCS3_APPIMAGE; skipping hash check."
fi

# ---------------------------------------------------------------------------
# RPCS3 - GPL-2.0. This is the offer that GPL section 3(b) obliges us to honour.
# ---------------------------------------------------------------------------
echo "Fetching RPCS3 source at the exact distributed commit..."
git clone "$RPCS3_REPO" "$OUT/rpcs3-source"
git -C "$OUT/rpcs3-source" checkout "$RPCS3_COMMIT"
git -C "$OUT/rpcs3-source" submodule update --init --recursive
echo "  RPCS3 source at $RPCS3_COMMIT"

# ---------------------------------------------------------------------------
# LegoToypad - tag library and artwork, fetched at setup time.
# ---------------------------------------------------------------------------
echo "Fetching LegoToypad $LEGOTOYPAD_TAG..."
git clone --branch "$LEGOTOYPAD_TAG" --depth 1 "$LEGOTOYPAD_REPO" \
    "$OUT/LegoToypad-$LEGOTOYPAD_TAG"

# ---------------------------------------------------------------------------
# Optional backends. Skipped when their refs are still placeholders, so this
# script stays usable while Cemu is in progress.
# ---------------------------------------------------------------------------
fetch_optional() {
    name=$1; repo=$2; commit=$3
    case "$repo$commit" in
        *__*) echo "Skipping $name (no pinned ref yet)."; return 0 ;;
    esac
    echo "Fetching $name source at $commit..."
    git clone "$repo" "$OUT/$name-source"
    git -C "$OUT/$name-source" checkout "$commit"
    git -C "$OUT/$name-source" submodule update --init --recursive
}

fetch_optional "xenia" "$XENIA_REPO" "$XENIA_COMMIT"
fetch_optional "cemu"  "$CEMU_REPO"  "$CEMU_COMMIT"

echo
echo "Source retrieval complete."
echo "See docs/SOURCES.md, docs/CREDITS.md and docs/THIRD-PARTY-NOTICES.md."
