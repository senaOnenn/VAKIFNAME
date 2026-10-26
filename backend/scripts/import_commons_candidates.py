"""Görev 28 Commons adaylarını mevcut inceleme envanterine (8765) uyumlu aday dosyasına dönüştürür.

Yalnızca `onaya_hazir` kayıtlar alınır; `test_icin_ayrildi` kayıtları ve dondurulmuş test kümesi hiçbir koşulda alınmaz.
Hiçbir karar, onay veya veritabanı kaydı üretmez. Varsayılan kuru çalıştırmadır (yalnızca denetim ve plan).

    python scripts/import_commons_candidates.py \\
        --collection /var/lib/vakifname-internal/visual_index/reference_collection_commons_v1/collection.json \\
        --media /var/lib/vakifname-internal/images/commons_candidates \\
        --data-dir /var/lib/vakifname-internal \\
        --existing ../data/real_catalog/commons_images.json \\
        --out ../data/real_catalog/commons_images_candidates.json [--write] [--copy-media]

- `--write`: aday dosyasını yazar. Çıktı belirlenimcidir; aynı girdiyle yeniden çalıştırmak aynı baytları üretir.
- `--copy-media`: ayrıntı/kart dosyalarını `<data-dir>/images/commons/` altına kopyalar. Hedef aynı özetle varsa
  atlanır; farklı içerikle varsa durur. Hiçbir dosya silinmez veya üzerine yazılmaz.
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

BATCH_ID = "g28-commons-candidates-v1"
LICENSES = {  # Commons kısa adı -> karar şemasındaki lisans kodu ve beklenen lisans bağlantısı
    "CC BY 2.0": ("CC-BY-2.0", "https://creativecommons.org/licenses/by/2.0"),
    "CC BY 3.0": ("CC-BY-3.0", "https://creativecommons.org/licenses/by/3.0"),
    "CC BY 4.0": ("CC-BY-4.0", "https://creativecommons.org/licenses/by/4.0"),
    "CC BY-SA 2.0": ("CC-BY-SA-2.0", "https://creativecommons.org/licenses/by-sa/2.0"),
    "CC BY-SA 2.5": ("CC-BY-SA-2.5", "https://creativecommons.org/licenses/by-sa/2.5"),
    "CC BY-SA 3.0": ("CC-BY-SA-3.0", "https://creativecommons.org/licenses/by-sa/3.0"),
    "CC BY-SA 4.0": ("CC-BY-SA-4.0", "https://creativecommons.org/licenses/by-sa/4.0"),
    "CC0": ("CC0-1.0", "https://creativecommons.org/publicdomain/zero/1.0"),
}
HOLDOUT = "visual_index/test_sets/commons_holdout_v1/manifest.json"


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def doubts_for(c: dict, flagged_artists: dict) -> list[str]:
    r, out = c["review"], []
    if not any("GPS" in e for e in r["identity_evidence"]):
        out.append("Kamera GPS'i yok: kimlik yalnızca onaylı fotoğraflarla görsel karşılaştırmaya dayanıyor.")
    if r["people"]:
        out.append("Karede uzak/küçük insan figürü var." if r["people"] == 1 else "Karede belirgin insan var.")
    if r["sign_or_text"]:
        out.append("Küçük/okunmaz yazı veya dükkân tabelası var." if r["sign_or_text"] == 1 else "Eser adı okunabiliyor.")
    artist = c["attribution"]["artist"]
    if artist in flagged_artists.get(c["monument_id"], set()) or artist in flagged_artists.get("*", set()):
        out.append(f"{artist} adlı fotoğrafçının Commons'taki başka bir dosyası yanlış başlıklı çıktı (başka yapı); "
                   "eşleşmeyi dikkatle kontrol edin.")
    if any("panoramio" in x.lower() for x in c["source"].get("commons_review_categories", [])) or \
            "panoramio" in c["source"]["title"].lower():
        out.append("Panoramio aktarımı: lisans, Commons'a aktarımdaki Panoramio kaydına dayanıyor.")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collection", required=True, type=Path)
    ap.add_argument("--media", required=True, type=Path)
    ap.add_argument("--data-dir", required=True, type=Path)
    ap.add_argument("--existing", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--copy-media", action="store_true")
    a = ap.parse_args(argv)

    coll = json.loads(a.collection.read_text(encoding="utf-8"))
    existing = json.loads(a.existing.read_text(encoding="utf-8"))["images"]
    archive = json.loads((a.data_dir / "manifests/image_manifest.json").read_text(encoding="utf-8"))["images"]
    holdout = json.loads((a.data_dir / HOLDOUT).read_text(encoding="utf-8"))
    hold_keys = {i["image_id"] for i in holdout["items"]} | {i["commons_title"] for i in holdout["items"]} | \
        {i["commons_sha1"] for i in holdout["items"]} | {v["sha256"] for i in holdout["items"] for v in (i["detail"], i["card"])}
    taken_ids = {i["image_id"] for i in existing} | {i["image_id"] for i in archive}
    taken_paths = {i["relative_path"] for i in existing} | {i["card"]["relative_path"] for i in existing if i.get("card")}
    existing_titles = {i["commons"]["title"] for i in existing}

    # Görev 28 gözle incelemesinde başka yapıyı gösterdiği anlaşılan dosyaların fotoğrafçıları (BUR-0005'te 4,
    # BUR-0009'da 1 dosya). Ret listesinde yazar alanı tutulmadığı için ad burada açıkça kayıtlıdır.
    flagged = {"*": {"Antonina Vyshnevska"}}

    errors, images, copies = [], [], []
    cands = sorted((c for c in coll["images"] if c["status"]["approval"] == "onaya_hazir"), key=lambda c: c["image_id"])
    seen = set()
    for c in cands:
        iid, mid = c["image_id"], c["monument_id"]
        e = lambda msg: errors.append(f"{iid}: {msg}")  # noqa: E731
        if c["status"].get("approved_by") or c["status"].get("reference_index_active") or c["status"].get("public_serving_allowed"):
            e("aday dosyası onay/etkinlik bilgisi taşıyor")
        if iid in seen or iid in taken_ids:
            e("kimlik çakışması")
        seen.add(iid)
        if not re.fullmatch(r"commons/BUR-\d{4}/[0-9a-f]{16}", iid) or not iid.startswith(f"commons/{mid}/"):
            e("kimlik biçimi veya eser öneki hatalı")
        if {iid, c["source"]["title"], c["source"]["commons_sha1"], c["files"]["detail"]["sha256"], c["files"]["card"]["sha256"]} & hold_keys:
            e("test kümesinde")
        if c["source"]["title"] in existing_titles:
            e("aynı Commons dosyası onaylı 60 içinde")
        lic = c["license"]
        if lic["short_name"] not in LICENSES:
            e(f"lisans kapsam dışı: {lic['short_name']}")
        else:
            code, url = LICENSES[lic["short_name"]]
            if lic["code"] != code:
                e(f"lisans kodu {lic['code']} ≠ {code}")
            if lic["url"].rstrip("/") != url:
                e(f"lisans bağlantısı sürümle uyuşmuyor: {lic['url']}")
        if lic.get("restrictions"):
            e("ek kısıtlama var")
        artist = c["attribution"]["artist"].strip()
        if not artist or artist.lower().startswith(("unknown", "no machine-readable")):
            e("fotoğrafçı bilgisi yok")
        if artist not in c["attribution"]["text"] or lic["short_name"] not in c["attribution"]["text"]:
            e("atıf metni yazar veya lisans içermiyor")
        for v in ("detail", "card"):
            f = c["files"][v]
            src = a.media / f["relative_path"]
            if f["relative_path"] in taken_paths or not f["relative_path"].startswith(f"{mid}/"):
                e(f"{v}: yol çakışması veya yanlış klasör")
            if not src.is_file():
                e(f"{v}: dosya yok")
                continue
            if sha256(src) != f["sha256"] or src.stat().st_size != f["size_bytes"]:
                e(f"{v}: SHA-256/boyut uyuşmuyor")
            with Image.open(src) as im:
                im.verify()
            with Image.open(src) as im:
                if im.format != "JPEG" or list(im.size) != [f["width"], f["height"]]:
                    e(f"{v}: JPEG değil veya çözünürlük uyuşmuyor")
            copies.append((src, a.data_dir / "images/commons" / f["relative_path"], f["sha256"]))
        r = c["review"]
        images.append({
            "image_id": iid, "monument_id": mid, "relative_path": c["files"]["detail"]["relative_path"],
            "sha256": c["files"]["detail"]["sha256"], "size_bytes": c["files"]["detail"]["size_bytes"],
            "width": c["files"]["detail"]["width"], "height": c["files"]["detail"]["height"],
            "card": {k: c["files"]["card"][k] for k in ("relative_path", "sha256", "size_bytes", "width", "height")},
            "rank": None,
            "commons": {"title": c["source"]["title"], "file_page_url": c["source"]["file_page_url"],
                        "original_url": c["source"]["original_url"], "original_width": c["source"]["original_width"],
                        "original_height": c["source"]["original_height"], "license_short_name": lic["short_name"],
                        "license_url": lic["url"], "artist": artist, "credit": c["attribution"]["credit"],
                        "description": c["source"]["description"], "date": c["source"]["date"],
                        "category": c["source"]["categories_walked"][0].removeprefix("Category:"),
                        "commons_sha1": c["source"]["commons_sha1"], "thumb_url": None},
            "verification": {
                "monument_match": "Görsel içerik onaylı referanslarla karşılaştırılarak masa başında eşleştirildi "
                                  "(dosya adı/kategori tek başına kanıt sayılmadı); editör onayı gerekir.",
                "notes": r["note"],
                "modification": "En fazla 1600 px (ayrıntı) ve 900 px (kart) genişliğe küçültülüp yeniden sıkıştırıldı; "
                                "kırpma veya içerik değişikliği yok."},
            "review": {"by": r["by"], "angles": c["angles"], "people": r["people"], "sign_or_text": r["sign_or_text"],
                       "identity_evidence": r["identity_evidence"], "confusion_risk": r["confusion_risk"],
                       "license_obligations": lic["obligations"], "doubts": doubts_for(c, flagged),
                       "quality": c["quality"]["status"]},
            # Ön doldurma; onay değildir. Eser eşleşmesi (monument_match) bilerek boş: editör açıkça işaretler.
            "proposed_rights": {"rights_holder": artist, "license": LICENSES.get(lic["short_name"], ("?",))[0],
                                "attribution": c["attribution"]["text"], "source_url": c["source"]["file_page_url"]},
        })
    # Sıra: eser içinde kimliğe göre; rank mevcut 6 fotoğrafın arkasından başlar.
    per = {}
    for img in images:
        per[img["monument_id"]] = per.get(img["monument_id"], 0) + 1
        img["rank"] = 5 + per[img["monument_id"]]
    out = {
        "schema_version": "vakifname-commons-images-v1",
        "batch_id": BATCH_ID,
        "generated_at": coll["generated"],
        "prepared_by": "Claude Code (Görev 28 masa başı ön inceleme; hak kararı değildir)",
        "image_root": "images/commons (VAKIFNAME_INTERNAL_DATA_DIR altında)",
        "status": "İnsan onayı bekliyor. Yalnızca VAKIFNAME_COMMONS_CANDIDATES_FILE tanımlıysa inceleme kuyruğuna girer.",
        "test_set_excluded": {"test_set_id": holdout["test_set_id"], "manifest_sha256": holdout["manifest_sha256"],
                              "count": holdout["count"]},
        "policy": {
            "license_filter": "Yalnızca CC0, CC BY ve CC BY-SA; ek kısıtlama taşıyanlar alınmadı.",
            "obligations": "CC BY / CC BY-SA: yazar adı, lisans adı ve lisans bağlantısı ile kaynak sayfası gösterilmelidir; "
                           "CC BY-SA görselin uyarlamaları aynı lisansla paylaşılmalıdır.",
            "approval": "Bu dosya hiçbir onay içermez. Hak (image_rights), yayın (image_publication) ve görsel tanıma referansı "
                        "(image_reference_index) 'rights' rolündeki incelemecinin ayrı kararlarıdır.",
        },
        "images": images,
    }
    body = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    digest = hashlib.sha256(body.encode()).hexdigest()
    print(f"aday: {len(images)}  hata: {len(errors)}  dosya: {len(copies)}  çıktı özeti: {digest[:16]}")
    for x in errors:
        print("  HATA", x)
    if errors:
        return 2
    if a.write:
        if a.out.exists() and a.out.read_text(encoding="utf-8") == body:
            print(f"değişiklik yok: {a.out}")
        else:
            a.out.write_text(body, encoding="utf-8")
            print(f"yazıldı: {a.out}")
    if a.copy_media:
        new = same = 0
        for src, dst, digest_f in copies:
            if dst.exists():
                if sha256(dst) != digest_f:
                    print(f"DUR: {dst} farklı içerikle mevcut; üzerine yazılmadı.")
                    return 3
                same += 1
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
            if sha256(dst) != digest_f:
                print(f"DUR: kopya doğrulanamadı: {dst}")
                return 3
            new += 1
        print(f"görsel kopyası: yeni {new}, zaten var {same}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
