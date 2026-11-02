#!/usr/bin/env bash
# Ana sayfa hikâyesinin (7 sahne) web kopyaları. Orijinallere dokunmaz; çıktı kaynak klasörün `web/` alt klasörüne yazılır.
# Görseller depoya girmez (CLAUDE.md §4); Vite eklentisi `landingArt` onları `/media/sahne/*.webp` adresinden sunar.
#
#   frontend/scripts/landing-art.sh [kaynak_klasör]     (varsayılan: ../vakifname-assets/story-v2)
#
# Her sahne için 1280 px ve özgün genişlik (büyütme yok; özgün en fazla 1920 px). Oran korunur.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="${1:-$ROOT/../vakifname-assets/story-v2}"
OUT="$SRC/web"
mkdir -p "$OUT"

for i in 1 2 3 4 5 6 7; do
  in="$SRC/$i.png"
  [[ -f "$in" ]] || { echo "Eksik: $in" >&2; exit 1; }
  w0=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$in")
  for w in 1280 "$w0"; do
    ffmpeg -loglevel error -y -i "$in" -vf "scale=$w:-2:flags=lanczos" -c:v libwebp -quality 82 -compression_level 6 \
      "$OUT/scene-$i-$w.webp"
  done
done
ls -la "$OUT"
