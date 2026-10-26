"""Korumalı veri dizini için dahili manifestleri üretir.

Çıktılar (`<data_dir>/manifests/`):
- source_registry.json   PDF adı, SHA-256, boyut, fiziksel sayfa sayısı
- source_page_audit.json Her olgu ve aday kaydın alıntısının belirtilen FİZİKSEL PDF sayfasında bulunup bulunmadığı
- image_manifest.json    BUR-xxxx klasörlerindeki JPEG dosyalarının envanteri ve inceleme/lisans durumu

Yalnızca yerel dosyaları okur; ağ erişimi veya dış servis kullanmaz.
`pypdf` gerektirir (requirements-internal.txt). Kullanım:

    python -I scripts/build_internal_manifests.py [--data-dir /var/lib/vakifname-internal]
"""

import argparse
import hashlib
import json
import logging
import os
import re
import struct
import sys
import unicodedata
from pathlib import Path

from pypdf import PdfReader

DEFAULT_DATA_DIR = Path(os.environ.get("VAKIFNAME_INTERNAL_DATA_DIR", "/var/lib/vakifname-internal"))
MONUMENT_DIR = re.compile(r"^BUR-\d{4}$")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def squash(text):
    """PDF metin çıkarımındaki boşluk/satır sonu farklarını yok sayan karşılaştırma biçimi."""
    text = unicodedata.normalize("NFKC", text).replace("’", "'").replace("‘", "'").casefold()
    return re.sub(r"[\W_]+", "", text)


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def build_sources(data_dir, readers):
    sources = []
    for pdf in sorted((data_dir / "sources").glob("*.pdf")):
        reader = PdfReader(str(pdf))
        readers[pdf.name] = reader
        sources.append({
            "source_file": pdf.name,
            "sha256": sha256_file(pdf),
            "size_bytes": pdf.stat().st_size,
            "physical_page_count": len(reader.pages),
        })
    return {"page_numbering": "physical_1_based", "sources": sources}


def build_page_audit(kb, readers):
    cache = {}

    def page_text(name, page):
        key = (name, page)
        if key not in cache:
            reader = readers[name]
            cache[key] = squash(reader.pages[page - 1].extract_text() or "") if 1 <= page <= len(reader.pages) else ""
        return cache[key]

    def audit(record_id, kind, name, page, quote):
        q = squash(quote)
        entry = {"record_id": record_id, "kind": kind, "source_file": name, "pdf_physical_page": page}
        if not q:
            return {**entry, "result": "no_direct_quote"}
        if name not in readers:
            return {**entry, "result": "source_missing"}
        if q and q in page_text(name, page):
            return {**entry, "result": "quote_found_on_page"}
        nearby = [p for p in (page - 1, page + 1) if q and q in page_text(name, p)]
        return {**entry, "result": "quote_found_on_adjacent_page" if nearby else "quote_not_found", "found_on": nearby}

    records = []
    for m in kb["monuments"]:
        for f in m["historical_facts"]:
            s = f["source"]
            records.append(audit(f["metadata"]["fact_id"], "fact", s["original_book"], s["original_pdf_page"], s["evidence_quote"]))
        for d in m.get("research_fact_drafts", []):
            e = d["evidence"]
            records.append(audit(d["draft_fact_id"], "draft", e["source_file"], e["pdf_page"], e.get("quote") or ""))
    page_labels = {}
    for name, reader in readers.items():
        try:
            labels = reader.page_labels
        except Exception:
            labels = []
        page_labels[name] = {
            "has_custom_labels": any(lbl != str(i + 1) for i, lbl in enumerate(labels)),
            "note": "Basılı sayfa numarası V20'de tutulmaz; atıflar fiziksel PDF sayfasıdır.",
        }
    counts = {}
    for r in records:
        counts[f"{r['kind']}:{r['result']}"] = counts.get(f"{r['kind']}:{r['result']}", 0) + 1
    return {"page_numbering": "physical_1_based", "summary": counts, "page_labels": page_labels, "records": records}


def jpeg_size(path):
    """JPEG SOF işaretçisinden (genişlik, yükseklik) okur; geçersizse None döner."""
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            byte = f.read(1)
            while byte and byte != b"\xff":
                byte = f.read(1)
            while byte == b"\xff":
                byte = f.read(1)
            if not byte:
                return None
            marker = byte[0]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            length_raw = f.read(2)
            if len(length_raw) != 2:
                return None
            (length,) = struct.unpack(">H", length_raw)
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                data = f.read(5)
                height, width = struct.unpack(">HH", data[1:5])
                return width, height
            f.seek(length - 2, 1)


def build_images(data_dir, monument_ids):
    root = data_dir / "images" / "monuments"
    images, unexpected, by_hash = [], [], {}
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.is_symlink() or not MONUMENT_DIR.match(entry.name):
            unexpected.append(entry.name)
            continue
        for img in sorted(entry.iterdir(), key=lambda p: p.name):
            if img.is_symlink() or not img.is_file() or img.suffix.lower() not in (".jpeg", ".jpg"):
                unexpected.append(f"{entry.name}/{img.name}")
                continue
            digest = sha256_file(img)
            size = jpeg_size(img)
            images.append({
                "image_id": f"{entry.name}/{img.name}",
                "monument_id": entry.name,
                "relative_path": f"{entry.name}/{img.name}",
                "sha256": digest,
                "size_bytes": img.stat().st_size,
                "jpeg_valid": size is not None,
                "width": size[0] if size else None,
                "height": size[1] if size else None,
                "monument_known_in_v20": entry.name in monument_ids,
                "filename_prefix_matches_folder": img.name.startswith(entry.name + "_"),
                # Klasöre göre eşleşme otomatik; görselin eseri gerçekten gösterdiği doğrulanmadı.
                "monument_link_status": "folder_assigned_unverified",
                "content_verification_status": "pending",
                "license_status": "not_checked",
                "publication_status": "blocked",
                "public_serving_allowed": False,
            })
            by_hash.setdefault(digest, []).append(f"{entry.name}/{img.name}")
    duplicates = {h: ids for h, ids in by_hash.items() if len(ids) > 1}
    for img in images:
        img["duplicate_of"] = [i for i in duplicates.get(img["sha256"], []) if i != img["image_id"]]
    per_monument = {}
    for img in images:
        per_monument[img["monument_id"]] = per_monument.get(img["monument_id"], 0) + 1
    return {
        "image_root": "images/monuments",
        "policy": {
            "monument_link_is_not_publication_permission": True,
            "public_serving_allowed": False,
            "license_review": "pending",
            "content_verification": "pending",
        },
        "summary": {
            "images": len(images),
            "per_monument": per_monument,
            "monuments_without_images": sorted(set(monument_ids) - set(per_monument)),
            "duplicate_groups": len(duplicates),
            "unexpected_entries": unexpected,
        },
        "images": images,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    args = parser.parse_args(argv)
    logging.getLogger("pypdf").setLevel(logging.ERROR)
    data_dir = args.data_dir.resolve()
    out = data_dir / "manifests"
    out.mkdir(mode=0o700, exist_ok=True)

    kb = json.loads((data_dir / "v20" / "vakifname_knowledge_base_v20_dev.json").read_text(encoding="utf-8"))
    readers = {}
    write_json(out / "source_registry.json", build_sources(data_dir, readers))
    audit = build_page_audit(kb, readers)
    write_json(out / "source_page_audit.json", audit)
    images = build_images(data_dir, [m["monument_id"] for m in kb["monuments"]])
    write_json(out / "image_manifest.json", images)
    print(json.dumps({"page_audit": audit["summary"], "page_labels": audit["page_labels"], "images": images["summary"]},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
