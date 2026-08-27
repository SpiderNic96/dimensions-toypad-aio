# Packaging RPCS3 as a portable AppImage for the Deck

Turns the raw `rpcs3` binary built per `BUILDING-RPCS3.md` into
`RPCS3-Toypad-x86_64.AppImage`, which is what the plugin bundles and
launches. Total time: about 5 minutes.

## Why this doesn't Just Work with linuxdeploy defaults

`linuxdeploy` with `--plugin qt` builds a good AppImage for most Qt6
apps - but the fork uses several Qt 6.8.3 APIs the F41 packaged Qt
plugin doesn't know about, and depends on an ICU version newer than
what ships in a stock AppImage template. The recipe here fixes both.

## Prerequisites

- The RPCS3 binary from `BUILDING-RPCS3.md`
- These three AppImage tools:
  - `linuxdeploy-x86_64.AppImage`
  - `linuxdeploy-plugin-qt-x86_64.AppImage`
  - `appimagetool-x86_64.AppImage`

Fetch once:

```bash
mkdir -p ~/rpcs3-appimage && cd ~/rpcs3-appimage
for tool in linuxdeploy-x86_64.AppImage \
            linuxdeploy-plugin-qt-x86_64.AppImage \
            appimagetool-x86_64.AppImage; do
  curl -fL -o "$tool" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/$tool" \
    || curl -fL -o "$tool" \
    "https://github.com/linuxdeploy/${tool%%-*}/releases/download/continuous/$tool"
done
chmod +x *.AppImage
```

## Step 1 - stage the AppDir

```bash
cd ~/rpcs3-appimage
mkdir -p AppDir/usr/{bin,lib,share/{applications,icons/hicolor/256x256/apps}}
cp ~/rpcs3-dist/build/bin/rpcs3 AppDir/usr/bin/rpcs3

# Desktop entry (minimal; linuxdeploy will consume it)
cat > AppDir/usr/share/applications/rpcs3.desktop <<'DESKTOP'
[Desktop Entry]
Name=RPCS3
Comment=PlayStation 3 emulator (Seamless Toypad Build)
Exec=rpcs3
Icon=rpcs3
Categories=Game;Emulator;
Type=Application
Terminal=false
DESKTOP

# Icon (use whatever from the fork tree)
cp ~/rpcs3-dist/rpcs3/rpcs3/rpcs3.png \
   AppDir/usr/share/icons/hicolor/256x256/apps/rpcs3.png 2>/dev/null \
  || echo "(no icon in tree; safe to skip, linuxdeploy accepts missing)"
```

## Step 2 - run linuxdeploy + qt plugin with the necessary env

The env vars are the workaround set collected across earlier build
sessions. Each one is necessary:

- `NO_STRIP=1` - the fork's binary has bookkeeping symbols the debugger
  needs; stripping breaks version detection.
- `DEPLOY_PLATFORM_THEMES=1` - includes the platform-theme plugin so Qt's
  file dialogs render on SteamOS.
- `EXTRA_QT_MODULES="svg;multimedia"` - the fork uses both; without the
  hint they don't get bundled.

```bash
cd ~/rpcs3-appimage

export NO_STRIP=1
export DEPLOY_PLATFORM_THEMES=1
export EXTRA_QT_MODULES="svg;multimedia"

./linuxdeploy-x86_64.AppImage \
  --appdir AppDir \
  --plugin qt \
  --desktop-file AppDir/usr/share/applications/rpcs3.desktop \
  --icon-file AppDir/usr/share/icons/hicolor/256x256/apps/rpcs3.png
```

## Step 3 - replace the AppDir Qt runtime with 6.8.3

linuxdeploy will have bundled whatever Qt version F41 has installed. The
fork was tested against 6.8.3; the container's package is usually a
close-enough later minor. If runtime crashes appear during game boot,
overwrite the AppDir's Qt runtime with the exact one from the build
container:

```bash
distrobox enter rpcs3dist -- sh -c '
  for lib in libQt6Core.so.6 libQt6Gui.so.6 libQt6Widgets.so.6 \
             libQt6Multimedia.so.6 libQt6MultimediaWidgets.so.6 \
             libQt6Svg.so.6 libQt6Concurrent.so.6 libQt6Network.so.6 \
             libQt6DBus.so.6 libQt6OpenGL.so.6 libQt6OpenGLWidgets.so.6; do
    cp -Lv /usr/lib64/$lib ~/rpcs3-appimage/AppDir/usr/lib/
  done
'
```

## Step 4 - add ICU 74

`libicui18n.so.74` isn't in the linuxdeploy default set; add it manually:

```bash
distrobox enter rpcs3dist -- sh -c '
  for lib in libicui18n.so.74 libicuuc.so.74 libicudata.so.74; do
    cp -Lv /usr/lib64/$lib* ~/rpcs3-appimage/AppDir/usr/lib/ 2>/dev/null
  done
'
```

## Step 5 - package

```bash
cd ~/rpcs3-appimage
./appimagetool-x86_64.AppImage AppDir RPCS3-Toypad-x86_64.AppImage
```

Expected output: `RPCS3-Toypad-x86_64.AppImage` in the current dir,
~180-260 MB depending on strip settings.

## Step 6 - verify

```bash
./RPCS3-Toypad-x86_64.AppImage --version 2>&1 | grep -i "rpcs3 0"
# Expected: RPCS3 0.0.42-5-797f1e41 Alpha

./RPCS3-Toypad-x86_64.AppImage /home/deck/lego/game/PS3_GAME/USRDIR/EBOOT.BIN --no-gui &
sleep 20 && ss -ltnp | grep 9191
# Expected: LISTEN 0 4 127.0.0.1:9191 ...
```

If both pass, hash it and update the plugin:

```bash
sha256sum RPCS3-Toypad-x86_64.AppImage
# Take the resulting hash, put it into plugin/main.py as
# BUNDLED_RPCS3_SHA256 = "..."
```

Then swap it into the plugin's `rpcs3/` directory as
`RPCS3-Toypad-x86_64.AppImage`.

## What can go wrong

- **AppImage exits immediately on the Deck.** Check `ldd` inside the
  AppDir - if any library says `not found`, add it via steps 3-4.
- **AppImage runs but `--no-gui` still opens a window.** Newer Qt's
  QCommandLineParser is stricter; the argument is silently ignored.
  Harmless on the Deck since Steam Game Mode covers the window.
- **The listener never binds.** The RPCS3 patch didn't survive the
  build. Re-run `apply-color-forwarding.sh` and rebuild.
