"""İngilizce taslakları (R6.17) içerik deposuna aktarır. Varsayılan olarak hiçbir şeyi YAYIMLAMAZ.

Taslak dosyası (`content_drafts/bursa_en_r617.json`, şema `vakifname.en_drafts/1`) her Türkçe kayıt için kitabın
İngilizce bölümünden birebir alıntıyı (`quote_en` + PDF sayfası), alıntıyı aşmayan İngilizce metni, varsa sorunun
İngilizcesini (şıklar Türkçe soruyla aynı sırada; doğru cevap Türkçe sorudaki şıktır) ve yönetici için notu taşır.
Taslaklar içerik deposuna `origin=pipeline` olarak yazılır: yayımlanmaları için alıntının kaynak sayfada birebir
bulunması zorunludur ve yönetici `/yonetim/icerik` ekranında kaynak sayfayla yan yana görüp onaylar.

Kaynak kitaplar depodaki kaynaklarla SHA-256 özetiyle eşlenir (kaynak kimliği sunucudan sunucuya değişebilir). Depoda
yoksa `--pdf` ile verilen dosya kaynak olarak eklenebilir; kullanım izni ancak `--rights-confirmed` verilirse işaretlenir.

`--publish-local-test`: YALNIZCA ayrı bir yerel test deposunda tarayıcı denemesi için. Onay kaydına aktör olarak
"yerel-test" yazılır; bu depo yayına gönderilmez. Gerçek yayında onayı yönetici verir.

    python scripts/import_english_drafts.py --content-dir <depo> --catalog tests/ask_eval/catalog_snapshot.json \\
        [--pdf cilt-1=<yol> --pdf cilt-2=<yol> --rights-confirmed] [--publish-local-test]
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.content.store import ContentError, ContentStore  # noqa: E402
from app.public_catalog import PublicCatalog  # noqa: E402

SCHEMA = "vakifname.en_drafts/1"
DEFAULT_DRAFTS = Path(__file__).resolve().parents[1] / "content_drafts" / "bursa_en_r617.json"
ACTOR = "yerel-test (R6.17 taslak aktarımı)"
LOCAL_TEST_ACTOR = "yerel-test (yayın değil)"


def load_catalog(path: Path) -> PublicCatalog:
    return PublicCatalog.model_validate_json(path.read_text(encoding="utf-8"))


def source_ids(store: ContentStore, sources: dict, pdfs: dict[str, Path], rights: bool) -> dict[str, str]:
    """Taslak kaynak anahtarı (ör. `cilt-1`) → depodaki `SRC-xxxx`."""
    have = {r["sha256"]: r["source_id"] for r in store._all("SELECT source_id, sha256 FROM sources")}
    out = {}
    for key, meta in sources.items():
        if meta["sha256"] in have:
            out[key] = have[meta["sha256"]]
            continue
        pdf = pdfs.get(key)
        if pdf is None:
            raise SystemExit(f"{key} ({meta['file']}) depoda yok; --pdf {key}=<yol> ile verin.")
        data = pdf.read_bytes()
        if hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise SystemExit(f"{pdf}: özet taslaktaki kitapla aynı değil; başka bir baskı olabilir.")
        up = store.save_upload("pdf", data, ACTOR)
        out[key] = store.add_source(up["upload_id"], meta["title"], rights, ACTOR)["source_id"]
        print(f"kaynak eklendi: {key} → {out[key]} (kullanım izni: {'evet' if rights else 'hayır'})")
    return out


def run(content_dir: Path, catalog: PublicCatalog, drafts: dict, pdfs: dict[str, Path], rights: bool,
        publish_local_test: bool) -> dict:
    if drafts.get("schema") != SCHEMA:
        raise SystemExit("Taslak dosyasının şeması tanınmadı.")
    store = ContentStore(content_dir, lambda: {m.monument_id: m for m in catalog.monuments})
    try:
        src = source_ids(store, drafts["sources"], pdfs, rights)
        actor = LOCAL_TEST_ACTOR if publish_local_test else ACTOR
        counts = {"facts": 0, "quests": 0, "skipped": 0, "monuments": 0, "errors": []}
        for f in drafts["facts"]:
            if f.get("skip"):
                counts["skipped"] += 1
                continue
            data = {"title_en": f["title_en"], "text_en": f["text_en"], "quote_en": f["quote_en"],
                    "source_id": src[f["source"]], "page": f["page"], "quest_en": f.get("quest_en"),
                    "note": f.get("note")}
            try:
                store.set_translation(f["fact_id"], data, publish_local_test, actor, origin="pipeline")
            except ContentError as e:
                counts["errors"].append(f"{f['fact_id']}: {e}")
                continue
            counts["facts"] += 1
            counts["quests"] += bool(f.get("quest_en"))
        for m in drafts["monuments"]:
            data = {"name_en": m["name_en"], "site_notice_en": m.get("site_notice_en"),
                    "alternative_names_en": m.get("alternative_names_en") or [], "address_en": m.get("address_en")}
            store.set_monument_en(m["monument_id"], data, publish_local_test, actor)
            counts["monuments"] += 1
        return counts
    finally:
        store.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--content-dir", required=True, type=Path)
    ap.add_argument("--catalog", required=True, type=Path)
    ap.add_argument("--drafts", type=Path, default=DEFAULT_DRAFTS)
    ap.add_argument("--pdf", action="append", default=[], help="kaynak=yol (ör. cilt-1=/veri/bursa-envanteri-cilt-1.pdf)")
    ap.add_argument("--rights-confirmed", action="store_true", help="eklenen kaynağın kullanım izni onaylı")
    ap.add_argument("--publish-local-test", action="store_true",
                    help="YALNIZCA ayrı yerel test deposunda: taslakları 'yerel-test' aktörüyle yayımlar")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    pdfs = dict((k, Path(v)) for k, v in (p.split("=", 1) for p in a.pdf))
    drafts = json.loads(a.drafts.read_text(encoding="utf-8"))
    counts = run(a.content_dir, load_catalog(a.catalog), drafts, pdfs, a.rights_confirmed, a.publish_local_test)
    state = "YEREL TEST için yayımlandı" if a.publish_local_test else "taslak (yönetici onayı bekliyor)"
    print(f"{counts['facts']} kayıt ({counts['quests']} soruyla), {counts['monuments']} eser adı/uyarısı → {state}; "
          f"{counts['skipped']} kayıt atlandı (İngilizce bölümde karşılığı yok).")
    for e in counts["errors"]:
        print("HATA", e)
    return 1 if counts["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
