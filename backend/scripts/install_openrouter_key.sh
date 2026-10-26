#!/usr/bin/env bash
# OpenRouter API anahtarını sunucudaki korumalı secret dosyasına yazar. Yalnızca yetkili proje sorumlusu, kendi SSH
# oturumunda ve etkileşimli bir terminalde çalıştırır. Anahtar ekrana, komut geçmişine, süreç listesine veya loga düşmez:
#   sudo bash backend/scripts/install_openrouter_key.sh
# Anahtarı sohbete, e-postaya veya komut satırı argümanı olarak yazmayın.
set -euo pipefail
umask 077

DEST=/etc/vakifname/secrets/openrouter_api_key

if [[ $EUID -ne 0 ]]; then
  echo "root olarak çalıştırın (sudo)." >&2
  exit 1
fi
if [[ ! -t 0 ]]; then
  echo "Etkileşimli terminal gerekli; anahtar başka bir yerden aktarılamaz." >&2
  exit 1
fi

install -d -m 700 -o root -g root "$(dirname "$DEST")"
IFS= read -rs -p "OpenRouter API anahtarı (görünmez): " key
echo
if [[ ! "$key" =~ ^sk-or-[A-Za-z0-9_-]{20,200}$ ]]; then
  unset key
  echo "Anahtar biçimi beklenen gibi değil (sk-or-… ile başlamalı, boşluk içermemeli). Hiçbir şey yazılmadı." >&2
  exit 1
fi

tmp=$(mktemp "$(dirname "$DEST")/.openrouter_api_key.XXXXXX")
printf '%s\n' "$key" > "$tmp"
unset key
chown root:root "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$DEST"
echo "Kaydedildi: $DEST (root, 600). Anahtar gösterilmedi."
echo "Doğrulama (token harcamaz): cd /root/vakifname/backend && .venv/bin/python scripts/openrouter_check.py status"
