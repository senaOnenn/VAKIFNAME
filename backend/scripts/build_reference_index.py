"""Görsel tanıma referans indeksinin sürümlü, geri alınabilir üretimi (çevrimdışı; canlı servise model yüklemez).

Bir fotoğraf indekse yalnızca `image_reference_index` kararı şu anda geçerliyse girer (hak kaydı onaylı ve eskimemiş,
Commons koleksiyonu, test kümesinde değil). Yayın kararı (`image_publication`) seçimi etkilemez. Görev 26'da yayın
onayıyla kurulan 60 fotoğraflık deney galerisi yalnızca `--include-legacy-gallery` ile ve ayrı etiketle eklenir.

    # Seçimi göster (varsayılan; hiçbir şey yazmaz):
    python scripts/build_reference_index.py --data-dir /var/lib/vakifname-internal
    # Yeni sürüm üret (değişmez klasör; var olan sürümün üzerine yazmaz):
    systemd-run --scope -p MemoryMax=1G -p CPUQuota=100% nice -n 10 \\
      python scripts/build_reference_index.py --data-dir ... --build v1-20261101 [--include-legacy-gallery]
    # Etkin sürümü değiştir / geri al (yalnızca işaretçi; hiçbir sürüm silinmez):
    python scripts/build_reference_index.py --data-dir ... --activate v1-20261101

İnceleme veritabanı her zaman önce geçici bir kopyaya alınır (SQLite yedekleme API'si); canlı dosyaya yazılmaz.
"""

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.internal import config  # noqa: E402
from app.internal.server import build_review_context  # noqa: E402

INDEX_ROOT = "visual_index/reference_index"
LEGACY_MANIFEST = "visual_index/dinov2-small-exp/manifest.json"
MODEL_DIR = "models/dinov2-small-ed25f3a"
EMBED_TOOLS = "visual_index/dinov2-small-exp/tools"


def snapshot_db(src: Path, dst: Path) -> None:
    s = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    d = sqlite3.connect(dst)
    s.backup(d)
    d.close()
    s.close()


def select(data_dir: Path, include_legacy: bool, candidates_file) -> tuple[list[dict], dict]:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "review.sqlite3"
        snapshot_db(data_dir / config.REVIEW_DB_FILE, db)
        svc = build_review_context(data_dir, config.research_file_from_env(), db,
                                   corroboration_file=config.corroboration_file_from_env(),
                                   commons_file=config.commons_images_file_from_env(), candidates_file=candidates_file,
                                   zip_overlay_file=config.hackathon_zip_overlay_file_from_env())
        latest = svc.store.latest_all()
        legacy = set()
        if include_legacy:
            legacy = {g["image_id"] for g in json.loads((data_dir / LEGACY_MANIFEST).read_text(encoding="utf-8"))["gallery"]}
        rows, skipped = [], {}
        for img in svc.images.images:
            eff = lambda dt: svc.effective("image", img.image_id, dt, latest)  # noqa: E731
            if svc.image_reference_index_usable(img.image_id, latest):
                basis = "image_reference_index"
            elif img.image_id in legacy and svc.image_publishable(img.image_id, latest):
                basis = "legacy_g26_published_gallery"
            else:
                if img.image_id in legacy:
                    skipped[img.image_id] = "eski galeri üyesi ama yayın/hak zinciri artık geçerli değil"
                continue
            assert not svc.holdout.contains(img) and not img.zip_identity_conflict, img.image_id
            assert img.collection == "wikimedia_commons" or img.zip_import is not None, img.image_id
            src = img.display["detail"] if img.display else img
            media_root = config.HACKATHON_ZIP_DISPLAY_DIR if img.display else config.COMMONS_IMAGES_DIR
            rights = eff("image_rights").record
            ref = eff("image_reference_index").record if basis == "image_reference_index" else None
            rows.append({
                "image_id": img.image_id, "monument_id": img.monument_id, "media_root": media_root,
                "relative_path": src.relative_path, "sha256": src.sha256, "selection_basis": basis,
                "collection": img.collection,
                "attribution": rights.payload.get("attribution"), "license": rights.payload["license"],
                "rights_holder": rights.payload["rights_holder"], "source_url": rights.payload.get("source_url"),
                "rights_decision_id": rights.decision_id,
                "reference_index_decision_id": ref.decision_id if ref else None,
                "angle_classes": list(ref.payload["angle_classes"]) if ref else None,
                "people": ref.payload["people"] if ref else None,
                "visible_text": ref.payload["visible_text"] if ref else None,
            })
        info = {"data_version": svc.data_version, "holdout_test_set": svc.holdout.test_set_id,
                "holdout_manifest_sha256": svc.holdout.manifest_sha256, "holdout_count": len(svc.holdout),
                "decisions_seen": sum(1 for _ in latest), "skipped": skipped}
    rows.sort(key=lambda r: r["image_id"])
    return rows, info


def build(data_dir: Path, version: str, rows: list[dict], info: dict) -> Path:
    root = data_dir / INDEX_ROOT
    out = root / version
    if out.exists():
        raise SystemExit(f"{out} zaten var; sürümler değiştirilmez, yeni sürüm adı verin.")
    if not rows:
        raise SystemExit("Seçilecek onaylı fotoğraf yok; boş indeks üretilmez.")
    sys.path.insert(0, str(data_dir / EMBED_TOOLS))
    import numpy as np  # noqa: PLC0415
    from PIL import Image  # noqa: PLC0415
    from vindex import Embedder  # noqa: PLC0415

    for r in rows:
        if hashlib.sha256((data_dir / r["media_root"] / r["relative_path"]).read_bytes()).hexdigest() != r["sha256"]:
            raise SystemExit(f"{r['image_id']}: dosya özeti uyuşmuyor; indeks üretilmedi.")
    E = Embedder(data_dir / MODEL_DIR)
    chunks = []
    for k in range(0, len(rows), 16):
        ims = []
        for r in rows[k:k + 16]:
            im = Image.open(data_dir / r["media_root"] / r["relative_path"])
            im.load()
            ims.append(im)
        chunks.append(E.embed(ims))
    G = np.concatenate(chunks)
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    tmp = root / f".{version}.tmp"
    tmp.mkdir(mode=0o700)
    np.save(tmp / "gallery.npy", G)
    manifest = {
        "schema": "vakifname.visual_reference_index/1", "version": version,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": E.prov, "embedding": "DINOv2 CLS + ortalama yama, çevirme ortalaması, L2",
        "selection_rule": "image_reference_index geçerli (hak onaylı; Commons veya yazılı izinli ve çelişkisiz ZIP fotoğrafı; "
                          "test kümesi dışı); legacy yalnızca bayrakla",
        "public_serving_allowed": False, "auto_match_enabled": False, **info,
        "gallery_sha256": hashlib.sha256((tmp / "gallery.npy").read_bytes()).hexdigest(),
        "gallery": [{**r, "pos": i} for i, r in enumerate(rows)],
    }
    (tmp / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    for f in tmp.iterdir():
        f.chmod(0o600)
    os.replace(tmp, out)
    return out


def activate(data_dir: Path, version: str) -> None:
    root = data_dir / INDEX_ROOT
    target = root / version
    if not (target / "manifest.json").is_file():
        raise SystemExit(f"Sürüm yok: {version}")
    link = root / "active"
    previous = os.readlink(link) if link.is_symlink() else None
    tmp = root / ".active.tmp"
    if tmp.is_symlink():
        tmp.unlink()
    tmp.symlink_to(version)
    os.replace(tmp, link)
    hist = root / "history.json"
    entries = json.loads(hist.read_text(encoding="utf-8")) if hist.exists() else []
    entries.append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "active": version,
                    "previous": previous, "by": os.environ.get("SUDO_USER") or os.environ.get("USER", "cli")})
    hist.write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8")
    hist.chmod(0o600)
    print(f"etkin sürüm: {version} (önceki: {previous})")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=config.data_dir_from_env())
    ap.add_argument("--candidates-file", type=Path, default=config.commons_candidates_file_from_env())
    ap.add_argument("--include-legacy-gallery", action="store_true")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--build", metavar="VERSION")
    g.add_argument("--activate", metavar="VERSION")
    a = ap.parse_args(argv)
    if a.activate:
        return activate(a.data_dir, a.activate)
    rows, info = select(a.data_dir, a.include_legacy_gallery, a.candidates_file)
    by = {}
    for r in rows:
        by.setdefault(r["selection_basis"], {}).setdefault(r["monument_id"], 0)
        by[r["selection_basis"]][r["monument_id"]] += 1
    print(json.dumps({"selected": len(rows), "by_basis_and_monument": by, **info}, ensure_ascii=False, indent=1))
    if a.build:
        print("yazıldı:", build(a.data_dir, a.build, rows, info))


if __name__ == "__main__":
    main()
