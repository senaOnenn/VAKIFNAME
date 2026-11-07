"""R6.15: yerel eser fotoğraflarının salt okunur denetimi (scripts/audit_local_monument_photos.py).

Kurgusal katalog (BUR-9xxx gerçek katalog kimliği değildir) ve geçici klasörde üretilen fotoğraflarla: klasör eşleşmesi
(Türkçe karakter, yazım farkı), belirsiz klasör, eserler arası tekrar, bozuk dosya, EXIF kişisel verisinin rapora
yazılmaması, kaynak dosyaların değişmemesi ve lisans belgesi olmayan hiçbir fotoğrafın yayına uygun sayılmaması.
"""

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_local_monument_photos.py"
CATALOG = {"monuments": [
    {"monument_id": "BUR-9001", "name": "Deneme Ulu Camii", "alternative_names": ["Deneme Ulu Cami"], "images": []},
    {"monument_id": "BUR-9002", "name": "Deneme Koza Han", "alternative_names": [], "images": []},
    {"monument_id": "BUR-9003", "name": "Sultan II. Deneme Türbesi", "alternative_names": [], "images": []},
    {"monument_id": "BUR-9004", "name": "Deneme Medresesi", "alternative_names": [], "images": []},
    {"monument_id": "BUR-9005", "name": "Deneme Camii", "alternative_names": [], "images": []},
]}


def jpeg(seed: int, size=(640, 420), mode="RGB", exif=None) -> bytes:
    """Her tohum için belirgin biçimde farklı fotoğraf (rastgele bloklar): fark özetleri birbirine benzemez."""
    import random
    rnd = random.Random(seed)
    im = Image.new("RGB", size)
    bw, bh = size[0] // 8, size[1] // 8
    for i in range(8):
        for j in range(8):
            im.paste((rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)), (i * bw, j * bh, (i + 1) * bw, (j + 1) * bh))
    if mode == "CMYK":
        im = im.convert("CMYK")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90, **({"exif": exif} if exif else {}))
    return buf.getvalue()


def gps_exif() -> bytes:
    ex = Image.Exif()
    ex[0x013B] = "Gizli Fotoğrafçı"  # Artist
    ex[0x8298] = "(c) Gizli"  # Copyright
    ex.get_ifd(0x8825).update({1: "N", 2: (40.0, 11.0, 0.0), 3: "E", 4: (29.0, 3.0, 0.0)})
    return ex.tobytes()


def run(tmp: Path, src: Path) -> dict:
    cat = tmp / "catalog.json"
    cat.write_text(json.dumps(CATALOG, ensure_ascii=False), encoding="utf-8")
    out = tmp / "report.json"
    r = subprocess.run([sys.executable, str(SCRIPT), "--src", str(src), "--catalog", str(cat), "--no-faces", "--out", str(out)],
                       capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(out.read_text(encoding="utf-8"))


def build(tmp: Path) -> Path:
    src = tmp / "monuments"
    files = {
        "Busa ulu cami": {"BUR-9001_Ulucami_1.jpeg": jpeg(1, mode="CMYK"), "BUR-9001_Ulucami_2.jpeg": jpeg(2, exif=gps_exif())},
        "deneme koza hanı": {"BUR-9002_Koza_Hani_1.jpeg": jpeg(3)},
        "sultan 2. deneme türbesi": {"BUR-9003_Turbe_1.jpeg": jpeg(4), "BUR-9003_Turbe_2.jpeg": b"bozuk-dosya"},
        "deneme medresesi": {"BUR-9004_Medrese_1.jpeg": jpeg(5)},
        "deneme cami": {"BUR-9005_Cami_1.jpeg": jpeg(5)},  # medresedekiyle aynı içerik: eserler arası tekrar
        "deneme": {"BUR-9001_x.jpeg": jpeg(6)},  # birden çok esere benzeyen klasör: belirsiz
    }
    for folder, fs in files.items():
        (src / folder).mkdir(parents=True)
        for name, data in fs.items():
            (src / folder / name).write_bytes(data)
    return src


def snapshot(src: Path) -> dict:
    return {str(p.relative_to(src)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(src.rglob("*")) if p.is_file()}


def test_folders_match_catalog_ids_despite_turkish_and_spelling(tmp_path):
    rep = run(tmp_path, build(tmp_path))
    by = {f["folder"]: f for f in rep["folders"]}
    assert by["Busa ulu cami"]["monument_id"] == "BUR-9001"  # "Busa", "cami" ↔ "Camii"
    assert by["deneme koza hanı"]["monument_id"] == "BUR-9002"  # "hanı" ↔ "Han"
    assert by["sultan 2. deneme türbesi"]["monument_id"] == "BUR-9003"  # "2." ↔ "II."
    assert by["deneme medresesi"]["monument_id"] == "BUR-9004"
    assert by["deneme cami"]["monument_id"] == "BUR-9005"
    # Belirsiz klasör hiçbir esere bağlanmaz; fotoğrafı "eşleşmesi belirsiz" kalır.
    assert by["deneme"]["monument_id"] is None and by["deneme"]["match_status"] == "belirsiz"
    assert {x["status"] for x in by["deneme"]["files"]} == {"eser_eslesmesi_belirsiz"}


def test_each_photo_only_bound_to_its_own_monument_duplicates_and_corrupt_reported(tmp_path):
    rep = run(tmp_path, build(tmp_path))
    by = {f["folder"]: f for f in rep["folders"]}
    for f in rep["folders"]:
        for x in f["files"]:
            if f["monument_id"] and x.get("filename_id"):
                assert x["filename_id"] == f["monument_id"]
    # Klasörler ad sırasıyla okunur: "deneme cami" önce gelir; medresedeki aynı içerik tekrar olarak işaretlenir ve
    # hiçbir eserin arşivine ikinci kez girmez.
    dup = by["deneme medresesi"]["files"][0]
    assert dup["status"] == "tekrar" and dup["duplicate_of"] == "deneme cami/BUR-9005_Cami_1.jpeg"
    assert by["deneme cami"]["files"][0]["status"] == "inceleme_bekliyor"
    bad = next(x for x in by["sultan 2. deneme türbesi"]["files"] if x["file"] == "BUR-9003_Turbe_2.jpeg")
    assert bad["status"] == "bozuk"
    assert by["Busa ulu cami"]["files"][0]["mode"] == "CMYK"


def test_no_photo_is_publishable_without_license_and_exif_personal_data_not_copied(tmp_path):
    src = build(tmp_path)
    rep = run(tmp_path, src)
    allf = [x for f in rep["folders"] for x in f["files"]]
    assert all(x.get("license") is None for x in allf if x["status"] not in ("bozuk", "desteklenmeyen_tur"))
    assert not {"yayina_uygun", "eklendi", "published"} & {x["status"] for x in allf}
    assert all(row["eklenen"] == 0 for row in rep["summary"]["rows"])
    gps = next(x for x in allf if x["file"] == "BUR-9001_Ulucami_2.jpeg")
    assert gps["exif"]["gps"] is True and gps["exif"]["artist"] is True and gps["exif"]["copyright"] is True
    text = (tmp_path / "report.json").read_text(encoding="utf-8")
    assert "Gizli Fotoğrafçı" not in text and "(c) Gizli" not in text and "40.0" not in text  # yalnızca var/yok


def test_read_only_sources_untouched_and_missing_folder_creates_nothing(tmp_path):
    src = build(tmp_path)
    before = snapshot(src)
    run(tmp_path, src)
    assert snapshot(src) == before
    missing = tmp_path / "yok"
    r = subprocess.run([sys.executable, str(SCRIPT), "--src", str(missing), "--catalog", str(tmp_path / "catalog.json"), "--no-faces",
                        "--out", str(tmp_path / "r2.json")], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 2 and not missing.exists() and not (tmp_path / "r2.json").exists()
