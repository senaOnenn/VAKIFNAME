#!/usr/bin/env bash
# Tanıtım filminin bütün sürümlerini üretir → $OUT (varsayılan ~/vakifname-video-assets/film).
#   film/tools/render.sh [sürüm…]     sürümler: film altyazili dongu dongu-mobil (boşsa hepsi)
# Çıktılar repoya girmez. Döngüler tanıtım sayfası için ayrıca küçültülür (sessiz, hızlı başlangıç).
set -euo pipefail
FILM=$(cd "$(dirname "$0")/.." && pwd)
OUT=${OUT:-$HOME/vakifname-video-assets/film}
HF="npx --yes hyperframes@0.8.221"
mkdir -p "$OUT"
cd "$FILM"
for v in ${@:-film altyazili dongu dongu-mobil}; do
  node tools/build.mjs "$v" | head -1
  $HF render . --output "$OUT/$v-ham.mp4" --quality delivery --quiet
  case $v in
    film|altyazili)
      # Web için: H.264 + AAC, hızlı başlangıç.
      ffmpeg -loglevel error -y -i "$OUT/$v-ham.mp4" -c:v libx264 -crf 22 -preset slow -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "$OUT/tanitim-$v.mp4" ;;
    dongu)
      ffmpeg -loglevel error -y -i "$OUT/$v-ham.mp4" -vf scale=1280:-2 -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -an -movflags +faststart "$OUT/hero.mp4" ;;
    dongu-mobil)
      ffmpeg -loglevel error -y -i "$OUT/$v-ham.mp4" -vf scale=540:-2 -c:v libx264 -crf 28 -preset slow -pix_fmt yuv420p -an -movflags +faststart "$OUT/hero-mobil.mp4" ;;
  esac
done
node tools/build.mjs film >/dev/null
cp out/tanitim-tr.vtt out/tanitim-en.vtt "$OUT/"
ls -la "$OUT"
