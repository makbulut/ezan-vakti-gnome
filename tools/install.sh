#!/bin/bash
# Paketi üretir ve normal bir eklenti gibi kurar (üzerine yazar).
# Sonra GNOME'a yüklemek için Looking Glass'taki reload komutu çalıştırılır (README).
set -e
cd "$(dirname "$0")/.."
tools/pack.sh >/dev/null
gnome-extensions install --force dist/ezan-vakti@mehmetakbulut.com.tr.shell-extension.zip
echo "Kuruldu: ~/.local/share/gnome-shell/extensions/ezan-vakti@mehmetakbulut.com.tr"
