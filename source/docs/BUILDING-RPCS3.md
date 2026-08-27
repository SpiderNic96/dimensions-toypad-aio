# Building the RPCS3 fork with colour forwarding

Written for Steam Deck (SteamOS 3.5, glibc 2.41) but every step generalises
to any Linux host that can run distrobox. The build container is Fedora 41.

> **Target:** produce a `rpcs3` binary at
> `/home/deck/rpcs3-dist/build/bin/rpcs3` that (1) runs on SteamOS,
> (2) accepts LOAD/REMOVE/MOVE inbound commands on TCP 9191, and
> (3) broadcasts Colour/Flash events per `protocol/SPEC.md` when the game
> sends LED commands.

## Why this is finicky

The fork's baseline (`RPCS3-Seamless-Toypad-Build`) tracks upstream RPCS3
closely, and upstream demands modern Qt, modern LLVM, modern glibc. SteamOS
ships older versions of all three. An AppImage bundles most libraries but
not glibc, so the build container's glibc must be **no newer** than the
host's, which rules out Fedora latest (2.43) in favour of Fedora 41 (2.38).

Second wrinkle: F41's LLVM is 19, too old for one file in the fork's
Vulkan pass; and its SDL3 is too old for one haptic constant. Fix by
building LLVM in-tree (`-DBUILD_LLVM=ON`) and using the vendored SDL
(`-DUSE_SYSTEM_SDL=OFF`).

Third: modern GCC + modern Qt (both from the container) tighten some
includes that the fork's source relies on transitively. Three small header
tweaks are needed; documented below.

## Prerequisites

- distrobox (`pacman -S distrobox` on SteamOS after `steamos-readonly disable`, or use the built-in podman)
- ~40 GB free disk for the build tree

## Step 1 - create the build container

```bash
distrobox create -n rpcs3dist -i registry.fedoraproject.org/fedora-toolbox:41 -Y
distrobox enter rpcs3dist -- sudo dnf install -y \
  cmake ninja-build gcc-c++ git-core patch \
  qt6-qtbase-devel qt6-qtmultimedia-devel qt6-qtsvg-devel \
  vulkan-loader-devel vulkan-headers glslang \
  libxkbcommon-devel libxkbcommon-x11-devel \
  alsa-lib-devel pulseaudio-libs-devel jack-audio-connection-kit-devel \
  ffmpeg-devel openal-soft-devel \
  libatomic zlib-devel curl-devel libudev-devel \
  glew-devel libpng-devel libjpeg-turbo-devel \
  libevdev-devel systemd-devel dbus-devel \
  llvm19-devel llvm19-static \
  wayland-devel wayland-protocols-devel libglvnd-devel \
  libusb1-devel libaio-devel
```

## Step 2 - clone the fork at the exact commit

```bash
mkdir -p ~/rpcs3-dist && cd ~/rpcs3-dist
git clone https://github.com/NeverCookFirst/RPCS3-Seamless-Toypad-Build.git rpcs3
cd rpcs3
git checkout 797f1e417f736a04e43319f27812228c4c8dbf6e
git submodule update --init --recursive --depth 1
```

This is the commit AIO 3.3.11 was built against. If you build from a
different commit the resulting binary's SHA won't match `main.py`'s
`BUNDLED_RPCS3_SHA256` constant, and the plugin will report unverified.

## Step 3 - apply the source patches

Three trivial header tweaks + our colour-forwarding patch.

### 3a. GCC/Qt header tweaks (three files)

```bash
cd ~/rpcs3-dist/rpcs3
# unordered_set include for game_list_frame.h
sed -i '/^#include <QMainWindow>/a #include <unordered_set>' rpcs3qt/game_list_frame.h
# Qt JSON headers for config_database.cpp
sed -i '/^#include "config_database.h"/a #include <QJsonDocument>\n#include <QJsonObject>' rpcs3qt/config_database.cpp
# Wrap std::string in QString::fromStdString at game_list_actions.cpp:555
sed -i 's|QString(msg).arg(entry->name)|QString(msg).arg(QString::fromStdString(entry->name))|' \
  rpcs3qt/game_list_actions.cpp
```

If any of those `sed` commands report "no substitution", check whether
upstream has already fixed it - safe to skip.

### 3b. Colour-forwarding patch

The idempotent script that adds outbound colour/flash event forwarding:

```bash
ROOT=~/rpcs3-dist bash /path/to/rpcs3-patch/apply-color-forwarding.sh
```

Expected output: three lines each saying `added ...`. If any says
`could not find ...`, the fork moved and the anchor regex needs updating -
see `docs/PATCH-NOTES.md` for what the patch does and where.

## Step 4 - configure and build

```bash
cd ~/rpcs3-dist && mkdir -p build && cd build

distrobox enter rpcs3dist -- cmake ../rpcs3 -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_NATIVE_INSTRUCTIONS=OFF \
  -DBUILD_LLVM=ON \
  -DSTATIC_LINK_LLVM=ON \
  -DUSE_SYSTEM_SDL=OFF \
  -DUSE_ALSA=ON -DUSE_PULSE=ON -DUSE_JACK=ON

distrobox enter rpcs3dist -- ninja
```

`USE_NATIVE_INSTRUCTIONS=OFF` is critical - it produces a binary that
runs on any x86-64 CPU, not just the build host. `BUILD_LLVM=ON` +
`STATIC_LINK_LLVM=ON` avoid the "LLVM 19 too old" and "which libLLVM.so is
this" problems by baking LLVM into the binary.

Duration: ~90 minutes on a Deck the first time. Incremental rebuilds
after editing one .cpp file are 3-8 minutes because ninja only touches
what changed.

## Step 5 - one manual link workaround

You may see a link-time complaint about `xkbcommon`; add it explicitly:

```bash
distrobox enter rpcs3dist -- ninja -j1 rpcs3 -v 2>&1 | tail -20
# If the failing link command is missing -lxkbcommon:
distrobox enter rpcs3dist -- sh -c 'cd ~/rpcs3-dist/build && \
  $(ninja -t commands rpcs3 | tail -1 | sed "s/-lxkbcommon-x11/-lxkbcommon-x11 -lxkbcommon/")'
```

That's a one-off; the produced binary lives at
`~/rpcs3-dist/build/bin/rpcs3` and won't need it again unless you clean
the build tree.

## Step 6 - verify the binary

```bash
distrobox enter rpcs3dist -- ~/rpcs3-dist/build/bin/rpcs3 --version 2>&1 | grep -i "rpcs3 0"
# Expected: RPCS3 0.0.42-5-797f1e41 Alpha
```

If the version line appears, the source is good. Package it into an
AppImage next (`docs/BUILDING-APPIMAGE.md`).

## Step 7 - test the listener before packaging

Run the raw binary and tap the socket:

```bash
distrobox enter rpcs3dist -- ~/rpcs3-dist/build/bin/rpcs3 \
  /home/deck/lego/game/PS3_GAME/USRDIR/EBOOT.BIN --no-gui &
sleep 20 && ss -ltnp | grep 9191
# Expected: LISTEN 0 4 127.0.0.1:9191 ...

# In another shell:
exec 3<>/dev/tcp/127.0.0.1/9191 && cat <&3 | xxd
# Play until the game issues a colour command; you should see:
#   55 01 01 xx 03 rr gg bb    (Colour event, xx=pad)
#   55 01 01 ff 03 rr gg bb    (Colour All / broadcast)
```

If frames appear, the patch is working. If not, cross-check `main.py`'s
`_run_color_reader` doesn't send HELLO (the fork's inbound listener drops
any non-{0x01,0x02,0x03} command byte).

## What can go wrong

- **glibc mismatch at run time.** The container's glibc is newer than
  SteamOS'. Symptom: `RPCS3-Toypad-x86_64.AppImage` prints
  `/lib64/libc.so.6: version GLIBC_2.43 not found`. Fix: rebuild in
  Fedora 41 exactly (not `fedora-toolbox:latest`).
- **Binary needs libLLVM.so.22.1 at run time.** You forgot
  `STATIC_LINK_LLVM=ON` or the container has a newer LLVM devel package
  and cmake picked it up. Wipe `build/`, reconfigure, rebuild.
- **Version detection reads "unavailable" in the plugin panel.** Cosmetic
  bug fixed in AIO 3.3.10 (main.py now reads stderr too); safe to ignore
  on older plugins if the binary itself works.

## Reference

Everything above is what shipped in AIO 3.3.10 / 3.3.11. The
end-to-end log lives at the top of this source zip's parent conversation.
