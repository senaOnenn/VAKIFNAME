#!/usr/bin/env bash
# Demo yedeğini bu dizüstünde açar: canlıyla aynı sürüm ve içerik, internetsiz de çalışır.
#   API  → http://localhost:8000      Arayüz (derlenmiş, canlıdaki gibi) → http://localhost:5173
# Önce: deploy/yedek/esitle.sh (içerik). Ctrl+C ikisini de kapatır.
#
#   deploy/yedek/calistir.sh            # arayüzü derleyip açar
#   deploy/yedek/calistir.sh --hizli    # son derlemeyi kullanır (internet yokken npm gerekmez)
# Portlar 8000/5173 olmalı (Google girişi ve çerez bu adreslere göre); deneme için API_PORT / WEB_PORT verilebilir.
set -euo pipefail
API_PORT=${API_PORT:-8000}
WEB_PORT=${WEB_PORT:-5173}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DEST=${VAKIFNAME_YEDEK_DIR:-$HOME/vakifname-yedek}
[ -f "$DEST/yedek.env" ] || { echo "Önce içerik eşitlenmeli: deploy/yedek/esitle.sh"; exit 1; }
for port in $API_PORT $WEB_PORT; do
  if lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port dolu (geliştirme sunucusu açık olabilir). Kapatıp yeniden deneyin:"; lsof -nP -iTCP:$port -sTCP:LISTEN | tail -n +2
    exit 1
  fi
done

cd "$ROOT"
# Bağımlılıklar yalnızca eksikse ya da değiştiyse kurulur (internetsiz açılış için).
[ -x backend/.venv/bin/python ] || python3 -m venv backend/.venv
REQ_SHA=$(shasum backend/requirements.txt | cut -d' ' -f1)
if [ "$(cat backend/.venv/.req-sha 2>/dev/null)" != "$REQ_SHA" ]; then
  backend/.venv/bin/pip install -q -r backend/requirements.txt && echo "$REQ_SHA" > backend/.venv/.req-sha
fi
[ -d frontend/node_modules ] || (cd frontend && npm ci)
if [ "${1:-}" != "--hizli" ] || [ ! -f frontend/dist/index.html ]; then
  (cd frontend && VITE_API_BASE_URL=http://localhost:$API_PORT npm run build >/dev/null) && echo "Arayüz derlendi."
fi

(cd backend && set -a && . "$DEST/yedek.env" && set +a && VAKIFNAME_CORS_ORIGINS=http://localhost:$WEB_PORT \
  VAKIFNAME_PUBLIC_BASE_URL=http://localhost:$WEB_PORT exec .venv/bin/uvicorn app.main:app --port "$API_PORT" --log-level warning) &
API=$!
trap 'kill $API 2>/dev/null || true' EXIT INT TERM
for _ in $(seq 1 30); do curl -sf "http://localhost:$API_PORT/" >/dev/null && break; sleep 0.5; done
echo "Yedek açık → http://localhost:$WEB_PORT  (sunum modu açık; Ctrl+C kapatır)"
cd frontend && npx vite preview --port "$WEB_PORT" --strictPort
