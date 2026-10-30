#!/usr/bin/env bash
# Rehber anlatım seslerini ses klonuyla üretir ve canlıya yükler (30 Ekim kararı; bkz. docs/SES_KAYDI.md).
#
#   deploy/ses/uret-yukle.sh <ses-adı> <türkçe-referans.wav> [ingilizce-referans.wav]
#   ör. deploy/ses/uret-yukle.sh talha-1 ~/vakifname-voice/ref/talha-tr.wav ~/vakifname-voice/ref/talha-en.wav
#
# 1. Sunucunun yayımladığı katalogdan cümle listesi (dosya adları sunucunun arayacağı adlarla aynı).
# 2. Bu Mac'te üretim + Whisper denetimi (yalnızca eksikler; yarıda kalırsa yeniden çalıştırılır, kaldığı yerden sürer).
# 3. MP3'ler sunucunun ses önbelleğine kopyalanır (var olanlar silinmez).
# Sunucuda sağlayıcıyı açmak ayrı ve bilinçli bir adımdır (betik sonunda komutu yazar).
set -euo pipefail
NAME=${1:?ses adı}; REF=${2:?türkçe referans}; REF_EN=${3:-}
HOST=${HOST:-89.167.32.115}
REMOTE=/root/calismalar
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
VOICE_ENV=${VOICE_ENV:-$HOME/vakifname-voice/.venv}
OUT=$HOME/vakifname-voice/out/$NAME
mkdir -p "$OUT"

echo "1/3 cümle listesi (sunucu)…"
ssh "$HOST" "cd $REMOTE/app/backend && set -a && . $REMOTE/api.env && set +a && \
  .venv/bin/python -m app.tts_export --voice '$NAME' --out /tmp/vk-voice-jobs.json"
scp -q "$HOST:/tmp/vk-voice-jobs.json" "$OUT/isler.json"

echo "2/3 üretim (bu Mac; cümle başına ~1–2 dk)…"
EXTRA=()
[ -n "$REF_EN" ] && EXTRA+=(--ref-en "$REF_EN")
HF_HUB_DISABLE_XET=1 "$VOICE_ENV/bin/python" "$ROOT/backend/scripts/voice/generate.py" "$OUT/isler.json" \
  --ref "$REF" "${EXTRA[@]}" --out "$OUT"

echo "3/3 sunucuya kopyalama…"
ssh "$HOST" "mkdir -p $REMOTE/data/content/tts"
rsync -az --include '*.mp3' --exclude '*' "$OUT/" "$HOST:$REMOTE/data/content/tts/"
echo "Kopyalandı: $(ls "$OUT"/*.mp3 2>/dev/null | wc -l | tr -d ' ') ses. Denetim raporu: $OUT/rapor.json"
echo
echo "Sunucuda açmak için (api.env'e ekle/güncelle, sonra yeniden başlat):"
echo "  VAKIFNAME_TTS_PROVIDER=files"
echo "  VAKIFNAME_TTS_VOICE=$NAME"
echo "  VAKIFNAME_TTS_VOICE_EN=$NAME"
echo "  ssh $HOST systemctl restart calismalar-api"
