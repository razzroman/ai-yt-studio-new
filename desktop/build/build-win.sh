#!/usr/bin/env bash
# Сборка AI YT Studio для Windows (x64): портативная папка + установщик-скрипт, упакованные в .zip.
# Нужны: bash, curl, unzip, zip, python3 с Pillow. Запуск: bash desktop/build/build-win.sh [папка_для_результата]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/../dist}"
EV=33.2.1
NAME="AI YT Studio"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

ZIP="electron-v$EV-win32-x64.zip"
curl -fsSL -o "$WORK/$ZIP" "https://github.com/electron/electron/releases/download/v$EV/$ZIP"
curl -fsSL -o "$WORK/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$EV/SHASUMS256.txt"
WANT=$(grep " \*$ZIP\$" "$WORK/SHASUMS256.txt" | cut -d' ' -f1)
GOT=$(sha256sum "$WORK/$ZIP" | cut -d' ' -f1)
[ "$WANT" = "$GOT" ] || { echo "Контрольная сумма Electron не совпала"; exit 1; }

APPDIR="$WORK/$NAME"
mkdir -p "$APPDIR" && unzip -q "$WORK/$ZIP" -d "$APPDIR"
mv "$APPDIR/electron.exe" "$APPDIR/$NAME.exe"
rm -f "$APPDIR/resources/default_app.asar"
mkdir -p "$APPDIR/resources/app"
cp "$HERE/../app/"{package.json,main.js,offline.html,icon.png,icon.ico} "$APPDIR/resources/app/"
python3 "$HERE/pe_patch.py" "$APPDIR/$NAME.exe" "$HERE/../app/icon.png"
cp "$HERE/install.cmd" "$APPDIR/Install.cmd"
cp "$HERE/uninstall.cmd" "$APPDIR/Uninstall.cmd"
cp "$HERE/readme-win.txt" "$APPDIR/README.txt"
printf '\xef\xbb\xbf' | cat - "$APPDIR/README.txt" > "$APPDIR/r.tmp" && mv "$APPDIR/r.tmp" "$APPDIR/README.txt"  # BOM для Блокнота
# Переводы строк для Windows.
for f in "$APPDIR/Install.cmd" "$APPDIR/Uninstall.cmd" "$APPDIR/README.txt"; do sed -i 's/\r\?$/\r/' "$f"; done

mkdir -p "$OUT"
VER=$(python3 -c "import json;print(json.load(open('$HERE/../app/package.json'))['version'])")
RES="$OUT/AI_YT_Studio_Windows_$VER.zip"
rm -f "$RES"
(cd "$WORK" && zip -qr -9 "$RES" "$NAME")
echo "Готово: $RES ($(du -h "$RES" | cut -f1))"
