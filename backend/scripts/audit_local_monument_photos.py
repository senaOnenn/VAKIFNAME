"""Yerel eser fotoğraflarının SALT OKUNUR denetimi (R6.15). Hiçbir dosyayı değiştirmez, kopyalamaz, yayımlamaz.

Kullanıcının sağladığı klasör (ör. `monuments/monuments/<eser klasörü>/*.jpeg`) ve varsa aynı paketin ZIP'i okunur; her
fotoğraf için:

- eser eşleşmesi: klasör adı (Türkçe karakter, büyük/küçük harf ve küçük yazım farkına dayanıklı) katalogdaki ad ve
  onaylı diğer adlarla karşılaştırılır; dosya adındaki katalog kimliği (`BUR-0001_...`) ikinci kanıttır. İkisi çelişirse
  ya da klasör birden çok esere benziyorsa eşleşme "belirsiz" raporlanır, hiçbir esere bağlanmaz;
- dosya: biçim, piksel boyutu, renk kipi (CMYK tarayıcıda sorunludur), açılamayan/bozuk dosya;
- tekrar: aynı içerik (SHA-256) ve görsel olarak aynı fotoğraf (64 bit fark özeti, yeniden kodlanmış kopyalar);
  yayımlanmış katalog görselleriyle çakışma (mevcut lisanslı fotoğraf zaten arşivde);
- üst veri: EXIF konum (GPS), fotoğrafçı/hak sahibi (Artist, Copyright), açıklama, cihaz; XMP hak alanı;
- mahremiyet: rehberin yerel yüz denetimi (app/guide/privacy.py, iki algılayıcının uzlaşması);
- hak: lisans ve atıf belgesi yoksa fotoğraf "inceleme_bekliyor"dur. Lisans bilgisi uydurulmaz; EXIF'te telif yazısı olsa
  bile yayın kararı insan onayıyla (yazılı izin) verilir.

Rapor JSON olarak `--out` yoluna yazılır (varsayılan: bu kullanıcıya özel yerel klasör). Kişisel üst veri (fotoğrafçı
adı, GPS koordinatı) rapora yazılmaz; yalnızca var/yok bilgisi yazılır.

    python scripts/audit_local_monument_photos.py --src "<...>/monuments/monuments" --zip "<...>/monuments.zip" \\
        --catalog tests/ask_eval/catalog_snapshot.json --media tests/ask_eval/media
"""

import argparse
import hashlib
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
ID_RE = re.compile(r"(?<![A-Za-z0-9])(BUR-\d{4})(?!\d)", re.I)  # "BUR-0001_Ulucami_1.jpeg": alt çizgi sözcük harfidir
GPS_TAG, ARTIST, COPYRIGHT, DESCRIPTION, MAKE, MODEL = 0x8825, 0x013B, 0x8298, 0x010E, 0x010F, 0x0110
NEAR_DUP = 6  # 64 bit fark özetinde en çok bu kadar bit farkı: görsel olarak aynı fotoğraf


def fold(s: str) -> str:
    """Türkçe küçük harf, ı→i, aksan/şapka/çengel düşer, noktalama boşluk olur."""
    s = s.replace("I", "ı").replace("İ", "i").lower().replace("ı", "i")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# Klasör ve eser adlarındaki genel sözcükler ve yazım varyantları (anlamı değiştirmez).
CANON = {"camii": "cami", "cami": "cami", "ulucami": "ulu cami", "hani": "han", "han": "han", "turbesi": "turbe",
         "turbe": "turbe", "medresesi": "medrese", "bedesteni": "bedesten", "2": "ii", "ii": "ii", "beyazid": "bayezid",
         "bayezit": "bayezid", "busa": "bursa"}


def tokens(name: str) -> set[str]:
    out = []
    for w in fold(name).split():
        w = CANON.get(w, w)
        out.extend(w.split())
    return {w for w in out if w not in {"bursa", "sultan"}} or set(out)


def match_folder(folder: str, monuments: list[dict]) -> tuple[list[str], dict]:
    """Klasöre en iyi uyan eser(ler): her eser adı ve diğer adı için ortak sözcük oranı (Jaccard)."""
    ft = tokens(folder)
    scores = {}
    for m in monuments:
        names = [m["name"], *m.get("alternative_names", [])]
        scores[m["monument_id"]] = max(len(ft & tokens(n)) / len(ft | tokens(n)) for n in names)
    best = max(scores.values())
    return [k for k, v in scores.items() if v == best and best >= 0.5], scores


def dhash(im: Image.Image) -> int:
    g = im.convert("L").resize((9, 8), Image.LANCZOS)
    px = list(g.getdata())
    return sum(1 << i for i in range(64) if px[(i // 8) * 9 + i % 8] > px[(i // 8) * 9 + i % 8 + 1])


def exif_report(im: Image.Image, raw: bytes) -> dict:
    ex = im.getexif()
    gps = ex.get_ifd(GPS_TAG) if GPS_TAG in ex else {}
    return {
        "gps": bool(gps),
        "artist": bool(str(ex.get(ARTIST, "")).strip()),
        "copyright": bool(str(ex.get(COPYRIGHT, "")).strip()),
        "description": bool(str(ex.get(DESCRIPTION, "")).strip()),
        "camera": bool(str(ex.get(MAKE, "")).strip() or str(ex.get(MODEL, "")).strip()),
        "xmp_rights": b"dc:rights" in raw or b"xmpRights" in raw,
        "exif_tags": len(ex),
    }


def default_out() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return Path(base) / "vakifname" / "reports" / f"monument_photos_audit_{stamp}.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", required=True, type=Path)
    ap.add_argument("--zip", type=Path)
    ap.add_argument("--catalog", required=True, type=Path, help="genel katalog anlık görüntüsü (JSON)")
    ap.add_argument("--media", type=Path, help="yayımlanmış katalog görsellerinin klasörü (tekrar denetimi)")
    ap.add_argument("--face-model-dir", type=Path)
    ap.add_argument("--no-faces", action="store_true")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if not a.src.is_dir():
        print(f"Klasör bulunamadı: {a.src} (hiçbir şey oluşturulmadı).")
        return 2
    catalog = json.loads(a.catalog.read_text(encoding="utf-8"))
    monuments = catalog["monuments"]
    names = {m["monument_id"]: m["name"] for m in monuments}

    # Yayımlanmış (lisanslı) katalog görselleri: SHA ve fark özeti.
    published = {}
    if a.media and a.media.is_dir():
        for m in monuments:
            for img in m.get("images", []):
                for key in ("file", "card_file"):
                    p = a.media / (img.get(key) or "")
                    if img.get(key) and p.is_file():
                        with Image.open(p) as im:
                            published[img[key]] = (m["monument_id"], hashlib.sha256(p.read_bytes()).hexdigest(), dhash(im))

    zip_sha = {}
    if a.zip and a.zip.is_file():
        with zipfile.ZipFile(a.zip) as z:
            for n in z.namelist():
                if not n.endswith("/"):
                    zip_sha[Path(n).name] = (hashlib.sha256(z.read(n)).hexdigest(), n.split("/")[-2])

    face = None
    if not a.no_faces:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from app.guide.privacy import FaceScreen  # noqa: E402
        face = FaceScreen(a.face_model_dir)
        if not face.available:
            print("Yüz denetimi kullanılamıyor: modeller yüklenemedi (rapor yüz denetimi olmadan).")
            face = None

    folders = sorted(p for p in a.src.iterdir() if p.is_dir())
    report = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": str(a.src),
              "zip": str(a.zip) if a.zip else None, "publication": "none (salt okunur denetim)", "folders": []}
    seen_sha: dict[str, str] = {}
    all_hashes: list[tuple[int, str, str]] = []
    for folder in folders:
        cands, scores = match_folder(folder.name, monuments)
        files = sorted(p for p in folder.rglob("*") if p.is_file())
        ids_in_names = Counter(m.group(1).upper() for p in files for m in [ID_RE.search(p.name)] if m)
        folder_id = cands[0] if len(cands) == 1 else None
        name_id = ids_in_names.most_common(1)[0][0] if ids_in_names else None
        if folder_id and name_id and folder_id != name_id:
            status, mid = "belirsiz_celiski", None
        elif folder_id:
            status, mid = "eslesti", folder_id
        else:
            status, mid = ("belirsiz", None)
        entry = {"folder": folder.name, "match_status": status, "monument_id": mid, "monument_name": names.get(mid),
                 "candidates": cands, "filename_ids": dict(ids_in_names), "files": []}
        for p in files:
            rec = {"file": p.name, "bytes": p.stat().st_size}
            if p.suffix.lower() not in IMAGE_EXT:
                rec["status"] = "desteklenmeyen_tur"
                entry["files"].append(rec)
                continue
            raw = p.read_bytes()
            sha = hashlib.sha256(raw).hexdigest()
            rec["sha256"] = sha
            fid = ID_RE.search(p.name)
            rec["filename_id"] = fid.group(1).upper() if fid else None
            try:
                with Image.open(io.BytesIO(raw)) as im:
                    im.verify()
                with Image.open(io.BytesIO(raw)) as im:
                    rec.update(format=im.format, width=im.width, height=im.height, mode=im.mode)
                    rec["exif"] = exif_report(im, raw)
                    im2 = ImageOps.exif_transpose(im)
                    im2.draft("RGB", (1600, 1600))
                    small = im2.convert("RGB")
                    small.thumbnail((1600, 1600))
                    h = dhash(small)
                    rec["dhash"] = f"{h:016x}"
                    if face:
                        buf = io.BytesIO()
                        small.save(buf, "JPEG", quality=85)
                        try:
                            rec["faces"] = face.faces(buf.getvalue())
                        except Exception as e:  # noqa: BLE001
                            rec["faces"] = None
                            rec["face_error"] = type(e).__name__
            except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
                rec["status"] = "bozuk"
                rec["error"] = type(e).__name__
                entry["files"].append(rec)
                continue
            # Tekrarlar: aynı içerik ve görsel olarak aynı fotoğraf (bu pakette, yayımlanmış katalogda).
            if sha in seen_sha:
                rec["duplicate_of"] = seen_sha[sha]
            else:
                seen_sha[sha] = f"{folder.name}/{p.name}"
                near = [ref for hh, ref, _m in all_hashes if bin(hh ^ h).count("1") <= NEAR_DUP]
                if near:
                    rec["near_duplicate_of"] = near[:3]
                all_hashes.append((h, f"{folder.name}/{p.name}", mid or ""))
            pub = [f for f, (pm, psha, ph) in published.items() if psha == sha or bin(ph ^ h).count("1") <= NEAR_DUP]
            if pub:
                rec["already_published_as"] = pub
            if zip_sha:
                z = zip_sha.get(p.name)
                rec["zip"] = "ayni" if z and z[0] == sha else ("farkli_icerik" if z else "zipte_yok")
                if z and z[1].upper().startswith("BUR-"):
                    rec["zip_folder_id"] = z[1].upper()
            # Durum: bozuk/tekrar/eşleşme/yüz/hak sırasıyla. Hak belgesi yoksa yayına uygun değil (inceleme bekliyor).
            if rec.get("duplicate_of") or rec.get("near_duplicate_of") or rec.get("already_published_as"):
                rec["status"] = "tekrar"
            elif mid is None or (rec["filename_id"] and rec["filename_id"] != mid):
                rec["status"] = "eser_eslesmesi_belirsiz"
            elif rec.get("faces"):
                rec["status"] = "yuz_iceriyor"
            else:
                rec["status"] = "inceleme_bekliyor"
            rec["license"] = None  # lisans/atıf belgesi yok: uydurulmaz
            rec["category"] = "genel"  # içerikten güvenilir sınıflandırma yapılmadı
            entry["files"].append(rec)
        report["folders"].append(entry)

    # Özet
    rows = []
    for f in report["folders"]:
        st = Counter(x["status"] for x in f["files"])
        rows.append({"eser": f["monument_name"] or f"({f['folder']})", "id": f["monument_id"], "klasor": f["folder"],
                     "eslesme": f["match_status"], "kaynak": len(f["files"]),
                     "teknik_uygun": st["inceleme_bekliyor"] + st["yuz_iceriyor"],
                     "eklenen": 0, "inceleme_bekleyen": st["inceleme_bekliyor"], "yuz": st["yuz_iceriyor"],
                     "tekrar": st["tekrar"], "belirsiz": st["eser_eslesmesi_belirsiz"],
                     "hatali": st["bozuk"] + st["desteklenmeyen_tur"]})
    allf = [x for f in report["folders"] for x in f["files"]]
    report["summary"] = {
        "rows": rows,
        "total": len(allf),
        "status": dict(Counter(x["status"] for x in allf)),
        "formats": dict(Counter(x.get("format") for x in allf)),
        "modes": dict(Counter(x.get("mode") for x in allf)),
        "exif": {k: sum(1 for x in allf if x.get("exif", {}).get(k)) for k in ("gps", "artist", "copyright", "description", "camera", "xmp_rights")},
        "zip": dict(Counter(x.get("zip") for x in allf)) if zip_sha else None,
        "zip_folder_mismatch": [f"{f['folder']}/{x['file']}" for f in report["folders"] for x in f["files"]
                                if x.get("zip_folder_id") and f["monument_id"] and x["zip_folder_id"] != f["monument_id"]],
        "sizes": {"min": min((x["width"] * x["height"], x["width"], x["height"]) for x in allf if x.get("width"))[1:],
                  "max": max((x["width"] * x["height"], x["width"], x["height"]) for x in allf if x.get("width"))[1:]},
        "faces_checked": face is not None,
    }
    out = a.out or default_out()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=1))
    print(f"Rapor: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
