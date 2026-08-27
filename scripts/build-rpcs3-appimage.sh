#!/bin/bash
set -euo pipefail

WORK_ROOT=${1:-/tmp/rpcs3-dist}
OUT_ROOT=${2:-/workspace/build}
RPCS3_SRC="$WORK_ROOT/rpcs3"
RPCS3_BUILD="$WORK_ROOT/build"
APPIMAGE_WORK="$WORK_ROOT/appimage"

mkdir -p "$APPIMAGE_WORK" "$OUT_ROOT"
cd "$APPIMAGE_WORK"

fetch_tool() {
  local tool="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 3 -o "$tool" \
      "https://github.com/AppImage/AppImageKit/releases/download/continuous/$tool" \
      || curl -fL --retry 3 -o "$tool" \
      "https://github.com/linuxdeploy/${tool%%-*}/releases/download/continuous/$tool"
  else
    echo "curl is required" >&2
    exit 1
  fi
  chmod +x "$tool"
}

fetch_tool linuxdeploy-x86_64.AppImage
fetch_tool linuxdeploy-plugin-qt-x86_64.AppImage
fetch_tool appimagetool-x86_64.AppImage

rm -rf AppDir
mkdir -p AppDir/usr/bin
mkdir -p AppDir/usr/share/applications
mkdir -p AppDir/usr/share/icons/hicolor/256x256/apps
cp "$RPCS3_BUILD/bin/rpcs3" AppDir/usr/bin/rpcs3

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

if [ -f "$RPCS3_SRC/rpcs3/rpcs3.png" ]; then
  cp "$RPCS3_SRC/rpcs3/rpcs3.png" AppDir/usr/share/icons/hicolor/256x256/apps/rpcs3.png
fi

export APPIMAGE_EXTRACT_AND_RUN=1
export NO_STRIP=1
export DEPLOY_PLATFORM_THEMES=1
export EXTRA_QT_MODULES="svg;multimedia"

./linuxdeploy-x86_64.AppImage \
  --appdir AppDir \
  --plugin qt \
  --desktop-file AppDir/usr/share/applications/rpcs3.desktop \
  --icon-file AppDir/usr/share/icons/hicolor/256x256/apps/rpcs3.png || \
./linuxdeploy-x86_64.AppImage \
  --appdir AppDir \
  --plugin qt \
  --desktop-file AppDir/usr/share/applications/rpcs3.desktop

# Match the documented F41 runtime as closely as possible: include the Qt 6
# libraries and ICU 74 available in the controlled build container.
for lib in \
  libQt6Core.so.6 libQt6Gui.so.6 libQt6Widgets.so.6 \
  libQt6Multimedia.so.6 libQt6MultimediaWidgets.so.6 \
  libQt6Svg.so.6 libQt6Concurrent.so.6 libQt6Network.so.6 \
  libQt6DBus.so.6 libQt6OpenGL.so.6 libQt6OpenGLWidgets.so.6; do
  cp -Lv "/usr/lib64/$lib" AppDir/usr/lib/ 2>/dev/null || true
done
for lib in libicui18n.so.74 libicuuc.so.74 libicudata.so.74; do
  cp -Lv /usr/lib64/${lib}* AppDir/usr/lib/ 2>/dev/null || true
done

OUT="$APPIMAGE_WORK/RPCS3-Toypad-x86_64.AppImage"
rm -f "$OUT"
./appimagetool-x86_64.AppImage AppDir "$OUT"

cp "$OUT" "$OUT_ROOT/RPCS3-Toypad-x86_64.AppImage"
sha256sum "$OUT_ROOT/RPCS3-Toypad-x86_64.AppImage" | tee "$OUT_ROOT/RPCS3-Toypad-x86_64.AppImage.sha256"
