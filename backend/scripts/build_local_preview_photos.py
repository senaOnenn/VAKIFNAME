"""Yerel önizleme fotoğrafları (R6.15.2): seçilmiş envanter fotoğraflarının görüntüleme kopyalarını ve manifestini üretir.

Bu fotoğraflar YAYINDA DEĞİLDİR. Aktarım manifestinde kamuya dağıtım izni onaylanmamıştır (`public_distribution_allowed:
false`); kopyalar yalnızca bu bilgisayardaki erişimi sınırlı hackathon önizlemesinde, `VAKIFNAME_LOCAL_PREVIEW_PHOTOS_DIR`
tanımlıyken ve yalnızca loopback isteğine sunulur (bkz. app/local_preview.py). Kaynak atfı yayın izni değildir: manifestte
`source` (kitap ve cilt) ile `publication` (izin durumu) ayrı alanlardır. Fotoğrafçı ve lisans bilinmez; yazılmaz.

Girdi: seçim JSON'u (`vakifname.local_preview_selection/1`: eser kimliği, kaynak dosya, kitap ve cilt, PDF sayfası) ve
özgün fotoğraf kökü. Seçim, fotoğrafların envanter PDF'lerindeki gömülü görsellerle piksel eşleşmesine ve kitabın bölüm
sınırlarına göre yapılmıştır (klasör adına göre değil). Özgün dosyalar yalnızca okunur.

Çıktı (`--out`, varsayılan `%LOCALAPPDATA%/vakifname/local_preview_photos`): `media/<özet>-lg.webp` (uzun kenar en çok
1600 px, büyütme yok), `media/<özet>-sm.webp` (480 px önizleme) ve `manifest.json`. CMYK → sRGB; EXIF/ICC/XMP yazılmaz.
Aynı içerik varsa dokunulmaz; farklı içerikli aynı ad varsa durur.

    python scripts/build_local_preview_photos.py --selection secim.json --src "<...>/monuments/monuments" [--out <klasör>]
"""

import argparse
import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps

LARGE, SMALL = 1600, 480
PUBLICATION = {
    "status": "izin_bekleniyor",
    "public": False,
    "scope": "yalnizca_yerel_onizleme",
    "note": "Kamuya dağıtım izni doğrulanmadı (aktarım manifesti: public_distribution_allowed=false, "
            "source_license_review=pending). Kaynak atfı yayın izni değildir.",
}


def webp(im: Image.Image, side: int, quality: int) -> tuple[bytes, tuple[int, int]]:
    im = im.copy()
    if max(im.size) > side:
        im.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=quality, method=6)  # üst veri (exif/icc/xmp) verilmez
    return buf.getvalue(), im.size


def write_once(path: Path, data: bytes):
    if path.exists():
        if path.read_bytes() != data:
            raise SystemExit(f"Farklı içerikli dosya zaten var, durduruldu: {path}")
        return
    path.write_bytes(data)


def default_out() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "vakifname" / "local_preview_photos"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selection", required=True, type=Path)
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    sel = json.loads(a.selection.read_text(encoding="utf-8"))
    if sel.get("schema") != "vakifname.local_preview_selection/1":
        raise SystemExit("Seçim dosyasının şeması tanınmadı.")
    out = a.out or default_out()
    media = out / "media"
    media.mkdir(parents=True, exist_ok=True)
    images, seen = [], set()
    for s in sel["selection"]:
        raw = (a.src / s["source_file"]).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest in seen:
            raise SystemExit(f"Aynı fotoğraf iki kez seçilmiş: {s['source_file']}")
        seen.add(digest)
        with Image.open(io.BytesIO(raw)) as im:
            rgb = ImageOps.exif_transpose(im).convert("RGB")  # CMYK → sRGB (gömülü profil yok)
        lg, lg_size = webp(rgb, LARGE, 86)
        sm, _ = webp(rgb, SMALL, 78)
        stem = digest[:20]
        write_once(media / f"{stem}-lg.webp", lg)
        write_once(media / f"{stem}-sm.webp", sm)
        images.append({
            "image_id": f"LP-{stem}",
            "monument_id": s["monument_id"],
            "file": f"{stem}-lg.webp",
            "card_file": f"{stem}-sm.webp",
            "width": lg_size[0],
            "height": lg_size[1],
            # Basılı sayfa yalnızca PDF sayfa metninde okunduysa (R6.15.3); yoksa None, tahmin edilmez.
            "source": {"publication": s["book"], "verified_by": "pdf_embedded_image_match",
                       "pdf_file": s["pdf"], "pdf_page": s["pdf_page"], "printed_pages": s.get("printed_pages")},
            "original_sha256": digest,
            "original_name": s["original_name"],
            "archive_folder": s["archive_folder"],
            "photographer": None,
            "license": None,
        })
    manifest = {"schema": "vakifname.local_preview_photos/1", "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "publication": PUBLICATION, "images": images}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in media.glob("*.webp"))
    print(f"{len(images)} fotoğraf → {out} (WebP toplam {size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
