"""Yayın onaylı kayıtları genel katalog anlık görüntüsüne yazar.

Genel uygulama (`app.public_catalog`) yalnızca bu komutun ürettiği dosyayı okur. Bir kayıt ancak tüm karar zinciri şu
anda geçerliyse yazılır (bkz. `decisions.DecisionService.gates`):

- Eser (temel kimlik): `catalog_identity`; olgu, görsel ve konum kararlarını beklemez. Kimlik resmî bir kaynakla veya
  kullanım hakkı onaylı kaynak PDF'iyle desteklenmelidir.
- Olgu: `fact_editorial` + `fact_publication` (+ eser kimliği, çözülmüş açık sorunlar ve ya kaynak kullanım hakkı ya da
  bağımsız kaynak + özgün metin); yayında kararın onayladığı metin ve kaynaklar kullanılır. Oyunda kullanım ayrıca
  `fact_game_use` (soru ve doğru cevap kararın içindedir).
- Görsel: `image_rights` + `image_publication`; oyunda kullanım ayrıca `image_game_use`. Dosya (ve varsa kart sürümü)
  SHA-256 ile doğrulanıp `media/` altına kopyalanır. Atıf, lisans ve kaynak bağlantısı hak kararından gelir.
- Harita: `location_verification` + `location_map_display`
- Check-in: ayrıca `gps_checkin` (onaylı giriş noktası ve yarıçap)

Karantinadaki adaylar, açık sorun kayıtları, kaynak alıntıları, inceleme notları ve RAG içeriği hiçbir durumda yazılmaz.

    VAKIFNAME_INTERNAL_DATA_DIR=/var/lib/vakifname-internal \\
      python -m app.internal.publish --out ../data/public_catalog/catalog.json
"""

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from ..public_catalog import PUBLIC_CATALOG_SCHEMA, PublicCatalog
from . import config
from .catalog import sha256_file
from .decisions import DecisionService, FactGameUsePayload
from .review_store import utc_now


def _source_titles(service: DecisionService) -> dict[str, str]:
    titles = {}
    for r in service.research.monuments.values():
        for s in r.sources:
            if s.kind == "v20_source_pdf" and s.pdf_file:
                titles.setdefault(s.pdf_file, s.title)
    return titles


LICENSE_URLS = {
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "CC-BY-2.0": "https://creativecommons.org/licenses/by/2.0/", "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/", "CC-BY-SA-2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
    "CC-BY-SA-2.5": "https://creativecommons.org/licenses/by-sa/2.5/", "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
}
COLLECTION_DIRS = {"v20_archive": config.IMAGES_DIR, "wikimedia_commons": config.COMMONS_IMAGES_DIR}


def build_snapshot(service: DecisionService) -> tuple[PublicCatalog, list[tuple[str, Path, str]]]:
    """Anlık görüntüyü ve kopyalanacak görsel dosyalarını (koleksiyon, kaynak, hedef ad) döndürür. Hiçbir şey yazmaz."""
    latest = service.store.latest_all()
    titles = _source_titles(service)
    eff = lambda kind, sid, dt: service.effective(kind, sid, dt, latest)  # noqa: E731
    monuments, media = [], []

    for mid, m in service.catalog.monuments.items():
        gates = service.gates(mid, latest)
        if not gates["catalog_identity"]:
            continue
        research = service.research.get(mid)
        identity = eff("monument", mid, "catalog_identity").record

        facts = []
        for fid in gates["facts_published"]:
            f = service.catalog.facts[fid]
            pub = service.fact_publication_payload(fid, latest)
            game = fid in gates["facts_game_use"]
            game_rec = eff("fact", fid, "fact_game_use").record if game else None
            quest = None
            if game_rec is not None:
                try:
                    q = FactGameUsePayload(**game_rec.payload)
                    quest = {**q.model_dump(mode="json"), "decision_id": game_rec.decision_id}
                except Exception:  # noqa: BLE001 — eski şemalı oyun kararı soru taşımaz
                    quest = None
            sources = []
            for sid in pub.corroboration_source_ids:
                s = service.corroboration.sources.get(sid)
                if s is not None:
                    sources.append({"title": s.title, "publisher": s.publisher, "url": str(s.url)})
            facts.append({
                # Yayında editörün onayladığı metin kullanılır; V20 taslak metni kendiliğinden yayına geçmez.
                "fact_id": fid, "title": pub.title, "text": pub.public_text, "category": f.category,
                "certainty": f.certainty,
                "source": {"title": titles.get(f.source.source_file, f.source.source_file),
                           "pdf_physical_page": f.source.pdf_physical_page},
                "editorial_decision_id": eff("fact", fid, "fact_editorial").record.decision_id,
                "publication_decision_id": eff("fact", fid, "fact_publication").record.decision_id,
                "game_use": game,
                "game_use_decision_id": game_rec.decision_id if game_rec else None,
                "basis": pub.basis, "sources": sources, "quest": quest,
            })

        images = []
        published = [i for i in service.images.images if i.image_id in set(gates["images_published"])]
        published.sort(key=lambda i: ((i.provenance or {}).get("rank", 999), i.image_id))
        for img in published:
            image_id = img.image_id
            rights = eff("image", image_id, "image_rights").record
            game = image_id in gates["images_game_use"]
            # ZIP fotoğraflarında özgün CMYK dosyası değil, sRGB görüntüleme kopyası yayımlanır.
            detail = img.display["detail"] if img.display else img
            card = img.display.get("card") if img.display else img.card
            root_key = "hackathon_zip_display" if img.display else img.collection
            target = f"{detail.sha256}.jpeg"
            media.append((root_key, Path(detail.relative_path), target))
            card_target = None
            if card is not None:
                card_target = f"{card.sha256}.jpeg"
                media.append((root_key, Path(card.relative_path), card_target))
            prov = img.provenance or {}
            images.append({
                "image_id": image_id, "file": target, "card_file": card_target,
                "rights_holder": rights.payload["rights_holder"],
                "license": rights.payload["license"], "attribution": rights.payload.get("attribution"),
                "license_url": LICENSE_URLS.get(rights.payload["license"]),
                "source_url": rights.payload.get("source_url"), "title": prov.get("title"),
                "width": detail.width, "height": detail.height,
                "source_label": "Vakıf Katılım — Bursa Vakıf Eserleri Envanteri" if img.zip_import else "Wikimedia Commons",
                "rights_decision_id": rights.decision_id,
                "publication_decision_id": eff("image", image_id, "image_publication").record.decision_id,
                "game_use": game,
                "game_use_decision_id": eff("image", image_id, "image_game_use").record.decision_id if game else None,
            })

        location = checkin = None
        if gates["map_display"]:
            loc = service.effective_location(mid, latest)
            verification = eff("location", mid, "location_verification").record
            cand = research.candidate(verification.payload["candidate_id"])
            location = {
                "latitude": loc.latitude, "longitude": loc.longitude, "accuracy_m": loc.accuracy_m,
                "represents": cand.represents, "verification_decision_id": verification.decision_id,
                "map_decision_id": eff("location", mid, "location_map_display").record.decision_id,
            }
            if gates["gps_checkin"]:
                c = eff("location", mid, "gps_checkin").record
                checkin = {k: c.payload[k] for k in ("latitude", "longitude", "radius_m", "point_kind",
                                                     "access_hours_note", "safety_note")}
                checkin["decision_id"] = c.decision_id

        # Ad, alternatif adlar, adres ve erişim notu yalnızca kimlik kararında editörün seçtiği değerlerdir; araştırma
        # dosyasındaki otomatik derlenmiş metin (ör. `site_context.access_notes`) yayına kendiliğinden geçmez.
        p = identity.payload
        monuments.append({
            "monument_id": mid, "name": p["display_name"],
            "alternative_names": list(p.get("published_alternative_names", ())),
            "type": m.type, "city": m.city, "district": m.district,
            "address": p["display_address"], "catalog_decision_id": identity.decision_id,
            "facts": facts, "images": images, "location": location, "checkin": checkin,
            "site_notice": p.get("public_site_notice"),
        })

    snapshot = PublicCatalog.model_validate({
        "schema": PUBLIC_CATALOG_SCHEMA, "generated_at": utc_now().isoformat(timespec="seconds"),
        "data_version": service.data_version, "monuments": monuments,
    })
    return snapshot, media


def write_snapshot(service: DecisionService, out: Path, images_dir: Path, actor: str,
                   commons_dir: Optional[Path] = None) -> PublicCatalog:
    snapshot, media = build_snapshot(service)
    out = Path(out)
    media_dir = out.parent / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    roots = {"v20_archive": Path(images_dir),
             "wikimedia_commons": Path(commons_dir) if commons_dir else Path(images_dir).parent / "commons",
             "hackathon_zip_display": Path(images_dir).parent / "hackathon_zip_display"}
    expected = {target for _, _, target in media}
    for collection, rel, target in media:
        src = roots[collection] / rel
        if sha256_file(src) != target.split(".")[0]:
            raise ValueError(f"{rel}: görsel dosyası manifestteki SHA-256 ile uyuşmuyor; yayın durduruldu.")
        shutil.copyfile(src, media_dir / target)
    # Artık yayında olmayan görseller kaldırılır.
    for stale in media_dir.iterdir():
        if stale.name not in expected:
            stale.unlink()
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=".catalog-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(snapshot.model_dump(mode="json", by_alias=True), fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, out)
    service.store.log(actor, "public_snapshot_written", str(out), {
        "monuments": len(snapshot.monuments), "facts": sum(len(m.facts) for m in snapshot.monuments),
        "images": len(expected), "data_version": service.data_version,
    })
    return snapshot


def main(argv: Optional[list[str]] = None):
    from .server import build_review_context

    parser = argparse.ArgumentParser(description="Yayın onaylı kayıtları genel katalog anlık görüntüsüne yazar.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--actor", default=os.environ.get("USER", "cli"))
    args = parser.parse_args(argv)
    data_dir = config.data_dir_from_env()
    service = build_review_context(data_dir, config.research_file_from_env(),
                                   corroboration_file=config.corroboration_file_from_env(),
                                   commons_file=config.commons_images_file_from_env(),
                                   candidates_file=config.commons_candidates_file_from_env(),
                                   zip_overlay_file=config.hackathon_zip_overlay_file_from_env())
    snapshot = write_snapshot(service, args.out, data_dir / config.IMAGES_DIR, f"cli:{args.actor}",
                              commons_dir=data_dir / config.COMMONS_IMAGES_DIR)
    print(f"{len(snapshot.monuments)} eser, {sum(len(m.facts) for m in snapshot.monuments)} olgu yazıldı: {args.out}")
    if not snapshot.monuments:
        print("Henüz yayına onaylanmış eser yok; genel katalog boş görünecek.")


if __name__ == "__main__":
    main()
