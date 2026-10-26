#!/usr/bin/env bash
# Yalıtılmış uçtan uca tarayıcı testleri. Kullanıcının servislerine (5173, 8000, 8765) dokunmaz; ayrı portlar kullanır.
# Her çalıştırma yeni bir geçici dizinde boş inceleme veritabanı, rastgele erişim anahtarı ve test incelemecisi oluşturur;
# bu yüzden sonuçlar her çalıştırmada aynıdır. Gerçek inceleme veritabanı açılmaz. Çıkışta yalnızca bu betiğin başlattığı
# süreçler durdurulur ve geçici dizin silinir (ekran görüntüleri E2E_OUT altında kalır).
#
#   PLAYWRIGHT_MODULE=/yol/node_modules/playwright PYTHON=backend/.venv/bin/python frontend/e2e/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PYTHON:-$ROOT/backend/.venv/bin/python}"
VITE="$ROOT/frontend/node_modules/.bin/vite"
INTERNAL_PORT="${E2E_INTERNAL_PORT:-8766}"     # dahili, gerçek V20 + geçici DB
FIC_INTERNAL_PORT="${E2E_FIC_INTERNAL_PORT:-8767}"  # dahili, KURGUSAL veri + geçici DB (onay akışı)
PUBLIC_PORT="${E2E_PUBLIC_PORT:-8001}"         # genel API, production ayarı (demo kapalı)
DEMO_API_PORT="${E2E_DEMO_API_PORT:-8002}"     # genel API, demo açık (yalnızca geliştirme sunucusu için)
DEV_PORT="${E2E_DEV_PORT:-5180}"
FIC_DEV_PORT="${E2E_FIC_DEV_PORT:-5181}"
PREVIEW_PORT="${E2E_PREVIEW_PORT:-4180}"       # production arayüz sunucusu (app.web)
for p in "$INTERNAL_PORT" "$FIC_INTERNAL_PORT" "$PUBLIC_PORT" "$DEMO_API_PORT" "$DEV_PORT" "$FIC_DEV_PORT" "$PREVIEW_PORT"; do
  case "$p" in 5173|8000|8765) echo "Port $p kullanıcının servisine ayrılmıştır." >&2; exit 2;; esac
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "Port $p kullanımda." >&2; exit 2; fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vakifname-e2e-XXXXXX")"
OUT="${E2E_OUT:-$WORK/out}"
mkdir -p "$OUT" "$WORK/public"
PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  [ -n "${E2E_KEEP:-}" ] || rm -rf "$WORK/env" "$WORK/fic" "$WORK/fictional" "$WORK/dist" "$WORK/public"
}
trap cleanup EXIT

wait_http() {  # url
  for _ in $(seq 1 120); do
    if curl -s -o /dev/null "$1"; then return 0; fi
    sleep 0.5
  done
  echo "Zaman aşımı: $1" >&2; return 1
}
U() { echo "http://127.0.0.1:$1"; }

cd "$ROOT/backend"
# Gerçek V20 + geçici DB (envanter, araştırma haritası).
"$PY" scripts/e2e_review_env.py prepare "$WORK/env"
"$PY" scripts/e2e_review_env.py serve "$WORK/env" --port "$INTERNAL_PORT" >"$WORK/internal.log" 2>&1 & PIDS+=($!)
# Kurgusal veri + geçici DB (onay → yayın akışı).
"$PY" scripts/e2e_review_env.py prepare "$WORK/fic"
"$PY" scripts/e2e_fictional_data.py "$WORK/fic"
VAKIFNAME_INTERNAL_DATA_DIR="$WORK/fic" VAKIFNAME_RESEARCH_FILE="$WORK/fic/research.json" \
  "$PY" scripts/e2e_review_env.py serve "$WORK/fic" --port "$FIC_INTERNAL_PORT" >"$WORK/fic-internal.log" 2>&1 & PIDS+=($!)
# Genel API (production ayarı): yalnızca yayın anlık görüntüsü; dosya değişince kendiliğinden yenilenir.
VAKIFNAME_DEMO_API=off VAKIFNAME_CORS_ORIGINS="$(U "$PREVIEW_PORT")" VAKIFNAME_PUBLIC_CATALOG_FILE="$WORK/public/catalog.json" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PUBLIC_PORT" --log-level warning >"$WORK/public.log" 2>&1 & PIDS+=($!)
# Demo uçları açık API: yalnızca geliştirme sunucusundaki Demo Keşif Oyunu testi için.
VAKIFNAME_DEMO_API=on VAKIFNAME_CORS_ORIGINS="$(U "$DEV_PORT"),$(U "$FIC_DEV_PORT")" VAKIFNAME_PUBLIC_CATALOG_FILE="$WORK/none.json" \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$DEMO_API_PORT" --log-level warning >"$WORK/demo-api.log" 2>&1 & PIDS+=($!)

cd "$ROOT/frontend"
VITE_API_BASE_URL="$(U "$PUBLIC_PORT")" "$VITE" build --outDir "$WORK/dist" --emptyOutDir >"$WORK/build.log" 2>&1
node scripts/check-public-build.mjs "$WORK/dist"
(cd "$ROOT/backend" && exec "$PY" -m app.web --dist "$WORK/dist" --api-origin "$(U "$PUBLIC_PORT")" --port "$PREVIEW_PORT") \
  >"$WORK/web.log" 2>&1 & PIDS+=($!)
VAKIFNAME_REVIEW_API_TARGET="$(U "$INTERNAL_PORT")" VITE_API_BASE_URL="$(U "$DEMO_API_PORT")" \
  "$VITE" --host 127.0.0.1 --port "$DEV_PORT" --strictPort >"$WORK/dev.log" 2>&1 & PIDS+=($!)
VAKIFNAME_REVIEW_API_TARGET="$(U "$FIC_INTERNAL_PORT")" VITE_API_BASE_URL="$(U "$DEMO_API_PORT")" \
  "$VITE" --host 127.0.0.1 --port "$FIC_DEV_PORT" --strictPort >"$WORK/fic-dev.log" 2>&1 & PIDS+=($!)

for port in "$INTERNAL_PORT" "$FIC_INTERNAL_PORT"; do wait_http "$(U "$port")/internal/status"; done
for port in "$PUBLIC_PORT" "$DEMO_API_PORT" "$PREVIEW_PORT" "$DEV_PORT" "$FIC_DEV_PORT"; do wait_http "$(U "$port")/"; done

STATUS=0
API_CHECKS=("$PY" "$ROOT/backend/scripts/e2e_api_checks.py" --internal "$INTERNAL_PORT" --public "$PUBLIC_PORT" --workdir "$WORK/env")
node e2e/s1-public-preview.cjs "$(U "$PREVIEW_PORT")" "$OUT" || STATUS=1
node e2e/s1b-demo-dev.cjs "$(U "$DEV_PORT")" "$OUT" || STATUS=1
node e2e/s2-internal-review.cjs "$(U "$DEV_PORT")" "$OUT" "$WORK/env" || STATUS=1
node e2e/s5-video-hero.cjs "$(U "$PREVIEW_PORT")" "$(U "$DEV_PORT")" "$OUT" || STATUS=1
node e2e/s4-research-map.cjs "$(U "$DEV_PORT")" "$OUT" "$WORK/env" || STATUS=1
"${API_CHECKS[@]}" || STATUS=1

# S6: kurgusal eser için kimlik onayı (form) → dışa aktarıcı → genel API kendiliğinden yenilenir → ana sayfa.
node e2e/s6-identity-publication.cjs onayla "$(U "$FIC_DEV_PORT")" "$OUT" "$WORK/fic" || STATUS=1
cd "$ROOT/backend"
VAKIFNAME_INTERNAL_DATA_DIR="$WORK/fic" VAKIFNAME_RESEARCH_FILE="$WORK/fic/research.json" \
  "$PY" -m app.internal.publish --out "$WORK/public/catalog.json" --actor e2e >"$WORK/publish.log" 2>&1 || STATUS=1
cd "$ROOT/frontend"
node e2e/s6-identity-publication.cjs genel "$(U "$PREVIEW_PORT")" "$OUT" || STATUS=1
"${API_CHECKS[@]}" --fictional --expect 1 || STATUS=1

# S3: tam kurgusal karar zinciri (olgu + doğrulanmış konum) aynı dosyaya atomik olarak yazılır; API yeniden başlatılmaz.
cd "$ROOT/backend"
"$PY" scripts/e2e_fictional_catalog.py "$WORK/fictional" >"$WORK/fictional.log"
mv "$WORK/fictional/public/catalog.json" "$WORK/public/catalog.json"
cd "$ROOT/frontend"
node e2e/s3-fictional-catalog.cjs "$(U "$PREVIEW_PORT")" "$OUT" || STATUS=1
"${API_CHECKS[@]}" --fictional || STATUS=1

echo "Ekran görüntüleri: $OUT"
exit $STATUS
