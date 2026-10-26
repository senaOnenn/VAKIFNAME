"""Hackathon ZIP arşivindeki 121 fotoğrafı genel sitenin eser sayfalarına ek koleksiyon olarak yazar (Görev 30).

Girdi: `build_hackathon_zip_overlay.py` çıktısı (`manifests/hackathon_zip_overlay_v1.json`) ve sRGB görüntüleme
kopyaları (`images/hackathon_zip_display/`). Kopyalar özgün piksel boyutundadır (büyütme yok); burada yeniden
kodlanmaz, yalnızca SHA-256 adıyla genel medya klasörüne kopyalanır.

Çıktı: genel kataloğun yanındaki `archive_collection.json` (bkz. `app/public_catalog.py`). Fotoğraflar ZIP klasörüne
göre gösterilir; belgelenmiş kimlik çelişkisi her fotoğrafın açıklamasında yazılır. Lisans veya hak sahibi bilgisi
üretilmez. Genel katalog (`catalog.json`), insan kararları ve görsel tanıma indeksi değişmez.

    python scripts/build_public_archive_collection.py --data-dir /var/lib/vakifname-internal \\
        --public-dir ../data/public_catalog [--write]

Varsayılan kuru çalıştırmadır. `--write`: medya dosyaları ve koleksiyon atomik olarak yazılır.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

OVERLAY = "manifests/hackathon_zip_overlay_v1.json"
DISPLAY_DIR = "images/hackathon_zip_display"
OUT = "archive_collection.json"
SOURCE_LABEL = "Hackathon veri paketi / Proje ekibinin hazırladığı görsel arşiv"
NOTE = ("Bu fotoğraflar proje arşivindeki klasör sınıflandırmasıyla gösterilir. Eser kimliği her fotoğraf için "
        "doğrulanmamıştır; kaynak kitapta başka bir yapının bölümünde basılı olanlar açıklamasında belirtilir.")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def folder_label(folder: str) -> str:
    return re.sub(r"\s*\(BUR-\d{4}\)\s*$", "", folder).strip()


def identity_note(identity: dict, names: dict[str, str]) -> str | None:
    if identity["status"] == "celiski_yok":
        return None
    other = names.get(identity.get("proposed_monument_id") or "")
    where = f"{other} bölümünde" if other else "başka bir yapının bölümünde"
    return f"Eser kimliği doğrulanmadı: bu fotoğraf envanter kitabında {where} basılı."


def order_key(item: dict):
    n = re.search(r"_(\d+)\.\w+$", item["zip"]["file"])
    return item["identity"]["status"] != "celiski_yok", int(n.group(1)) if n else 0, item["zip"]["file"]


def build(data_dir: Path, public_dir: Path) -> tuple[dict, list[tuple[Path, Path]]]:
    overlay = json.loads((data_dir / OVERLAY).read_text(encoding="utf-8"))
    catalog = json.loads((public_dir / "catalog.json").read_text(encoding="utf-8"))
    names = {m["monument_id"]: m["name"] for m in catalog["monuments"]}
    media = public_dir / "media"
    images, copies = [], []
    for item in sorted(overlay["items"], key=lambda i: (i["monument_id"], *order_key(i))):
        if item["monument_id"] not in names:
            sys.exit(f"{item['image_id']}: {item['monument_id']} genel katalogda yok.")
        files = {}
        for kind in ("detail", "card"):
            d = item["display"][kind]
            src = data_dir / DISPLAY_DIR / d["relative_path"]
            if sha(src) != d["sha256"]:
                sys.exit(f"{src}: SHA-256 manifestle uyuşmuyor.")
            with Image.open(src) as im:
                if im.mode != "RGB" or im.size != (d["width"], d["height"]):
                    sys.exit(f"{src}: sRGB/RGB değil veya boyut farklı ({im.mode} {im.size}).")
            files[kind] = f"{d['sha256']}.jpg"
            copies.append((src, media / files[kind]))
        detail = item["display"]["detail"]
        if (detail["width"], detail["height"]) != (item["zip"]["width"], item["zip"]["height"]):
            sys.exit(f"{item['image_id']}: görüntüleme kopyası özgün boyutta değil.")
        images.append({
            "image_id": f"zip/{item['image_id']}",
            "monument_id": item["monument_id"],
            "file": files["detail"],
            "card_file": files["card"],
            "width": detail["width"],
            "height": detail["height"],
            "archive_folder": folder_label(item["zip"]["folder"]),
            "identity": item["identity"]["status"],
            "identity_note": identity_note(item["identity"], names),
        })
    doc = {"schema": "vakifname.archive_collection/1", "collection_id": "hackathon_zip_20261025",
           "source_label": SOURCE_LABEL, "note": NOTE, "images": images}
    return doc, copies


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--public-dir", type=Path, required=True)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    doc, copies = build(args.data_dir, args.public_dir)
    per = Counter(i["monument_id"] for i in doc["images"])
    conflicts = Counter(i["monument_id"] for i in doc["images"] if i["identity"] != "celiski_yok")
    for mid in sorted(per):
        print(f"{mid}: {per[mid]} fotoğraf ({conflicts[mid]} kimlik çelişkili)")
    print(f"Toplam {len(doc['images'])} fotoğraf, {len(copies)} medya dosyası.")
    if not args.write:
        print("Kuru çalıştırma; yazmak için --write.")
        return
    for src, dst in copies:
        if not dst.exists():
            tmp = dst.with_suffix(".tmp")
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
        elif sha(dst) != dst.stem:
            sys.exit(f"{dst}: var ama içeriği adıyla uyuşmuyor.")
    out = args.public_dir / OUT
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, out)
    print(f"Yazıldı: {out}")


if __name__ == "__main__":
    main()
