#!/bin/bash
# Dağıtılabilir zip üretir: dist/<uuid>.shell-extension.zip
set -e
cd "$(dirname "$0")/.."
mkdir -p dist
gnome-extensions pack ezan-vakti@mehmetakbulut.com.tr --extra-source=prefs.js --force --out-dir=dist
ls -l dist/
