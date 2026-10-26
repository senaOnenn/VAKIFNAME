"""Hackathon ZIP arşivindeki 121 eser fotoğrafını mevcut arşiv kayıtlarına bağlayan ek katman (overlay) üretir.

ZIP'teki her dosya, V20 arşivindeki (`manifests/image_manifest.json`) aynı ad ve aynı SHA-256'lı kayda bağlanır; yeni
envanter kaydı açılmaz, eski 325 kayıtlık manifest değiştirilmez. Özgün dosyalar okunur, asla değiştirilmez.

Görüntüleme kopyaları: özgünler CMYK JPEG'dir (tarayıcılarda renk sorunu). sRGB'ye çevrilir; ayrıntı kopyası özgün
piksel boyutundadır (büyütme yok), 4:4:4 renk örneklemesiyle yüksek kalitede kaydedilir; kart kopyası yalnızca uzun
kenar 640 px'ten büyükse küçültülür.

    python scripts/build_hackathon_zip_overlay.py --zip /root/images-20261025T172633Z-1-001.zip \\
        --data-dir /var/lib/vakifname-internal [--write]

Varsayılan kuru çalıştırmadır. `--write`: görüntüleme kopyaları (`images/hackathon_zip_display/`) ve ek katman
(`manifests/hackathon_zip_overlay_v1.json`) yazılır; aynı içerik varsa dokunulmaz, farklıysa durur.
"""

import argparse
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

QUARANTINE = "quarantine/bursa_images_import_20261025/images"
RELABEL = "manifests/image_relabel_bursa_images_import_20261025.json"
ARCHIVE = "manifests/image_manifest.json"
DISPLAY_DIR = "images/hackathon_zip_display"
OUT = "manifests/hackathon_zip_overlay_v1.json"
CARD_MAX = 640
NAMES = {"BUR-0001": "Ulu Cami", "BUR-0003": "Muradiye Camii", "BUR-0005": "Muradiye Medresesi",
         "BUR-0007": "Sultan II. Murad Türbesi", "BUR-0008": "Cem Sultan Türbesi", "BUR-0009": "Koza Han",
         "BUR-0013": "Pirinç Han", "BUR-0014": "Yıldırım Bayezid Bedesteni", "BUR-0019": "Osman Gazi Türbesi",
         "BUR-0020": "Orhan Gazi Türbesi"}
SOURCE = {
    "kind": "hackathon_drive_zip",
    "provided_by": "KÖK&KOD Hackathonu (Bilişim Vadisi) — organizatörün Google Drive veri paketi; takımca ZIP olarak sunucuya yüklendi",
    "dataset_definition": "Yarışma şartnamesi §1 'Veri Seti': sponsor kurumun yarışmacıların kullanımına sunduğu, vakıf eserlerine "
                          "ilişkin metin, görsel ve kaynaklardan oluşan içerik paketi.",
    "presumed_rights_holder": "Vakıf Katılım — Bursa Vakıf Eserleri Envanteri (2025; bilgi notuna göre kitap baskı sürecinde)",
    "documents": [
        "/root/hackathon-drive/yarisma_bilgileri/kök_kod_yarisma_sartnamesi.pdf (§1, §2, §8, §9, §10)",
        "/root/hackathon-drive/yarisma_bilgileri/KÖK&KOD HACKATHONU - VAKIF ESERLERİ ENVANTER PROJESİ BİLGİ NOTU.pdf",
    ],
}
RIGHTS = {
    "license_status": "izin_belgesi_bekleniyor",
    "allowed_now": "Yalnızca yetkili dahili önizleme (8765, loopback). Genel yayın, harici API ve aktif referans indeksi yok.",
    "finding": "Şartname veri setini yarışmacıların kullanımına sunar ve uygulamada kullanılmasını bekler; ancak kamuya açık "
               "yayın lisansı, atıf biçimi, süre ve çözünürlük koşulu yazılı değildir. Görsel kullanım hakkı ve lisans uygunluğu "
               "takımın sorumluluğundadır (§8, §10). Bu nedenle yayın için yazılı izin (written_permission) gerekir.",
    "required_for_publication": "Hak kararında lisans 'written_permission' ve izin belgesi referansı.",
}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def encode(im: Image.Image, max_side=None) -> bytes:
    if max_side and max(im.size) > max_side:
        im = im.copy()
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=92, subsampling=0, optimize=True, progressive=True)
    return buf.getvalue()


def identity(item: dict, folder_label: str, sections: dict) -> dict:
    m = item["match"]
    evidence = {"book": m["pdf"], "physical_page": m["page"], "pixel_match_corr": m["corr"],
                "documented_in": "Görev 27 kitap sayfası eşleştirmesi (image_relabel_bursa_images_import_20261025.json)"}
    if item["identity_status"] == "dogrulandi" and item["verified_monument_id"] == folder_label:
        return {"status": "celiski_yok", "summary": f"Fotoğraf kitapta {NAMES[folder_label]} bölümünde basılı.",
                "evidence": evidence, "proposed_monument_id": None}
    if item["identity_status"] == "dogrulandi":
        other = item["verified_monument_id"]
        return {"status": "belgelenmis_celiski", "kind": "baska_katalog_eseri",
                "summary": f"Klasör {NAMES[folder_label]} diyor; fotoğraf kitapta {NAMES[other]} bölümünde basılı.",
                "evidence": evidence, "proposed_monument_id": other}
    pdf, lo, hi, _ = sections[folder_label]
    return {"status": "belgelenmis_celiski", "kind": "katalog_disi_bolum",
            "summary": f"Klasör {NAMES[folder_label]} diyor; fotoğraf kitapta katalog dışı bir yapının bölümünde basılı "
                       f"({m['pdf']} s.{m['page']}; {NAMES[folder_label]} bölümü s.{lo}–{hi}; yakın başlık: "
                       f"{item.get('book_section_guess') or '—'}).",
            "evidence": evidence, "proposed_monument_id": None}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, type=Path)
    ap.add_argument("--data-dir", required=True, type=Path)
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    d = a.data_dir
    zbytes = a.zip.read_bytes()
    z = zipfile.ZipFile(io.BytesIO(zbytes))
    relabel = json.loads((d / RELABEL).read_text(encoding="utf-8"))
    by_file = {i["file"]: i for i in relabel["items"]}
    archive = {}
    for r in json.loads((d / ARCHIVE).read_text(encoding="utf-8"))["images"]:
        archive.setdefault((r["relative_path"].split("/")[-1], r["sha256"]), []).append(r)
    errors, items, writes = [], [], []
    for info in sorted(z.infolist(), key=lambda i: i.filename):
        if info.is_dir():
            continue
        data = z.read(info)
        digest = sha(data)
        inner = info.filename.split("/", 1)[1] if info.filename.startswith("images/") else info.filename
        folder, fname = inner.rsplit("/", 1)
        q = d / QUARANTINE / inner
        if not q.is_file() or sha(q.read_bytes()) != digest:
            errors.append(f"{inner}: karantina kopyası ZIP ile aynı değil")
            continue
        rel = by_file.get(fname)
        recs = archive.get((fname, digest), [])
        label = folder[folder.rindex("(") + 1:folder.rindex(")")]
        recs = [r for r in recs if r["monument_id"] == label]
        if rel is None or rel["sha256"] != digest or len(recs) != 1:
            errors.append(f"{inner}: arşiv kaydı veya Görev 27 kaydı tekil eşleşmedi")
            continue
        with Image.open(io.BytesIO(data)) as im:
            im.load()
            mode, size = im.mode, im.size
            rgb = im.convert("RGB")
        stem = Path(fname).stem
        det, card = encode(rgb), encode(rgb, CARD_MAX)
        variants = {}
        for name, blob in (("detail", det), ("card", card)):
            relp = f"{label}/{stem}-{name}.jpg"
            with Image.open(io.BytesIO(blob)) as v:
                variants[name] = {"relative_path": relp, "sha256": sha(blob), "size_bytes": len(blob),
                                  "width": v.width, "height": v.height}
            writes.append((d / DISPLAY_DIR / relp, blob))
        ident = identity(rel, label, relabel["catalog_sections"])
        short = min(size)
        items.append({
            "image_id": recs[0]["image_id"], "monument_id": label,
            "zip": {"path": info.filename, "folder": folder, "file": fname, "sha256": digest, "size_bytes": len(data),
                    "width": size[0], "height": size[1], "color_mode": mode},
            "identity": ident,
            "quality": {"short_side_px": short, "resolution": "dusuk" if short < 300 else ("orta" if short < 700 else "iyi"),
                        "note": "Görüntüleme kopyası özgün piksel boyutunda; büyütülmez."},
            "display": variants,
            "reference_index": {
                "eligible_now": False,
                "blocked_by": ["izin_belgesi_bekleniyor"] + (["belgelenmis_kimlik_celiskisi"] if ident["status"] != "celiski_yok" else [])
                              + (["dusuk_cozunurluk"] if short < 224 else []),
            },
        })
    zsha = sha(zbytes)
    out = {
        "schema": "vakifname.hackathon_zip_overlay/1",
        "zip": {"name": a.zip.name, "original_path": str(a.zip), "sha256": zsha, "size_bytes": len(zbytes),
                "entries": len(z.infolist())},
        "source": SOURCE, "rights": RIGHTS,
        "identity_policy": "ZIP klasörü başlangıç sınıflandırmasıdır ve değiştirilmez. Yalnızca belgelenmiş somut çelişki "
                           "(fotoğrafın kitapta başka bir yapının bölümünde basılı olması) işaretlenir; çelişkili fotoğraf o "
                           "eserin galerisinde gösterilmez, incelemeye ayrılır. Başka katalog eserine ait olduğu kitapla "
                           "doğrulananlar yalnızca öneri olarak o esere listelenir.",
        "visual_spot_check": "Görev 30: 10 klasörün tamamı onaylı Commons fotoğraflarıyla yan yana gözle incelendi; "
                             "belgelenmiş çelişkilerin hepsinde fotoğraf başka bir yapıyı gösteriyor.",
        "items": items,
    }
    body = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    stat = {"zip_entries": len(z.infolist()), "items": len(items), "errors": len(errors),
            "celiski_yok": sum(i["identity"]["status"] == "celiski_yok" for i in items),
            "belgelenmis_celiski": sum(i["identity"]["status"] != "celiski_yok" for i in items),
            "baska_katalog_eserine_onerilen": sum(bool(i["identity"]["proposed_monument_id"]) for i in items)}
    print(json.dumps(stat, ensure_ascii=False))
    for e in errors:
        print("HATA", e)
    if errors:
        return 2
    if a.write:
        for path, blob in writes:
            if path.exists():
                if path.read_bytes() != blob:
                    print(f"DUR: {path} farklı içerikle mevcut")
                    return 3
                continue
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.write_bytes(blob)
            path.chmod(0o600)
        target = d / OUT
        if target.exists() and target.read_text(encoding="utf-8") == body:
            print("ek katman değişmedi")
        else:
            target.write_text(body, encoding="utf-8")
            target.chmod(0o600)
            print("yazıldı:", target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
