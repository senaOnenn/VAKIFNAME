#!/usr/bin/env bash
# Demo yedeği (29 Ekim, karar A): canlıdaki onaylı içeriği bu dizüstüne eşitler. Finalden önce (ve içerik her
# değiştiğinde) çalıştırılır. Yalnızca yayın verisi gelir: temel katalog + görseller, içerik deposu (yöneticinin
# onayladıkları, kitaplar, kitap görselleri) ve anlatım sesleri. Kişisel veri (hesap, ilerleme, istatistik) GELMEZ.
#
#   deploy/yedek/esitle.sh [sunucu]          # varsayılan 89.167.32.115; hedef ~/vakifname-yedek
#
# Çalışan servis durdurulmaz: SQLite sunucuda çevrim içi yedekle (salt okunur) kopyalanır.
set -euo pipefail
HOST=${1:-89.167.32.115}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=${VAKIFNAME_YEDEK_DIR:-$HOME/vakifname-yedek}
REMOTE=/root/calismalar
mkdir -p "$DEST/data/content"

echo "1/4 içerik deposunun tutarlı kopyası (sunucuda)…"
ssh "$HOST" "$REMOTE/app/backend/.venv/bin/python - <<'PY'
import sqlite3
src = sqlite3.connect('file:$REMOTE/data/content/content.sqlite3?mode=ro', uri=True)
dst = sqlite3.connect('$REMOTE/yedek-content.sqlite3')
src.backup(dst); dst.close(); src.close()
PY"

echo "2/4 temel katalog ve görseller…"
rsync -az --delete "$HOST:$REMOTE/data/public_catalog/" "$DEST/data/public_catalog/"

echo "3/4 içerik (onaylı katman, kitaplar, görseller, sesler)…"
rsync -az --delete --exclude 'content.sqlite3*' "$HOST:$REMOTE/data/content/" "$DEST/data/content/"
rsync -az "$HOST:$REMOTE/yedek-content.sqlite3" "$DEST/data/content/content.sqlite3"
rm -f "$DEST/data/content/content.sqlite3-wal" "$DEST/data/content/content.sqlite3-shm"
ssh "$HOST" "rm -f $REMOTE/yedek-content.sqlite3"

echo "4/4 yedek ortam dosyası…"
# Temel: yereldeki backend/.env (Google istemcisi, yöneticiler, rehber). Üstüne yedeğin yolları ve canlının ses ayarı.
{
  echo "# deploy/yedek/esitle.sh üretti ($(date '+%Y-%m-%d %H:%M')); elle düzenlemeyin, yeniden üretilir."
  grep -vE '^VAKIFNAME_(PUBLIC_CATALOG_FILE|CONTENT_DIR|PROGRESS_DB|ACCOUNTS_DB|STATS_DB|VISIT_SIMULATION|TTS_[A-Z_]+|PUBLIC_BASE_URL|COOKIE_SECURE|DEMO_API)=' "$ROOT/backend/.env" || true
  echo "VAKIFNAME_PUBLIC_CATALOG_FILE=$DEST/data/public_catalog/catalog.json"
  echo "VAKIFNAME_CONTENT_DIR=$DEST/data/content"
  echo "VAKIFNAME_PROGRESS_DB=$DEST/data/progress.sqlite3"
  echo "VAKIFNAME_ACCOUNTS_DB=$DEST/data/accounts.sqlite3"
  echo "VAKIFNAME_STATS_DB=$DEST/data/stats.sqlite3"
  echo "VAKIFNAME_PUBLIC_BASE_URL=http://localhost:5173"
  echo "VAKIFNAME_COOKIE_SECURE=off"
  echo "VAKIFNAME_DEMO_API=off"
  echo "VAKIFNAME_VISIT_SIMULATION=on"
  ssh "$HOST" "grep -E '^VAKIFNAME_TTS_(PROVIDER|VOICE|VOICE_EN|RATE)=' $REMOTE/api.env || true"
} > "$DEST/yedek.env"
chmod 600 "$DEST/yedek.env"

echo "Tamam → $DEST"
du -sh "$DEST/data/public_catalog" "$DEST/data/content" 2>/dev/null | sed 's/^/  /'
echo "  anlatım sesi: $(find "$DEST/data/content/tts" -name '*.mp3' 2>/dev/null | wc -l | tr -d ' ') dosya"
echo "Çalıştırmak için: deploy/yedek/calistir.sh"
