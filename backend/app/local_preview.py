"""Yerel önizleme fotoğrafları (R6.15.2): yayın izni henüz doğrulanmamış envanter fotoğraflarını YALNIZCA bu bilgisayardaki
erişimi sınırlı hackathon önizlemesinde sunar.

Üç kilit birlikte gerekir; biri eksikse uçlar 404 döner ve fotoğrafların varlığı belli olmaz:

1. `VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR` tanımlı ve içinde geçerli `manifest.json` var. Canlı sunucuda bu değişken ASLA
   tanımlanmaz (bkz. .env.example); dosyalar repoda ve yayın paketinde yoktur (proje dışındaki kullanıcıya özel klasör).
2. İstek loopback adresinden gelir (127.0.0.1 / ::1).
3. İstek bir vekil sunucudan geçmemiştir (`X-Forwarded-For`, `Forwarded`, `X-Real-IP` başlığı yok): canlı ortamda ters
   vekil arkasında loopback görünen istekler de reddedilir.

Kaynak ve yayın izni ayrıdır: yanıtta `source` (envanter yayını ve cildi; PDF'teki gömülü görselle piksel eşleşmesiyle
doğrulandı) ile `publication` (izin durumu: bekleniyor, kamuya açık değil) ayrı alanlardır. Fotoğrafçı ve lisans bilinmez,
yazılmaz. Bu fotoğraflar katalogda değildir: tarihî bilgi motoruna, görsel tanımaya, oyuna ve sorulara girmez.
"""

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Path as PathParam, Request
from fastapi.responses import FileResponse

from .public_catalog import MonumentId

logger = logging.getLogger("vakifname.local_preview")
router = APIRouter()
ENV = "VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR"
SCHEMA = "vakifname.local_preview_photos/1"
FILE_RE = re.compile(r"^[0-9a-f]{20}-(lg|sm)\.webp$")
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}
PROXY_HEADERS = ("x-forwarded-for", "forwarded", "x-real-ip")
NOT_FOUND = "Bulunamadı."


@lru_cache(maxsize=4)
def _load(directory: str, mtime: float) -> Optional[dict]:
    try:
        data = json.loads((Path(directory) / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("yerel önizleme manifesti okunamadı: %s", directory)
        return None
    if data.get("schema") != SCHEMA or data.get("publication", {}).get("public") is not False:
        logger.warning("yerel önizleme manifesti reddedildi (şema veya yayın durumu)")
        return None
    by_monument: dict[str, list[dict]] = {}
    for img in data.get("images", ()):
        if not (FILE_RE.match(img.get("file", "")) and FILE_RE.match(img.get("card_file", ""))):
            continue
        by_monument.setdefault(img["monument_id"], []).append(img)
    # R6.15.3: yalnızca manifestte listelenen dosyalar sunulur (seçkiden çıkarılan fotoğrafın klasörde kalan kopyası açılmaz).
    files = {f for imgs in by_monument.values() for img in imgs for f in (img["file"], img["card_file"])}
    return {"publication": data["publication"], "by_monument": by_monument, "files": files}


def _manifest() -> Optional[tuple[Path, dict]]:
    d = os.environ.get(ENV, "").strip()
    if not d:
        return None
    p = Path(d) / "manifest.json"
    try:
        m = _load(str(Path(d)), p.stat().st_mtime)
    except OSError:
        return None
    return (Path(d), m) if m else None


def _allowed(request: Request) -> bool:
    host = request.client.host if request.client else ""
    if host not in LOOPBACK:
        return False
    return not any(h in request.headers for h in PROXY_HEADERS)


def enabled() -> bool:
    return _manifest() is not None


@router.get("/monuments/{monument_id}/local-photos")
def local_photos(request: Request, monument_id: Annotated[MonumentId, PathParam()]):
    found = _manifest()
    if not found or not _allowed(request):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    _, m = found
    images = [{k: img[k] for k in ("image_id", "file", "card_file", "width", "height")}
              | {"source": img["source"]["publication"], "pdf_page": img["source"].get("pdf_page"),
                 "printed_pages": img["source"].get("printed_pages")}
              for img in m["by_monument"].get(monument_id, [])]
    return {"monument_id": monument_id, "publication": m["publication"], "images": images}


@router.get("/local-media/{file}")
def local_media(request: Request, file: Annotated[str, PathParam(pattern=FILE_RE.pattern)]):
    found = _manifest()
    if not found or not _allowed(request):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    directory, m = found
    path = directory / "media" / file
    if file not in m["files"] or not path.is_file():
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    # Önbellekte de yalnızca bu tarayıcıda kalır (paylaşılan önbelleğe yazılmaz).
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "private, max-age=3600"})
