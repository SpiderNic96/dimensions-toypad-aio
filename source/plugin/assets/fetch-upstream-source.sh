#!/bin/sh
set -eu
OUT=${1:-upstream-source}
mkdir -p "$OUT"

echo "Fetching RPCS3 Seamless Toypad Build at the exact distributed commit..."
git clone https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build.git "$OUT/RPCS3-Seamless-Toypad-Build"
git -C "$OUT/RPCS3-Seamless-Toypad-Build" checkout 797f1e417f736a04e43319f27812228c4c8dbf6e

echo "Fetching LegoToypad v1.5..."
git clone --branch v1.5 --depth 1 https://github.com/harrysof/LegoToypad.git "$OUT/LegoToypad-v1.5"

echo "Source retrieval complete. See ../SOURCES.md and ../CREDITS.md."
