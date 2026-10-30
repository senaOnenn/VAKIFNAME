"""Önceden üretilecek anlatım seslerinin listesi (30 Ekim kararı, `files` sağlayıcısı; bkz. docs/SES_KAYDI.md).

Sunucunun yayımladığı katalogla (anlık görüntü + yöneticinin onayladığı katman) çalışır; böylece dosya adları sunucunun
arayacağı adlarla birebir aynıdır. Çıktıdaki her iş: dosya adı, dil, seslendirilecek metin. Üretimi ses ortamındaki
`scripts/voice/generate.py` yapar; dosyalar sunucunun önbellek dizinine kopyalanır.

    set -a && . ./.env && set +a
    .venv/bin/python -m app.tts_export --voice talha-1 --out /tmp/vk-voice-jobs.json
"""

import argparse
import json
import os
import sys
from pathlib import Path

from .content.pipeline import content_dir_from_env
from .public_catalog import PublicCatalogRepository
from .tts import LANGUAGES, SpeechService, TtsSettings, narration_texts

DEFAULT_PUBLIC_CATALOG_FILE = Path(__file__).resolve().parents[2] / "data" / "public_catalog" / "catalog.json"


def jobs(catalog, service: SpeechService, langs: list[str]) -> list[dict]:
    """Her yayımlanmış eserin anlatım cümleleri. İngilizce yalnızca onaylı İngilizce kaydı olan eserde (arayüz de öyle)."""
    out: dict[str, dict] = {}
    for m in catalog.monuments:
        for lang in langs:
            if lang == "en" and not any(f.text_en for f in m.facts):
                continue
            for text in sorted(narration_texts(m, lang)):
                file = service.file_for(text, lang)
                out.setdefault(file, {"file": file, "lang": lang, "text": text, "monument_id": m.monument_id,
                                      "ready": service.path(file) is not None})
    return list(out.values())


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--voice", required=True, help="Türkçe ses adı (sunucudaki VAKIFNAME_TTS_VOICE ile aynı olmalı)")
    ap.add_argument("--voice-en", help="İngilizce ses adı (VAKIFNAME_TTS_VOICE_EN); boşsa --voice")
    ap.add_argument("--lang", action="append", choices=sorted(LANGUAGES), help="tekrarlanabilir; varsayılan tr ve en")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args(argv)
    content_dir = Path(d) if (d := content_dir_from_env()) else None
    repo = PublicCatalogRepository(
        Path(os.environ.get("VAKIFNAME_PUBLIC_CATALOG_FILE", DEFAULT_PUBLIC_CATALOG_FILE)),
        overlay_path=content_dir / "published.json" if content_dir else None,
        overlay_media_dir=content_dir / "media" if content_dir else None)
    base = TtsSettings.from_env()
    cache = base.cache_dir or (content_dir / "tts" if content_dir else None)
    service = SpeechService(TtsSettings(provider="files", voice=a.voice, voice_en=a.voice_en or a.voice, cache_dir=cache))
    items = jobs(repo.catalog, service, a.lang or ["tr", "en"])
    a.out.write_text(json.dumps({"voice": {"tr": service.voice("tr"), "en": service.voice("en")},
                                 "cache_dir": str(cache.resolve()) if cache else None, "jobs": items},
                                ensure_ascii=False, indent=1), encoding="utf-8")
    todo = sum(not j["ready"] for j in items)
    print(f"{len(items)} cümle ({todo} eksik) → {a.out}", file=sys.stderr)
    print(f"Sunucu ayarı: VAKIFNAME_TTS_PROVIDER=files VAKIFNAME_TTS_VOICE={service.voice('tr')} "
          f"VAKIFNAME_TTS_VOICE_EN={service.voice('en')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
